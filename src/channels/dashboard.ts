import type {
  Channel,
  InboundEvent,
  OutputHandler,
} from "../types.js";
import type { Context } from "../context/Context.js";
import {
  xAskApiService,
  xChannelManagementService,
  xDashboardChatService,
  xSecretService,
  xVitoService,
} from "../lib/x.js";
import { createAppProxyMiddleware } from "../routers/apps/app-proxy.js";
import { createAppRouter } from "../routers/apps/app-router.js";
import { createAskApiRouter } from "../routers/ask/ask-api-router.js";
import {
  createAttachmentFileRouter,
  createAttachmentUploadRouter,
} from "../routers/attachments/attachment-router.js";
import {
  createAttachmentAuthMiddleware,
  createDashboardApiAuthMiddleware,
} from "../routers/auth/dashboard-auth-middleware.js";
import { createDashboardAuthRouter } from "../routers/auth/dashboard-auth-router.js";
import { createChannelManagementRouter } from "../routers/channels/channel-management-router.js";
import { createDashboardChatRouter } from "../routers/chat/dashboard-chat-router.js";
import { createConfigRouter } from "../routers/config/config-router.js";
import { createCronRouter } from "../routers/cron/cron-router.js";
import {
  createDriveRouter,
  createPublicDriveRouter,
} from "../routers/drive/drive-router.js";
import { createFileRouter } from "../routers/files/file-router.js";
import { createMemoryRouter } from "../routers/memory/memory-router.js";
import { createPiSessionRouter } from "../routers/pi-sessions/pi-session-router.js";
import {
  createModelRouter,
  createProviderAuthRouter,
} from "../routers/providers/provider-router.js";
import { createSecretRouter } from "../routers/secrets/secret-router.js";
import { createServerLifecycleRouter } from "../routers/server/server-lifecycle-router.js";
import { createSessionRouter } from "../routers/sessions/session-router.js";
import { createSkillRouter } from "../routers/skills/skill-router.js";
import { createSystemContentRouter } from "../routers/system-content/system-content-router.js";
import { createTraceRouter } from "../routers/traces/trace-router.js";
import express from "express";
import http from "http";
const createServer = http.createServer.bind(http);
import path from "path";
import { fileURLToPath } from "url";
import { mountMcp } from "../mcp-server.js";
import type { AskApiHandler } from "../services/ask/AskApiService.js";
import type {
  DiscordManagementAdapter,
  TelegramManagementAdapter,
} from "../services/channels/ChannelManagementService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class DashboardChannel implements Channel {
  name = "dashboard";
  capabilities = {
    typing: true,
    reactions: false,
    attachments: true,
    streaming: true,
  };

  private app = express();
  private server = createServer(this.app);
  private port = parseInt(process.env.PORT || "3030", 10);

  constructor(private readonly x: Context) {
    this.setupExpress();
  }

  setDiscordChannel(discord: DiscordManagementAdapter): void {
    xChannelManagementService(this.x).configure(this.x, {
      channel: "discord",
      adapter: discord,
    });
  }

  setTelegramChannel(telegram: TelegramManagementAdapter): void {
    xChannelManagementService(this.x).configure(this.x, {
      channel: "telegram",
      adapter: telegram,
    });
  }

  setAskHandler(handler: AskApiHandler): void {
    xAskApiService(this.x).configure(this.x, handler);
  }

  private setupExpress(): void {
    // Must precede body parsing so request bodies can stream to app processes.
    this.app.use(createAppProxyMiddleware(this.x));

    this.app.use(express.json({ limit: "200mb" }));
    this.app.use(express.static(path.join(__dirname, "../../dashboard/dist")));

    // ── MCP routes (before auth — has its own OAuth bearer auth) ──
    // Mounted only if MCP_CLIENT_ID + MCP_CLIENT_SECRET are set in user/secrets.json.
    // Only the pre-registered static client (Claude) can authorize — no dynamic
    // registration, no password-based browser login, no URL path-token bypass.
    const secretService = xSecretService(this.x);
    const mcpClientId = secretService.get(this.x, "MCP_CLIENT_ID");
    const mcpClientSecret = secretService.get(this.x, "MCP_CLIENT_SECRET");
    if (mcpClientId && mcpClientSecret) {
      mountMcp(this.app, {
        x: this.x,
        staticClientId: mcpClientId,
        staticClientSecret: mcpClientSecret,
        botName: xVitoService(this.x).getConfig(this.x).bot?.name || "Vito",
      });
    } else {
      console.log("[MCP] not mounted (set MCP_CLIENT_ID + MCP_CLIENT_SECRET in user/secrets.json to enable).");
    }

    // Public drive files and hosted sites are resolved through DriveStore.
    this.app.use("/d", createPublicDriveRouter(this.x));

    this.app.use("/api/auth", createDashboardAuthRouter(this.x));
    this.app.use("/api", createDashboardApiAuthMiddleware(this.x));
    this.app.use(
      "/attachments",
      createAttachmentAuthMiddleware(this.x),
      createAttachmentFileRouter(this.x)
    );

    // API endpoints
    this.app.use("/api", createServerLifecycleRouter(this.x));

    this.app.use("/api", createConfigRouter(this.x));

    this.app.use("/api/models", createModelRouter(this.x));
    this.app.use("/api/auth/provider", createProviderAuthRouter(this.x));

    this.app.use("/api/sessions", createSessionRouter(this.x));

    this.app.use("/api/skills", createSkillRouter(this.x));

    this.app.use("/api/cron", createCronRouter(this.x));

    this.app.use(
      "/api/discord",
      createChannelManagementRouter(this.x, "discord")
    );
    this.app.use(
      "/api/telegram",
      createChannelManagementRouter(this.x, "telegram")
    );

    this.app.use("/api/secrets", createSecretRouter(this.x));

    this.app.use("/api", createSystemContentRouter(this.x));

    this.app.use("/api/memory", createMemoryRouter(this.x));

    this.app.use("/api/file", createFileRouter(this.x));
    this.app.use("/api/attachments", createAttachmentUploadRouter(this.x));

    this.app.use("/api/ask", createAskApiRouter(this.x));

    this.app.use("/api/chat", createDashboardChatRouter(this.x));

    this.app.use("/api/apps", createAppRouter(this.x));

    this.app.use("/api/drive", createDriveRouter(this.x));

    this.app.use("/api/logs", createTraceRouter(this.x));

    this.app.use("/api/pi-sessions", createPiSessionRouter(this.x));

    // Serve the React app for all other routes
    this.app.use((req, res) => {
      res.sendFile(path.join(__dirname, "../../dashboard/dist/index.html"));
    });
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        console.log(`📊 Dashboard running at http://localhost:${this.port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    return new Promise((resolve) => {
      this.server.close(() => resolve());
    });
  }

  async listen(
    onEvent: (event: InboundEvent) => void
  ): Promise<() => void> {
    xDashboardChatService(this.x).configure(this.x, onEvent);
    return () => {
      xDashboardChatService(this.x).configure(this.x, undefined);
    };
  }

  createHandler(_event: InboundEvent): OutputHandler {
    return new DashboardOutputHandler();
  }

  getSessionKey(event: InboundEvent): string {
    return event.sessionKey || "dashboard:default";
  }
}

class DashboardOutputHandler implements OutputHandler {
  async relay(): Promise<void> {
    // no-op — frontend polls from DB
  }
}
