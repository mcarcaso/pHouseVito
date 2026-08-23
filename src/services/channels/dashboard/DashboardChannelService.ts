import type { OutputHandler } from "../../../lib/output/OutputHandler.js";
import type { InboundEvent } from "../../../lib/types/inbound-event.js";
import type { ChannelService } from "../ChannelService.js";
import type { Context } from "../../../context/Context.js";
import { xDashboardChatService } from "../../../lib/x.js";
import { createAppProxyMiddleware } from "../../../routers/AppProxyMiddleware.js";
import { createHttpSecurityMiddleware } from "./http-security.js";
import { AppRouterService } from "../../../routers/AppRouterService.js";
import { AskApiRouterService } from "../../../routers/AskApiRouterService.js";
import {
  AttachmentFileRouterService,
  AttachmentUploadRouterService,
} from "../../../routers/AttachmentRouterService.js";
import { DashboardAuthRouterService } from "../../../routers/DashboardAuthRouterService.js";
import { ChannelManagementRouterService } from "../../../routers/ChannelManagementRouterService.js";
import { DashboardChatRouterService } from "../../../routers/DashboardChatRouterService.js";
import { ConfigRouterService } from "../../../routers/ConfigRouterService.js";
import { CronRouterService } from "../../../routers/CronRouterService.js";
import {
  DriveRouterService,
  PublicDriveRouterService,
} from "../../../routers/DriveRouterService.js";
import { FileRouterService } from "../../../routers/FileRouterService.js";
import { MemoryRouterService } from "../../../routers/MemoryRouterService.js";
import { PiSessionRouterService } from "../../../routers/PiSessionRouterService.js";
import {
  ModelRouterService,
  ProviderAuthRouterService,
} from "../../../routers/ProviderRouterService.js";
import { SecretRouterService } from "../../../routers/SecretRouterService.js";
import { ServerLifecycleRouterService } from "../../../routers/ServerLifecycleRouterService.js";
import { SessionRouterService } from "../../../routers/SessionRouterService.js";
import { SkillRouterService } from "../../../routers/SkillRouterService.js";
import { SystemContentRouterService } from "../../../routers/SystemContentRouterService.js";
import { TraceRouterService } from "../../../routers/TraceRouterService.js";
import { VoiceRouterService } from "../../../routers/VoiceRouterService.js";
import express from "express";
import http from "node:http";
const createServer = http.createServer.bind(http);
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function isPrivateDevelopmentOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:") return false;
    return (
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname.startsWith("192.168.") ||
      url.hostname.startsWith("10.") ||
      url.hostname.startsWith("100.")
    );
  } catch {
    return false;
  }
}

export class DashboardChannelService implements ChannelService {
  readonly name = "dashboard";
  readonly capabilities = {
    typing: true,
    reactions: false,
    attachments: true,
    streaming: true,
  };

  private server?: http.Server;
  private readonly port = parseInt(process.env.PORT || "3030", 10);

  private async setupExpress(x: Context, app: express.Express): Promise<void> {
    app.disable("x-powered-by");
    app.use(createHttpSecurityMiddleware(x));
    app.use((req, res, next) => {
      const origin = req.headers.origin;
      if (!origin || !isPrivateDevelopmentOrigin(origin)) {
        next();
        return;
      }
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
      res.setHeader("Vary", "Origin");
      if (req.method === "OPTIONS") {
        res.status(204).end();
        return;
      }
      next();
    });

    // Must precede body parsing so request bodies can stream to app processes.
    app.use(createAppProxyMiddleware(x));

    app.use(express.static(path.join(__dirname, "../../../../dashboard/dist")));

    // Public drive files and hosted sites are resolved through DriveStore.
    app.use("/d", await new PublicDriveRouterService().createRouter(x));

    app.use("/api/auth", await new DashboardAuthRouterService().createRouter(x));
    app.use("/attachments", await new AttachmentFileRouterService().createRouter(x));

    // API endpoints
    app.use("/api", await new ServerLifecycleRouterService().createRouter(x));

    app.use("/api", await new ConfigRouterService().createRouter(x));

    app.use("/api/models", await new ModelRouterService().createRouter(x));
    app.use("/api/auth/provider", await new ProviderAuthRouterService().createRouter(x));

    app.use("/api/sessions", await new SessionRouterService().createRouter(x));

    app.use("/api/skills", await new SkillRouterService().createRouter(x));

    app.use("/api/cron", await new CronRouterService().createRouter(x));

    app.use("/api/discord", await new ChannelManagementRouterService("discord").createRouter(x));
    app.use("/api/telegram", await new ChannelManagementRouterService("telegram").createRouter(x));

    app.use("/api/secrets", await new SecretRouterService().createRouter(x));

    app.use("/api", await new SystemContentRouterService().createRouter(x));

    app.use("/api/memory", await new MemoryRouterService().createRouter(x));

    app.use("/api/file", await new FileRouterService().createRouter(x));
    app.use("/api/attachments", await new AttachmentUploadRouterService().createRouter(x));

    app.use("/api/ask", await new AskApiRouterService().createRouter(x));

    app.use("/api/chat", await new DashboardChatRouterService().createRouter(x));
    app.use("/api/voice", await new VoiceRouterService().createRouter(x));

    app.use("/api/apps", await new AppRouterService().createRouter(x));

    app.use("/api/drive", await new DriveRouterService().createRouter(x));

    app.use("/api/logs", await new TraceRouterService().createRouter(x));

    app.use("/api/pi-sessions", await new PiSessionRouterService().createRouter(x));

    // Serve the React app for all other routes
    app.use((req, res) => {
      res.sendFile(path.join(__dirname, "../../../../dashboard/dist/index.html"));
    });
  }

  async start(x: Context): Promise<void> {
    if (this.server) return;
    const app = express();
    await this.setupExpress(x, app);
    this.server = createServer(app);
    return new Promise((resolve) => {
      this.server?.listen(this.port, () => {
        console.log(`📊 Dashboard running at http://localhost:${this.port}`);
        resolve();
      });
    });
  }

  async stop(_x: Context): Promise<void> {
    const server = this.server;
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    this.server = undefined;
  }

  async listen(x: Context, onEvent: (event: InboundEvent) => void): Promise<() => void> {
    xDashboardChatService(x).configure(x, onEvent);
    return () => {
      xDashboardChatService(x).configure(x, undefined);
    };
  }

  createOutputHandler(_x: Context, _event: InboundEvent): OutputHandler {
    return new DashboardOutputHandler();
  }
}

class DashboardOutputHandler implements OutputHandler {
  async relay(): Promise<void> {
    // no-op — frontend polls from DB
  }
}
