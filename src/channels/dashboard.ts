import type {
  Channel,
  InboundEvent,
  OutputHandler,
} from "../types.js";
import type { Context } from "../context/Context.js";
import { xChannelManagementService, xSecretService, xVitoService } from "../lib/x.js";
import { createAppProxyMiddleware } from "../routers/apps/app-proxy.js";
import { createAppRouter } from "../routers/apps/app-router.js";
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
import { createConfigRouter } from "../routers/config/config-router.js";
import { createCronRouter } from "../routers/cron/cron-router.js";
import {
  createDriveRouter,
  createPublicDriveRouter,
  isPublicDriveFile,
} from "../routers/drive/drive-router.js";
import { createFileRouter } from "../routers/files/file-router.js";
import { createMemoryRouter } from "../routers/memory/memory-router.js";
import { createPiSessionRouter } from "../routers/pi-sessions/pi-session-router.js";
import {
  createModelRouter,
  createProviderAuthRouter,
} from "../routers/providers/provider-router.js";
import { createSecretRouter } from "../routers/secrets/secret-router.js";
import { createSessionRouter } from "../routers/sessions/session-router.js";
import { createSkillRouter } from "../routers/skills/skill-router.js";
import { createSystemContentRouter } from "../routers/system-content/system-content-router.js";
import { createTraceRouter } from "../routers/traces/trace-router.js";
import express from "express";
import http from "http";
const createServer = http.createServer.bind(http);
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { mountMcp } from "../mcp-server.js";
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
  private eventHandler?: (event: InboundEvent) => void;

  private askHandler?: (options: {
    question: string;
    session?: string;
    author?: string;
    channelPrompt?: string;
    timeoutMs?: number | null;
    relayToSession?: boolean;
  }) => Promise<string>;

  constructor(private readonly x: Context) {
    this.setupExpress();
  }

  setDiscordChannel(discord: DiscordManagementAdapter) {
    xChannelManagementService(this.x).configure(this.x, {
      channel: "discord",
      adapter: discord,
    });
  }

  setTelegramChannel(telegram: TelegramManagementAdapter) {
    xChannelManagementService(this.x).configure(this.x, {
      channel: "telegram",
      adapter: telegram,
    });
  }

  setAskHandler(handler: (options: {
    question: string;
    session?: string;
    author?: string;
    channelPrompt?: string;
    timeoutMs?: number | null;
    relayToSession?: boolean;
  }) => Promise<string>) {
    this.askHandler = handler;
  }

  private setupExpress() {
    const secretService = xSecretService(this.x);
    // Must precede body parsing so request bodies can stream to app processes.
    this.app.use(createAppProxyMiddleware(this.x));

    this.app.use(express.json({ limit: "200mb" }));
    this.app.use(express.static(path.join(__dirname, "../../dashboard/dist")));

    // ── MCP routes (before auth — has its own OAuth bearer auth) ──
    // Mounted only if MCP_CLIENT_ID + MCP_CLIENT_SECRET are set in user/secrets.json.
    // Only the pre-registered static client (Claude) can authorize — no dynamic
    // registration, no password-based browser login, no URL path-token bypass.
    const mcpClientId = process.env.MCP_CLIENT_ID;
    const mcpClientSecret = process.env.MCP_CLIENT_SECRET;
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
    this.app.get("/api/health", (req, res) => {
      res.json({ status: "ok", timestamp: new Date().toISOString() });
    });

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

    // ── Public Ask API ──
    // External integrations (Bland.ai phone, webhooks, etc.) call this to get a response.
    // Routes through the full orchestrator pipeline: system prompt, memories, skills, tools.
    this.app.post("/api/ask", async (req, res) => {
      // Authenticate with Bearer token from secrets
      const apiKey = secretService.get(this.x, "VITO_ASK_API_KEY");
      if (!apiKey) {
        res.status(503).json({ error: "Ask API is disabled — no VITO_ASK_API_KEY configured" });
        return;
      }
      const authHeader = req.headers.authorization || "";
      const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
      if (!token || token !== apiKey) {
        res.status(401).json({ error: "Unauthorized — invalid or missing API key" });
        return;
      }

      if (!this.askHandler) {
        res.status(503).json({ error: "Ask handler not configured" });
        return;
      }

      const { question, session, author, channelPrompt, timeoutMs, relayToSession } = req.body;
      if (!question || typeof question !== "string") {
        res.status(400).json({ error: "Missing or invalid 'question' field" });
        return;
      }

      const start = Date.now();
      console.log(`[Dashboard] /api/ask request: session=${session || "api:default"} question="${question.slice(0, 80)}"`);

      try {
        const answer = await this.askHandler({
          question,
          session: session || undefined,
          author: author || undefined,
          channelPrompt: channelPrompt || undefined,
          timeoutMs: typeof timeoutMs === "number" ? timeoutMs : undefined,
          relayToSession: relayToSession === true,
        });
        const elapsed = Date.now() - start;
        console.log(`[Dashboard] /api/ask response (${elapsed}ms): "${answer.slice(0, 100)}"`);
        res.json({ answer, elapsed });
      } catch (err: any) {
        console.error(`[Dashboard] /api/ask error:`, err);
        res.status(500).json({ error: "Failed to process question", answer: "I hit a snag. Try again." });
      }
    });

    // HTTP fallback for sending chat messages (when WebSocket is dead)
    this.app.post("/api/chat", (req, res) => {
      const msg = req.body as any; // Using any to handle extra fields like attachments
      console.log(`[Dashboard] HTTP chat received: content=${msg.content?.substring(0, 50)}`);

      if (msg.type === "chat" && (msg.content || msg.attachments?.length) && this.eventHandler) {
        const sessionId = msg.sessionId || "dashboard:default";
        const parts = sessionId.split(":");
        const target = parts.length > 1 ? parts.slice(1).join(":") : "default";

        const event: InboundEvent = {
          sessionKey: sessionId,
          channel: "dashboard",
          target: target,
          author: "user",
          timestamp: Date.now(),
          content: msg.content || "",
          attachments: msg.attachments,
          raw: msg,
          hasMention: true,  // Dashboard is always direct conversation
        };
        this.eventHandler(event);
        res.json({ ok: true });
      } else {
        res.status(400).json({ error: "Invalid chat message or no handler" });
      }
    });

    // Server restart endpoint
    this.app.post("/api/server/restart", (req, res) => {
      const clientIp = (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress;
      const ua = req.headers["user-agent"] || "unknown";
      console.log(`[Dashboard] Server restart requested from ${clientIp} ua=${ua}`);
      res.json({ ok: true, message: "Rebuilding dashboard and restarting server..." });
      // Give the response time to flush, then rebuild dashboard + restart via PM2
      setTimeout(() => {
        try {
          execSync("npm run build:dashboard", {
            stdio: "ignore",
            timeout: 120000,
            env: { ...process.env, PATH: process.env.PATH + ":/usr/local/bin:/opt/homebrew/bin" },
          });
        } catch (e) {
          // If build fails, still attempt restart
        }

        try {
          execSync("npx pm2 restart vito-server", {
            stdio: "ignore",
            env: { ...process.env, PATH: process.env.PATH + ":/usr/local/bin:/opt/homebrew/bin" },
          });
        } catch (e) {
          // Process is already dying at this point
        }
      }, 500);
    });

    // Server status/info endpoint
    this.app.get("/api/server/status", (req, res) => {
      res.json({
        uptime: process.uptime(),
        pid: process.pid,
        nodeVersion: process.version,
        memoryUsage: process.memoryUsage(),
      });
    });

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
    this.eventHandler = onEvent;
    return () => {
      this.eventHandler = undefined;
    };
  }

  createHandler(event: InboundEvent): OutputHandler {
    return new DashboardOutputHandler(event);
  }

  getSessionKey(payload: any): string {
    return payload.sessionId || "dashboard:default";
  }
}

class DashboardOutputHandler implements OutputHandler {
  constructor(private event: InboundEvent) {}

  async relay(): Promise<void> {
    // no-op — frontend polls from DB
  }
}

// Secrets helpers now live in ../secrets.ts
