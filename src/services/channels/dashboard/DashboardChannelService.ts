import type { InboundEvent, OutputHandler } from "../../../types.js";
import type { ChannelService } from "../ChannelService.js";
import type { Context } from "../../../context/Context.js";
import {
  xDashboardChatService,
  xSecretService,
  xVitoService,
} from "../../../lib/x.js";
import { createAppProxyMiddleware } from "../../../routers/apps/app-proxy.js";
import { createAppRouter } from "../../../routers/apps/app-router.js";
import { createAskApiRouter } from "../../../routers/ask/ask-api-router.js";
import {
  createAttachmentFileRouter,
  createAttachmentUploadRouter,
} from "../../../routers/attachments/attachment-router.js";
import {
  createAttachmentAuthMiddleware,
  createDashboardApiAuthMiddleware,
} from "../../../routers/auth/dashboard-auth-middleware.js";
import { createDashboardAuthRouter } from "../../../routers/auth/dashboard-auth-router.js";
import { createChannelManagementRouter } from "../../../routers/channels/channel-management-router.js";
import { createDashboardChatRouter } from "../../../routers/chat/dashboard-chat-router.js";
import { createConfigRouter } from "../../../routers/config/config-router.js";
import { createCronRouter } from "../../../routers/cron/cron-router.js";
import {
  createDriveRouter,
  createPublicDriveRouter,
} from "../../../routers/drive/drive-router.js";
import { createFileRouter } from "../../../routers/files/file-router.js";
import { createMemoryRouter } from "../../../routers/memory/memory-router.js";
import { createPiSessionRouter } from "../../../routers/pi-sessions/pi-session-router.js";
import {
  createModelRouter,
  createProviderAuthRouter,
} from "../../../routers/providers/provider-router.js";
import { createSecretRouter } from "../../../routers/secrets/secret-router.js";
import { createServerLifecycleRouter } from "../../../routers/server/server-lifecycle-router.js";
import { createSessionRouter } from "../../../routers/sessions/session-router.js";
import { createSkillRouter } from "../../../routers/skills/skill-router.js";
import { createSystemContentRouter } from "../../../routers/system-content/system-content-router.js";
import { createTraceRouter } from "../../../routers/traces/trace-router.js";
import express from "express";
import http from "node:http";
const createServer = http.createServer.bind(http);
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mountMcp } from "../../../mcp-server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

  private setupExpress(x: Context, app: express.Express): void {
    // Must precede body parsing so request bodies can stream to app processes.
    app.use(createAppProxyMiddleware(x));

    app.use(express.json({ limit: "200mb" }));
    app.use(express.static(path.join(__dirname, "../../../../dashboard/dist")));

    // ── MCP routes (before auth — has its own OAuth bearer auth) ──
    // Mounted only if MCP_CLIENT_ID + MCP_CLIENT_SECRET are set in user/secrets.json.
    // Only the pre-registered static client (Claude) can authorize — no dynamic
    // registration, no password-based browser login, no URL path-token bypass.
    const secretService = xSecretService(x);
    const mcpClientId = secretService.get(x, "MCP_CLIENT_ID");
    const mcpClientSecret = secretService.get(x, "MCP_CLIENT_SECRET");
    if (mcpClientId && mcpClientSecret) {
      mountMcp(app, {
        x,
        staticClientId: mcpClientId,
        staticClientSecret: mcpClientSecret,
        botName: xVitoService(x).getConfig(x).bot?.name || "Vito",
      });
    } else {
      console.log("[MCP] not mounted (set MCP_CLIENT_ID + MCP_CLIENT_SECRET in user/secrets.json to enable).");
    }

    // Public drive files and hosted sites are resolved through DriveStore.
    app.use("/d", createPublicDriveRouter(x));

    app.use("/api/auth", createDashboardAuthRouter(x));
    app.use("/api", createDashboardApiAuthMiddleware(x));
    app.use(
      "/attachments",
      createAttachmentAuthMiddleware(x),
      createAttachmentFileRouter(x)
    );

    // API endpoints
    app.use("/api", createServerLifecycleRouter(x));

    app.use("/api", createConfigRouter(x));

    app.use("/api/models", createModelRouter(x));
    app.use("/api/auth/provider", createProviderAuthRouter(x));

    app.use("/api/sessions", createSessionRouter(x));

    app.use("/api/skills", createSkillRouter(x));

    app.use("/api/cron", createCronRouter(x));

    app.use(
      "/api/discord",
      createChannelManagementRouter(x, "discord")
    );
    app.use(
      "/api/telegram",
      createChannelManagementRouter(x, "telegram")
    );

    app.use("/api/secrets", createSecretRouter(x));

    app.use("/api", createSystemContentRouter(x));

    app.use("/api/memory", createMemoryRouter(x));

    app.use("/api/file", createFileRouter(x));
    app.use("/api/attachments", createAttachmentUploadRouter(x));

    app.use("/api/ask", createAskApiRouter(x));

    app.use("/api/chat", createDashboardChatRouter(x));

    app.use("/api/apps", createAppRouter(x));

    app.use("/api/drive", createDriveRouter(x));

    app.use("/api/logs", createTraceRouter(x));

    app.use("/api/pi-sessions", createPiSessionRouter(x));

    // Serve the React app for all other routes
    app.use((req, res) => {
      res.sendFile(path.join(__dirname, "../../../../dashboard/dist/index.html"));
    });
  }

  async start(x: Context): Promise<void> {
    if (this.server) return;
    const app = express();
    this.setupExpress(x, app);
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

  async listen(
    x: Context,
    onEvent: (event: InboundEvent) => void
  ): Promise<() => void> {
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
