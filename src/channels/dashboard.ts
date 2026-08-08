import type {
  Channel,
  InboundEvent,
  OutputHandler,
} from "../types.js";
import type { Context } from "../context/Context.js";
import { xSecretService, xSessionStore, xVitoService } from "../lib/x.js";
import { createAppProxyMiddleware } from "../routers/apps/app-proxy.js";
import { createAppRouter } from "../routers/apps/app-router.js";
import { createConfigRouter } from "../routers/config/config-router.js";
import { createCronRouter } from "../routers/cron/cron-router.js";
import {
  createDriveRouter,
  createPublicDriveRouter,
  isPublicDriveFile,
} from "../routers/drive/drive-router.js";
import { createMemoryRouter } from "../routers/memory/memory-router.js";
import { createPiSessionRouter } from "../routers/pi-sessions/pi-session-router.js";
import { createSecretRouter } from "../routers/secrets/secret-router.js";
import { createSessionRouter } from "../routers/sessions/session-router.js";
import { createSkillRouter } from "../routers/skills/skill-router.js";
import { createTraceRouter } from "../routers/traces/trace-router.js";
import express from "express";
import http from "http";
const createServer = http.createServer.bind(http);
import path from "path";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { getProviders, getModels } from "@earendil-works/pi-ai/compat";
import { getOAuthProviders } from "@earendil-works/pi-ai/oauth";
import { AuthStorage } from "@earendil-works/pi-coding-agent";
import { mountMcp } from "../mcp-server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ATTACHMENTS_DIR = path.join(process.cwd(), "data", "attachments");

// ── Auth helpers ──

const SESSION_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
const sessions = new Map<string, { expires: number }>();

// Simple login rate limiter: max 5 failed attempts per IP per 15 minutes
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function checkLoginRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return true;
  }
  if (entry.count >= LOGIN_MAX_ATTEMPTS) return false;
  entry.count++;
  return true;
}

function resetLoginAttempts(ip: string): void {
  loginAttempts.delete(ip);
}

function buildSessionCookie(sessionId: string, maxAge: number, req: any): string {
  const host = (req.headers?.host || "").split(":")[0];
  const isLocal = host === "localhost" || host === "127.0.0.1";
  const secure = isLocal ? "" : " Secure;";
  return `session=${sessionId}; HttpOnly; Path=/; SameSite=Lax;${secure} Max-Age=${maxAge}`;
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(derived, "hex"));
}

function parseCookie(cookieHeader: string | undefined, name: string): string {
  if (!cookieHeader) return "";
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

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

  private discordChannel?: {
    registerSlashCommands: () => Promise<{ success: boolean; count: number; error?: string }>;
    getChannelInfo: (channelId: string) => Promise<{ name: string; guildName?: string } | null>;
  };
  private telegramChannel?: {
    setMyCommands: () => Promise<{ success: boolean; count: number; error?: string }>;
    getChatInfo: (chatId: string) => Promise<{ name: string; type: string } | null>;
  };
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

  setDiscordChannel(discord: {
    registerSlashCommands: () => Promise<{ success: boolean; count: number; error?: string }>;
    getChannelInfo: (channelId: string) => Promise<{ name: string; guildName?: string } | null>;
  }) {
    this.discordChannel = discord;
  }

  setTelegramChannel(telegram: {
    setMyCommands: () => Promise<{ success: boolean; count: number; error?: string }>;
    getChatInfo: (chatId: string) => Promise<{ name: string; type: string } | null>;
  }) {
    this.telegramChannel = telegram;
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

    // Ensure attachments dir exists (served behind auth below)
    if (!existsSync(ATTACHMENTS_DIR)) mkdirSync(ATTACHMENTS_DIR, { recursive: true });

    // Public drive files and hosted sites are resolved through DriveStore.
    this.app.use("/d", createPublicDriveRouter(this.x));

    // ── Auth routes (before middleware) ──

    this.app.get("/api/auth/check", (req, res) => {
      const passwordSet = Boolean(secretService.get(this.x, "DASHBOARD_PASSWORD_HASH"));
      if (!passwordSet) {
        res.json({ authenticated: false, passwordSet: false });
        return;
      }
      const sessionId = parseCookie(req.headers.cookie, "session");
      const session = sessions.get(sessionId);
      const authenticated = Boolean(session && session.expires > Date.now());
      res.json({ authenticated, passwordSet: true });
    });

    this.app.post("/api/auth/setup", (req, res) => {
      if (secretService.get(this.x, "DASHBOARD_PASSWORD_HASH")) {
        res.status(400).json({ error: "Password already set. Use login instead." });
        return;
      }
      // Auto-generate a UUID password
      const password = crypto.randomUUID();
      secretService.set(this.x, {
        key: "DASHBOARD_PASSWORD_HASH",
        value: hashPassword(password),
      });
      // Auto-login after setup
      const sessionId = crypto.randomUUID();
      sessions.set(sessionId, { expires: Date.now() + SESSION_TTL });
      res.setHeader("Set-Cookie", buildSessionCookie(sessionId, SESSION_TTL / 1000, req));
      res.json({ ok: true, password });
    });

    this.app.post("/api/auth/login", (req, res) => {
      const clientIp = req.ip || req.socket.remoteAddress || "unknown";
      if (!checkLoginRateLimit(clientIp)) {
        res.status(429).json({ error: "Too many login attempts. Try again in 15 minutes." });
        return;
      }

      const hash = secretService.get(this.x, "DASHBOARD_PASSWORD_HASH");
      if (!hash) {
        res.status(400).json({ error: "No password set. Use setup first." });
        return;
      }
      const { password } = req.body;
      if (!password || !verifyPassword(password, hash)) {
        res.status(401).json({ error: "Invalid password" });
        return;
      }
      resetLoginAttempts(clientIp);
      const sessionId = crypto.randomUUID();
      sessions.set(sessionId, { expires: Date.now() + SESSION_TTL });
      res.setHeader("Set-Cookie", buildSessionCookie(sessionId, SESSION_TTL / 1000, req));
      res.json({ ok: true });
    });

    this.app.post("/api/auth/logout", (req, res) => {
      const sessionId = parseCookie(req.headers.cookie, "session");
      if (sessionId) sessions.delete(sessionId);
      res.setHeader("Set-Cookie", buildSessionCookie("", 0, req));
      res.json({ ok: true });
    });

    // ── Auth middleware (protects all /api/* routes below) ──

    this.app.use("/api", (req, res, next) => {
      // Auth endpoints handled above
      if (req.path.startsWith("/auth")) return next();
      // Health check is public
      if (req.path === "/health") return next();
      // /api/ask has its own Bearer token auth via VITO_ASK_API_KEY
      if (req.path === "/ask") return next();

      // Do NOT bypass auth for localhost. Behind a reverse proxy (Caddy/Nginx),
      // external public requests arrive at Express from 127.0.0.1/::1.

      // If no password is set, only auth/setup is public. Do not expose APIs during first-time setup.
      if (!secretService.get(this.x, "DASHBOARD_PASSWORD_HASH")) {
        res.status(403).json({ error: "Dashboard password not set. Complete /api/auth/setup first." });
        return;
      }

      // Public Drive files may bypass dashboard authentication.
      if (req.path.startsWith("/drive/file/")) {
        const encodedPath = req.path.slice("/drive/file/".length);
        try {
          if (isPublicDriveFile(this.x, decodeURIComponent(encodedPath))) return next();
        } catch {
          // Invalid URL encoding is handled as an unauthenticated request.
        }
      }

      // Check session cookie
      const sessionId = parseCookie(req.headers.cookie, "session");
      const session = sessions.get(sessionId);
      if (!session || session.expires < Date.now()) {
        if (req.path.startsWith("/drive/file/")) {
          const returnTo = encodeURIComponent(req.originalUrl);
          res.redirect(302, `/?returnTo=${returnTo}`);
          return;
        }
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      next();
    });

    // Serve uploaded attachments (auth-gated)
    this.app.use("/attachments", (req, res, next) => {
      // No localhost bypass: reverse-proxied public requests appear local.
      if (!secretService.get(this.x, "DASHBOARD_PASSWORD_HASH")) {
        res.status(403).json({ error: "Dashboard password not set. Complete /api/auth/setup first." });
        return;
      }
      const sessionId = parseCookie(req.headers.cookie, "session");
      const session = sessions.get(sessionId);
      if (!session || session.expires < Date.now()) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      next();
    }, express.static(ATTACHMENTS_DIR));

    // API endpoints
    this.app.get("/api/health", (req, res) => {
      res.json({ status: "ok", timestamp: new Date().toISOString() });
    });

    this.app.use("/api", createConfigRouter(this.x));

    // Model discovery endpoints
    this.app.get("/api/models/providers", (req, res) => {
      try {
        const providers = getProviders();
        const keyStatus = secretService.getProviderKeyStatus(this.x);
        const authStatus = secretService.getProviderAuthStatus(this.x);
        // Include OAuth provider metadata so the frontend knows which providers support subscription login
        const oauthProviders = getOAuthProviders().map(p => ({ id: p.id, name: p.name }));
        res.json({
          providers,
          keyStatus,
          authStatus,
          keyInfo: secretService.getProviderApiKeyInfo(this.x),
          oauthProviders,
        });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    this.app.get("/api/models/:provider", (req, res) => {
      try {
        const models = getModels(req.params.provider as any);
        res.json(models.map((m: any) => ({ id: m.id })));
      } catch (err: any) {
        res.status(400).json({ error: `Unknown provider: ${req.params.provider}` });
      }
    });

    // OAuth login/logout endpoints for subscription-based providers
    // Tracks in-progress login flows so the frontend can poll for completion
    const pendingLogins = new Map<string, {
      status: "pending" | "prompt" | "success" | "error";
      error?: string;
      promptMessage?: string;
      resolvePrompt?: (value: string) => void;
    }>();

    this.app.post("/api/auth/provider/:id/login", (req, res) => {
      const providerId = req.params.id;

      // Check if already logged in
      const piAuth = secretService.getPiAuth(this.x);
      if (piAuth[providerId]?.type === "oauth" && piAuth[providerId]?.access) {
        res.json({ status: "already_authenticated" });
        return;
      }

      // Check if a login is already in progress
      const existingLogin = pendingLogins.get(providerId);
      if (existingLogin?.status === "pending" || existingLogin?.status === "prompt") {
        res.status(409).json({ error: "Login already in progress" });
        return;
      }

      pendingLogins.set(providerId, { status: "pending" });

      const authStorage = AuthStorage.create();
      let responseSent = false;

      // Start login flow - returns immediately with the URL/device code.
      // Keep this as a variable instead of an inline object so newer pi-ai
      // callback fields can exist without breaking older installed types.
      const loginCallbacks = {
        onAuth: (info: { url: string; instructions?: string }) => {
          if (responseSent) return;
          responseSent = true;
          // Send URL back to frontend immediately
          res.json({ status: "login_started", url: info.url, instructions: info.instructions });
        },
        onDeviceCode: (info: {
          userCode: string;
          verificationUri: string;
          intervalSeconds?: number;
          expiresInSeconds?: number;
        }) => {
          if (responseSent) return;
          responseSent = true;
          res.json({
            status: "device_code_started",
            userCode: info.userCode,
            verificationUri: info.verificationUri,
            intervalSeconds: info.intervalSeconds,
            expiresInSeconds: info.expiresInSeconds,
          });
        },
        onSelect: async (info: { options: Array<{ id: string; label: string }> }) => {
          // The dashboard runs on a remote server, so browser OAuth redirecting
          // to localhost would target the user's laptop, not the EC2 instance.
          // Prefer device-code auth when providers offer it.
          const deviceOption = info.options.find((option) => /device|code/i.test(`${option.id} ${option.label}`));
          return deviceOption?.id ?? info.options[0]?.id;
        },
        onPrompt: async (info: { message: string }) => {
          return new Promise<string>((resolve) => {
            pendingLogins.set(providerId, {
              status: "prompt",
              promptMessage: info.message,
              resolvePrompt: resolve,
            });
          });
        },
        onManualCodeInput: async () => {
          return new Promise<string>((resolve) => {
            pendingLogins.set(providerId, {
              status: "prompt",
              promptMessage: "After the browser redirects to localhost, copy the full redirected URL and paste it here:",
              resolvePrompt: resolve,
            });
          });
        },
        onProgress: (message: string) => {
          console.log(`[oauth/${providerId}] ${message}`);
        },
      };

      authStorage.login(providerId, loginCallbacks).then(() => {
        pendingLogins.set(providerId, { status: "success" });
        console.log(`[oauth/${providerId}] Login successful`);
      }).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        pendingLogins.set(providerId, { status: "error", error: message });
        console.error(`[oauth/${providerId}] Login failed:`, message);
        // If we haven't sent a response yet, send error
        if (!responseSent) {
          responseSent = true;
          res.status(500).json({ error: message });
        }
      });
    });

    this.app.get("/api/auth/provider/:id/login/status", (_req, res) => {
      const providerId = _req.params.id;
      const pending = pendingLogins.get(providerId);
      if (!pending) {
        // Check if already authenticated
        const piAuth = secretService.getPiAuth(this.x);
        if (piAuth[providerId]?.type === "oauth" && piAuth[providerId]?.access) {
          res.json({ status: "success" });
        } else {
          res.json({ status: "none" });
        }
        return;
      }
      const { resolvePrompt, ...safePending } = pending;
      res.json(safePending);
      // Clean up completed statuses after they've been read
      if (pending.status !== "pending" && pending.status !== "prompt") {
        pendingLogins.delete(providerId);
      }
    });

    this.app.post("/api/auth/provider/:id/login/prompt", express.json(), (req, res) => {
      const providerId = req.params.id;
      const pending = pendingLogins.get(providerId);
      if (!pending || pending.status !== "prompt" || !pending.resolvePrompt) {
        res.status(409).json({ error: "No login prompt is waiting for this provider" });
        return;
      }
      const value = typeof req.body?.value === "string" ? req.body.value.trim() : "";
      if (!value) {
        res.status(400).json({ error: "Missing prompt value" });
        return;
      }
      pending.resolvePrompt(value);
      pendingLogins.set(providerId, { status: "pending" });
      res.json({ status: "submitted" });
    });

    this.app.post("/api/auth/provider/:id/logout", (_req, res) => {
      const providerId = _req.params.id;
      try {
        const authStorage = AuthStorage.create();
        authStorage.logout(providerId);
        res.json({ status: "logged_out" });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    this.app.use("/api/sessions", createSessionRouter(this.x));

    this.app.use("/api/skills", createSkillRouter(this.x));

    this.app.use("/api/cron", createCronRouter(this.x));

    // Discord slash command registration
    this.app.post("/api/discord/register-commands", async (req, res) => {
      if (!this.discordChannel) {
        res.status(400).json({ success: false, error: "Discord channel not configured" });
        return;
      }
      try {
        const result = await this.discordChannel.registerSlashCommands();
        res.json(result);
      } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // Auto-generate aliases for Discord sessions that don't have one
    this.app.post("/api/discord/auto-alias", async (req, res) => {
      if (!this.discordChannel) {
        res.status(400).json({ success: false, error: "Discord channel not configured" });
        return;
      }
      try {
        // Get all Discord sessions without aliases
        const sessions = xSessionStore(this.x).list(this.x, {
          channels: ["discord"],
          hasAlias: false,
        });
        
        const updated: string[] = [];
        const failed: string[] = [];
        
        for (const session of sessions) {
          const channelId = session.channel_target;
          if (!channelId) {
            failed.push(session.id);
            continue;
          }
          const info = await this.discordChannel.getChannelInfo(channelId);
          
          if (info) {
            // Format alias: "guild-name / channel-name" or just the name for DMs
            const alias = info.guildName 
              ? `${info.guildName} / ${info.name}`
              : info.name;
            
            xSessionStore(this.x).update(this.x, {
              id: session.id,
              changes: { alias },
            });
            updated.push(session.id);
          } else {
            failed.push(session.id);
          }
        }
        
        res.json({ 
          success: true, 
          updated: updated.length, 
          failed: failed.length,
          sessions: { updated, failed }
        });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // Telegram bot command registration
    this.app.post("/api/telegram/register-commands", async (req, res) => {
      if (!this.telegramChannel) {
        res.status(400).json({ success: false, error: "Telegram channel not configured" });
        return;
      }
      try {
        const result = await this.telegramChannel.setMyCommands();
        res.json(result);
      } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // Auto-generate aliases for Telegram sessions that don't have one
    this.app.post("/api/telegram/auto-alias", async (req, res) => {
      if (!this.telegramChannel) {
        res.status(400).json({ success: false, error: "Telegram channel not configured" });
        return;
      }
      try {
        // Get all Telegram sessions without aliases
        const sessions = xSessionStore(this.x).list(this.x, {
          channels: ["telegram"],
          hasAlias: false,
        });
        
        const updated: string[] = [];
        const failed: string[] = [];
        
        for (const session of sessions) {
          // Session key formats:
          // - "telegram:chatId" (DM or regular group)
          // - "telegram:chatId:threadId" (forum topic)
          const parts = session.id.split(":");
          const chatId = parts[1];
          const threadId = parts[2]; // undefined for non-topic sessions
          
          const info = await this.telegramChannel.getChatInfo(chatId);
          
          if (info) {
            // Format alias based on type and whether it's a topic
            // All Telegram aliases prefixed with "telegram:" for consistency
            let alias: string;
            if (info.type === "private") {
              alias = `telegram: DM: ${info.name}`;
            } else if (threadId) {
              // Forum topic - we can't easily get topic names via API,
              // so we show "telegram: GroupName / Topic"
              alias = `telegram: ${info.name} / Topic`;
            } else {
              alias = `telegram: ${info.name}`;
            }
            
            xSessionStore(this.x).update(this.x, {
              id: session.id,
              changes: { alias },
            });
            updated.push(session.id);
          } else {
            failed.push(session.id);
          }
        }
        
        res.json({ 
          success: true, 
          updated: updated.length, 
          failed: failed.length,
          sessions: { updated, failed }
        });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    this.app.use("/api/secrets", createSecretRouter(this.x));

    this.app.get("/api/jobs", (_req, res) => {
      res.json(xVitoService(this.x).getConfiguredJobs(this.x));
    });

    // Soul and System prompt endpoints
    this.app.get("/api/soul", (_req, res) => {
      res.json({ content: xVitoService(this.x).getSoul(this.x) });
    });

    this.app.put("/api/soul", (req, res) => {
      const { content } = req.body;
      xVitoService(this.x).saveSoul(this.x, content);
      res.json({ content });
    });

    this.app.get("/api/system-prompt", (req, res) => {
      const systemPath = path.join(process.cwd(), "SYSTEM.md");
      if (!existsSync(systemPath)) {
        res.json({ content: "" });
        return;
      }
      res.json({ content: readFileSync(systemPath, "utf-8") });
    });

    this.app.put("/api/system-prompt", (req, res) => {
      const systemPath = path.join(process.cwd(), "SYSTEM.md");
      const { content } = req.body;
      writeFileSync(systemPath, content, "utf-8");
      res.json({ content });
    });

    this.app.use("/api/memory", createMemoryRouter(this.x));

    // Serve files from any filesystem path with proper MIME types
    this.app.get("/api/file", (req, res) => {
      const filePath = req.query.path as string;
      if (!filePath) {
        res.status(400).json({ error: "path query parameter required" });
        return;
      }
      
      // Security: resolve to absolute path and check if it exists
      const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
      if (!existsSync(resolvedPath)) {
        res.status(404).json({ error: "File not found" });
        return;
      }
      
      // Determine MIME type and disposition based on file extension
      const extension = path.extname(resolvedPath).toLowerCase();
      const filename = path.basename(resolvedPath);
      
      // MIME type mapping
      const mimeTypes: Record<string, string> = {
        // Images
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
        '.bmp': 'image/bmp',
        // Text files (render inline in browser)
        '.txt': 'text/plain',
        '.md': 'text/markdown',
        '.json': 'application/json',
        '.xml': 'application/xml',
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'text/javascript',
        '.csv': 'text/csv',
        // Documents (render inline in browser)
        '.pdf': 'application/pdf',
        // Downloadable files
        '.zip': 'application/zip',
        '.tar': 'application/x-tar',
        '.gz': 'application/gzip',
        '.exe': 'application/octet-stream',
        '.dmg': 'application/octet-stream',
      };
      
      // Files that should trigger download instead of inline display
      const downloadExtensions = ['.zip', '.tar', '.gz', '.exe', '.dmg'];
      
      const mimeType = mimeTypes[extension] || 'application/octet-stream';
      res.setHeader('Content-Type', mimeType);
      
      if (downloadExtensions.includes(extension)) {
        // Force download for certain file types
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      } else {
        // Display inline for everything else (images, text, PDF, etc.)
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
      }
      
      res.sendFile(resolvedPath);
    });

    // Upload attachments — saves to data/attachments/, returns path
    this.app.post("/api/attachments", (req, res) => {
      const { data, filename } = req.body;
      if (!data || typeof data !== "string") {
        res.status(400).json({ error: "data (base64 data URL) is required" });
        return;
      }

      // Parse data URL: data:image/webp;base64,AAAA...
      const match = data.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) {
        res.status(400).json({ error: "Invalid data URL format" });
        return;
      }

      const mimeType = match[1];
      const buffer = Buffer.from(match[2], "base64");
      const ext = mimeType.split("/")[1] || "bin";
      const id = crypto.randomUUID();
      const savedFilename = filename
        ? `${id}-${filename}`
        : `${id}.${ext}`;
      const filePath = path.join(ATTACHMENTS_DIR, savedFilename);

      if (!existsSync(ATTACHMENTS_DIR)) mkdirSync(ATTACHMENTS_DIR, { recursive: true });
      writeFileSync(filePath, buffer);

      res.json({
        path: filePath,
        url: `/attachments/${savedFilename}`,
        filename: filename || `${id}.${ext}`,
        mimeType,
      });
    });

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
