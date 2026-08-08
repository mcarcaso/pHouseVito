import type {
  Channel,
  InboundEvent,
  OutputHandler,
} from "../types.js";
import type { Context } from "../context/Context.js";
import { xSessionStore, xVitoService } from "../lib/x.js";
import { createConfigRouter } from "../routers/config/config-router.js";
import { createCronRouter } from "../routers/cron/cron-router.js";
import { createMemoryRouter } from "../routers/memory/memory-router.js";
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
import { readSecrets, writeSecrets, loadSecrets, getSecretsForDashboard, SYSTEM_KEYS, PROVIDER_API_KEYS, getProviderKeyStatus, getProviderAuthStatus, readPiAuth } from "../secrets.js";
import { getProviders, getModels } from "@earendil-works/pi-ai/compat";
import { getOAuthProviders } from "@earendil-works/pi-ai/oauth";
import { AuthStorage } from "@earendil-works/pi-coding-agent";
import { mountMcp } from "../mcp-server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ATTACHMENTS_DIR = path.join(process.cwd(), "data", "attachments");
const DRIVE_DIR = path.join(process.cwd(), "user", "drive");

/** Check if a path inside DRIVE_DIR is public by walking up the directory tree.
 *  Nearest .meta.json wins. Per-file overrides in "files" map take priority.
 *  No .meta.json anywhere = private. */
function isDrivePathPublic(absPath: string): boolean {
  const isFile = existsSync(absPath) && !statSync(absPath).isDirectory();
  const fileName = isFile ? path.basename(absPath) : null;
  let dir = isFile ? path.dirname(absPath) : absPath;
  let checkedFileOverride = false;

  while (dir.startsWith(DRIVE_DIR)) {
    const metaPath = path.join(dir, ".meta.json");
    if (existsSync(metaPath)) {
      try {
        const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
        // Check per-file override (only in the file's own directory)
        if (fileName && !checkedFileOverride && meta.files?.[fileName]) {
          return Boolean(meta.files[fileName].isPublic);
        }
        return Boolean(meta.isPublic);
      } catch { return false; }
    }
    checkedFileOverride = true; // only check file overrides in immediate dir
    if (dir === DRIVE_DIR) break;
    dir = path.dirname(dir);
  }
  return false;
}

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
    // Subdomain app proxy — routes appname.basedomain requests to the app's PM2 port
    // Must be before express.json() so request body can be piped to the upstream app
    this.app.use((req, res, next) => {
      const host = (req.headers.host || "").split(":")[0]; // strip port
      // Read baseDomain from config
      let baseDomain: string | undefined;
      try {
        const config = xVitoService(this.x).getConfig(this.x);
        baseDomain = config.apps?.baseDomain;
      } catch {}
      if (!baseDomain || !host.endsWith(baseDomain)) return next();

      // Try to find the app by matching the host against known app URLs
      const appsDir = path.join(process.cwd(), "user", "apps");
      const appHost = `https://${host}`;
      let port: number | undefined;
      let found = false;

      try {
        const dirs = readdirSync(appsDir);
        for (const dir of dirs) {
          const metaPath = path.join(appsDir, dir, ".vito-app.json");
          if (!existsSync(metaPath)) continue;
          try {
            const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
            if (meta.url === appHost) {
              port = meta.port;
              found = true;
              break;
            }
          } catch {}
        }
      } catch {}

      if (!found) return next();

      const proxyReq = http.request(
        { hostname: "127.0.0.1", port, path: req.originalUrl, method: req.method, headers: req.headers },
        (proxyRes) => {
          res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
          proxyRes.pipe(res);
        }
      );
      proxyReq.on("error", () => {
        res.status(502).send("App not responding");
      });
      req.pipe(proxyReq);
    });

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

    // ── Public Drive route (before auth) ──
    // Serves any file under user/drive/ if its nearest .meta.json has isPublic:true
    this.app.get("/d/*filepath", (req, res) => {
      let reqPath = req.params.filepath.join("/");

      const resolved = path.resolve(DRIVE_DIR, reqPath);
      // Path traversal protection
      if (!resolved.startsWith(DRIVE_DIR + path.sep) && resolved !== DRIVE_DIR) {
        res.status(404).send("Not found");
        return;
      }

      // If directory, try index.html
      if (existsSync(resolved) && statSync(resolved).isDirectory()) {
        const indexPath = path.join(resolved, "index.html");
        if (existsSync(indexPath)) {
          if (!isDrivePathPublic(indexPath)) { res.status(404).send("Not found"); return; }
          res.sendFile(indexPath);
          return;
        }
        res.status(404).send("Not found");
        return;
      }

      if (!existsSync(resolved)) { res.status(404).send("Not found"); return; }
      if (!isDrivePathPublic(resolved)) { res.status(404).send("Not found"); return; }

      // Public drive files are commonly consumed by apps on subdomains.
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.sendFile(resolved);
    });

    // ── Auth routes (before middleware) ──

    this.app.get("/api/auth/check", (req, res) => {
      const secrets = readSecrets();
      const passwordSet = Boolean(secrets.DASHBOARD_PASSWORD_HASH);
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
      const secrets = readSecrets();
      if (secrets.DASHBOARD_PASSWORD_HASH) {
        res.status(400).json({ error: "Password already set. Use login instead." });
        return;
      }
      // Auto-generate a UUID password
      const password = crypto.randomUUID();
      secrets.DASHBOARD_PASSWORD_HASH = hashPassword(password);
      writeSecrets(secrets);
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

      const secrets = readSecrets();
      const hash = secrets.DASHBOARD_PASSWORD_HASH;
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
      const secrets = readSecrets();
      if (!secrets.DASHBOARD_PASSWORD_HASH) {
        res.status(403).json({ error: "Dashboard password not set. Complete /api/auth/setup first." });
        return;
      }

      // Public Drive files must bypass auth before the protected file route runs.
      // The route itself still resolves/sends the file safely under DRIVE_DIR.
      if (req.path.startsWith("/drive/file/")) {
        const relPath = req.path.slice("/drive/file/".length);
        const resolved = path.resolve(DRIVE_DIR, relPath);
        if (
          resolved.startsWith(DRIVE_DIR + path.sep) &&
          existsSync(resolved) &&
          !statSync(resolved).isDirectory() &&
          isDrivePathPublic(resolved)
        ) {
          return next();
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
      const secrets = readSecrets();
      if (!secrets.DASHBOARD_PASSWORD_HASH) {
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
        const keyStatus = getProviderKeyStatus();
        const authStatus = getProviderAuthStatus();
        // Include OAuth provider metadata so the frontend knows which providers support subscription login
        const oauthProviders = getOAuthProviders().map(p => ({ id: p.id, name: p.name }));
        res.json({
          providers,
          keyStatus,
          authStatus,
          keyInfo: PROVIDER_API_KEYS,
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
      const piAuth = readPiAuth();
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
        const piAuth = readPiAuth();
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

    this.app.get("/api/secrets", (req, res) => {
      res.json(getSecretsForDashboard());
    });

    this.app.put("/api/secrets/:key", (req, res) => {
      const { value } = req.body;
      if (typeof value !== "string") {
        res.status(400).json({ error: "value must be a string" });
        return;
      }
      const secrets = readSecrets();
      secrets[req.params.key] = value;
      writeSecrets(secrets);
      loadSecrets();
      res.json({ key: req.params.key, value });
    });

    this.app.delete("/api/secrets/:key", (req, res) => {
      if (req.params.key in SYSTEM_KEYS) {
        res.status(400).json({ error: "Cannot delete a system key — clear its value instead" });
        return;
      }
      const secrets = readSecrets();
      delete secrets[req.params.key];
      writeSecrets(secrets);
      delete process.env[req.params.key];
      loadSecrets();
      res.status(204).end();
    });

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
      const secrets = readSecrets();
      const apiKey = secrets["VITO_ASK_API_KEY"];
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

    // List deployed apps with PM2 status
    this.app.get("/api/apps", async (req, res) => {
      try {
        const appsDir = path.join(__dirname, "../../user/apps");
        if (!existsSync(appsDir)) {
          res.json([]);
          return;
        }

        // Get PM2 process list as JSON
        let pm2Processes: any[] = [];
        try {
          const pm2Output = execSync("npx pm2 jlist", {
            timeout: 10000,
            encoding: "utf-8",
            env: { ...process.env, PATH: process.env.PATH + ":/usr/local/bin:/opt/homebrew/bin" },
          });
          pm2Processes = JSON.parse(pm2Output);
        } catch (e) {
          // PM2 unavailable, we'll just show apps without status
        }

        const appDirs = readdirSync(appsDir)
          .filter((d: string) => {
            const metaPath = path.join(appsDir, d, ".vito-app.json");
            return existsSync(metaPath);
          });

        const apps = appDirs.map((appName: string) => {
          const metaPath = path.join(appsDir, appName, ".vito-app.json");
          const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
          const pm2Name = `app-${appName}`;
          const pm2Process = pm2Processes.find(
            (p: any) => p.name === pm2Name
          );

          return {
            name: appName,
            description: meta.description || "",
            port: meta.port,
            url: meta.url || `http://localhost:${meta.port}`,
            createdAt: meta.createdAt,
            status: pm2Process?.pm2_env?.status || "unknown",
            uptime: pm2Process?.pm2_env?.pm_uptime
              ? Date.now() - pm2Process.pm2_env.pm_uptime
              : null,
            restarts: pm2Process?.pm2_env?.restart_time || 0,
            memory: pm2Process?.monit?.memory || null,
          };
        });

        res.json(apps);
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    });

    // Restart an app
    this.app.post("/api/apps/:name/restart", async (req, res) => {
      const { name } = req.params;
      const clientIp = (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress;
      const ua = req.headers["user-agent"] || "unknown";
      console.log(`[Dashboard] App restart requested: ${name} from ${clientIp} ua=${ua}`);
      try {
        const pm2Name = `app-${name}`;
        execSync(`npx pm2 restart ${pm2Name}`, {
          timeout: 30000,
          encoding: "utf-8",
          env: { ...process.env, PATH: process.env.PATH + ":/usr/local/bin:/opt/homebrew/bin" },
        });
        res.json({ success: true, message: `Restarted ${name}` });
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    });

    // Stop an app
    this.app.post("/api/apps/:name/stop", async (req, res) => {
      const { name } = req.params;
      const clientIp = (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress;
      const ua = req.headers["user-agent"] || "unknown";
      console.log(`[Dashboard] App stop requested: ${name} from ${clientIp} ua=${ua}`);
      try {
        const pm2Name = `app-${name}`;
        execSync(`npx pm2 stop ${pm2Name}`, {
          timeout: 30000,
          encoding: "utf-8",
          env: { ...process.env, PATH: process.env.PATH + ":/usr/local/bin:/opt/homebrew/bin" },
        });
        res.json({ success: true, message: `Stopped ${name}` });
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    });

    // Start a stopped app
    this.app.post("/api/apps/:name/start", async (req, res) => {
      const { name } = req.params;
      const clientIp = (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress;
      const ua = req.headers["user-agent"] || "unknown";
      console.log(`[Dashboard] App start requested: ${name} from ${clientIp} ua=${ua}`);
      try {
        const pm2Name = `app-${name}`;
        execSync(`npx pm2 start ${pm2Name}`, {
          timeout: 30000,
          encoding: "utf-8",
          env: { ...process.env, PATH: process.env.PATH + ":/usr/local/bin:/opt/homebrew/bin" },
        });
        res.json({ success: true, message: `Started ${name}` });
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    });

    // Delete an app completely
    this.app.delete("/api/apps/:name", async (req, res) => {
      const { name } = req.params;
      try {
        const appsDir = path.join(__dirname, "../../user/apps");
        const appDir = path.join(appsDir, name);
        const pm2Name = `app-${name}`;

        // Stop and delete from PM2
        try {
          execSync(`npx pm2 delete ${pm2Name}`, {
            timeout: 30000,
            encoding: "utf-8",
            env: { ...process.env, PATH: process.env.PATH + ":/usr/local/bin:/opt/homebrew/bin" },
          });
        } catch (e) {
          // Might not exist in PM2, that's fine
        }

        // Delete app directory
        if (existsSync(appDir)) {
          execSync(`rm -rf "${appDir}"`, { encoding: "utf-8" });
        }

        res.json({ success: true, message: `Deleted ${name}` });
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    });

    // Get app files
    this.app.get("/api/apps/:name/files", async (req, res) => {
      const { name } = req.params;
      try {
        const appsDir = path.join(__dirname, "../../user/apps");
        const appDir = path.join(appsDir, name);

        if (!existsSync(appDir)) {
          res.status(404).json({ error: "App not found" });
          return;
        }

        const walkDir = (dir: string, prefix = ""): { path: string; size: number; isDir: boolean }[] => {
          const entries = readdirSync(dir, { withFileTypes: true });
          const files: { path: string; size: number; isDir: boolean }[] = [];
          
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
            
            // Skip node_modules and hidden files (except .vito-app.json)
            if (entry.name === "node_modules" || (entry.name.startsWith(".") && entry.name !== ".vito-app.json")) {
              continue;
            }
            
            if (entry.isDirectory()) {
              files.push({ path: relativePath, size: 0, isDir: true });
              files.push(...walkDir(fullPath, relativePath));
            } else {
              const stats = statSync(fullPath);
              files.push({ path: relativePath, size: stats.size, isDir: false });
            }
          }
          return files;
        };

        const files = walkDir(appDir);
        res.json(files);
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    });

    // Get a specific file content
    this.app.get("/api/apps/:name/files/*filepath", async (req, res) => {
      const { name } = req.params;
      const filePath = req.params.filepath.join("/");
      try {
        const appsDir = path.join(__dirname, "../../user/apps");
        const fullPath = path.join(appsDir, name, filePath);

        // Security: ensure we're still within the app directory
        if (!fullPath.startsWith(path.join(appsDir, name))) {
          res.status(403).json({ error: "Access denied" });
          return;
        }

        if (!existsSync(fullPath)) {
          res.status(404).json({ error: "File not found" });
          return;
        }

        const stats = statSync(fullPath);
        if (stats.isDirectory()) {
          res.status(400).json({ error: "Cannot read directory" });
          return;
        }

        // Limit file size to 1MB
        if (stats.size > 1024 * 1024) {
          res.status(413).json({ error: "File too large" });
          return;
        }

        const content = readFileSync(fullPath, "utf-8");
        res.json({ content, size: stats.size });
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    });

    // ── Drive (file & site hosting) ──
    // Directory-based file browser. .meta.json at any dir level controls visibility (cascades down).

    // List contents of a directory
    this.app.get("/api/drive/ls", (req, res) => {
      try {
        const reqPath = (req.query.path as string) || "";
        const dir = path.resolve(DRIVE_DIR, reqPath);
        if (!dir.startsWith(DRIVE_DIR)) { res.status(403).json({ error: "Access denied" }); return; }
        if (!existsSync(dir) || !statSync(dir).isDirectory()) {
          // Auto-create the root
          if (dir === DRIVE_DIR) { mkdirSync(dir, { recursive: true }); }
          else { res.status(404).json({ error: "Directory not found" }); return; }
        }

        // Read .meta.json for this dir if it exists
        const metaPath = path.join(dir, ".meta.json");
        let meta: any = null;
        if (existsSync(metaPath)) {
          try { meta = JSON.parse(readFileSync(metaPath, "utf-8")); } catch {}
        }

        const entries = readdirSync(dir, { withFileTypes: true });
        const dirs: { name: string; hasMeta: boolean; meta: any }[] = [];
        const files: { name: string; size: number; isPublic: boolean; createdAt: string }[] = [];

        for (const entry of entries) {
          if (entry.name === ".meta.json") continue;
          if (entry.isDirectory()) {
            const childMetaPath = path.join(dir, entry.name, ".meta.json");
            let childMeta: any = null;
            if (existsSync(childMetaPath)) {
              try { childMeta = JSON.parse(readFileSync(childMetaPath, "utf-8")); } catch {}
            }
            dirs.push({ name: entry.name, hasMeta: Boolean(childMeta), meta: childMeta });
          } else {
            const filePath = path.join(dir, entry.name);
            const fileStat = statSync(filePath);
            const filePublic = isDrivePathPublic(filePath);
            files.push({ name: entry.name, size: fileStat.size, isPublic: filePublic, createdAt: fileStat.birthtime.toISOString() });
          }
        }

        dirs.sort((a, b) => a.name.localeCompare(b.name));
        files.sort((a, b) => a.name.localeCompare(b.name));

        const isPublic = isDrivePathPublic(dir);

        res.json({ path: reqPath, meta, isPublic, dirs, files });
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    });

    // Upload a file into a directory
    this.app.post("/api/drive/upload", (req, res) => {
      try {
        const { data, filename, folder } = req.body;
        if (!data || !filename) {
          res.status(400).json({ error: "data and filename are required" });
          return;
        }

        const match = data.match(/^data:([^;]+);base64,(.+)$/);
        if (!match) { res.status(400).json({ error: "Invalid data URL format" }); return; }
        const buffer = Buffer.from(match[2], "base64");

        const targetDir = folder ? path.resolve(DRIVE_DIR, folder) : DRIVE_DIR;
        if (!targetDir.startsWith(DRIVE_DIR)) { res.status(403).json({ error: "Access denied" }); return; }
        mkdirSync(targetDir, { recursive: true });

        const filePath = path.join(targetDir, filename);
        writeFileSync(filePath, buffer);
        res.json({ success: true, path: folder ? `${folder}/${filename}` : filename });
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    });

    // Upload a zip site into a directory
    this.app.post("/api/drive/upload-site", (req, res) => {
      try {
        const { data, folder } = req.body;
        if (!data || !folder) {
          res.status(400).json({ error: "data and folder are required" });
          return;
        }

        const match = data.match(/^data:([^;]+);base64,(.+)$/);
        if (!match) { res.status(400).json({ error: "Invalid data URL format" }); return; }
        const buffer = Buffer.from(match[2], "base64");

        const targetDir = path.resolve(DRIVE_DIR, folder);
        if (!targetDir.startsWith(DRIVE_DIR)) { res.status(403).json({ error: "Access denied" }); return; }
        mkdirSync(targetDir, { recursive: true });

        const zipPath = path.join(targetDir, "__upload.zip");
        writeFileSync(zipPath, buffer);

        try {
          execSync(`unzip -o "${zipPath}" -d "${targetDir}"`, { timeout: 30000 });
        } catch {
          execSync(`rm -rf "${targetDir}"`);
          res.status(400).json({ error: "Failed to extract zip file" });
          return;
        }
        unlinkSync(zipPath);

        // Handle single-root-dir zips
        const extracted = readdirSync(targetDir).filter(f => f !== ".meta.json");
        if (extracted.length === 1) {
          const singleEntry = path.join(targetDir, extracted[0]);
          if (statSync(singleEntry).isDirectory()) {
            for (const f of readdirSync(singleEntry)) {
              execSync(`mv "${path.join(singleEntry, f)}" "${targetDir}/"`);
            }
            execSync(`rmdir "${singleEntry}"`);
          }
        }

        if (!existsSync(path.join(targetDir, "index.html"))) {
          execSync(`rm -rf "${targetDir}"`);
          res.status(400).json({ error: "Site zip must contain an index.html" });
          return;
        }

        res.json({ success: true, path: folder });
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    });

    // Create or update .meta.json for a directory
    this.app.put("/api/drive/meta", (req, res) => {
      try {
        const reqPath = (req.query.path as string) || "";
        const dir = path.resolve(DRIVE_DIR, reqPath);
        if (!dir.startsWith(DRIVE_DIR)) { res.status(403).json({ error: "Access denied" }); return; }
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }

        const metaPath = path.join(dir, ".meta.json");
        let meta: any = {};
        if (existsSync(metaPath)) {
          try { meta = JSON.parse(readFileSync(metaPath, "utf-8")); } catch {}
        }

        const { isPublic, name, description } = req.body;
        if (isPublic !== undefined) meta.isPublic = Boolean(isPublic);
        if (name !== undefined) meta.name = name;
        if (description !== undefined) meta.description = description;

        writeFileSync(metaPath, JSON.stringify(meta, null, 2));
        res.json(meta);
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    });

    // Toggle per-file public override
    this.app.put("/api/drive/file-meta", (req, res) => {
      try {
        const reqPath = (req.query.path as string) || "";
        const filePath = path.resolve(DRIVE_DIR, reqPath);
        if (!filePath.startsWith(DRIVE_DIR + path.sep)) { res.status(403).json({ error: "Access denied" }); return; }
        if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
          res.status(404).json({ error: "File not found" });
          return;
        }

        const dir = path.dirname(filePath);
        const fileName = path.basename(filePath);
        const metaPath = path.join(dir, ".meta.json");

        let meta: any = {};
        if (existsSync(metaPath)) {
          try { meta = JSON.parse(readFileSync(metaPath, "utf-8")); } catch {}
        }

        if (!meta.files) meta.files = {};
        const { isPublic } = req.body;

        if (isPublic === undefined || isPublic === null) {
          // Remove override — fall back to dir-level
          delete meta.files[fileName];
          if (Object.keys(meta.files).length === 0) delete meta.files;
        } else {
          meta.files[fileName] = { isPublic: Boolean(isPublic) };
        }

        writeFileSync(metaPath, JSON.stringify(meta, null, 2));
        res.json({ file: fileName, isPublic: isDrivePathPublic(filePath) });
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    });

    // Delete a file or directory
    this.app.delete("/api/drive", (req, res) => {
      try {
        const reqPath = req.query.path as string;
        if (!reqPath) { res.status(400).json({ error: "path is required" }); return; }
        const target = path.resolve(DRIVE_DIR, reqPath);
        if (!target.startsWith(DRIVE_DIR + path.sep)) { res.status(403).json({ error: "Access denied" }); return; }
        if (!existsSync(target)) { res.status(404).json({ error: "Not found" }); return; }

        if (statSync(target).isDirectory()) {
          execSync(`rm -rf "${target}"`);
        } else {
          unlinkSync(target);
        }
        res.json({ success: true });
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    });

    // Serve a file from drive — public files get CORS headers for cross-origin access
    this.app.get("/api/drive/file/*filepath", (req, res) => {
      try {
        const filePath = req.params.filepath.join("/");
        const resolved = path.resolve(DRIVE_DIR, filePath);
        if (!resolved.startsWith(DRIVE_DIR + path.sep)) { res.status(403).json({ error: "Access denied" }); return; }
        if (!existsSync(resolved) || statSync(resolved).isDirectory()) {
          // Don't let Cloudflare cache 404s — file might exist soon
          res.setHeader("Cache-Control", "no-store");
          res.status(404).json({ error: "File not found" });
          return;
        }
        // Add CORS headers for public files so apps on subdomains can fetch them
        if (isDrivePathPublic(resolved)) {
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
          res.setHeader("Access-Control-Allow-Headers", "Content-Type");
        }
        res.sendFile(resolved);
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    });

    // CORS preflight for drive files
    (this.app as any).options("/api/drive/file/*filepath", (req: any, res: any) => {
      const filePath = req.params.filepath.join("/");
      const resolved = path.resolve(DRIVE_DIR, filePath);
      if (resolved.startsWith(DRIVE_DIR + path.sep) && existsSync(resolved) && isDrivePathPublic(resolved)) {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
        res.status(204).end();
      } else {
        res.status(403).end();
      }
    });

    this.app.use("/api/logs", createTraceRouter(this.x));

    // ── Pi Sessions (orchestrator v2) ──
    //
    // The v2 orchestrator persists each pi conversation as a JSONL file under
    // user/pi-sessions/<encoded-vito-session-id>/<pi-session-id>.jsonl. These
    // endpoints walk that tree so the dashboard can list and view them.

    const piSessionsRoot = path.join(process.cwd(), "user/pi-sessions");

    /** Recursively list all .jsonl files under user/pi-sessions/. Returns relative paths. */
    const listPiSessionFiles = (): { rel: string; full: string; size: number; mtime: number }[] => {
      if (!existsSync(piSessionsRoot)) return [];
      const out: { rel: string; full: string; size: number; mtime: number }[] = [];
      const walk = (dir: string, prefix: string) => {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            walk(full, rel);
          } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
            const stats = statSync(full);
            out.push({ rel, full, size: stats.size, mtime: stats.mtime.getTime() });
          }
        }
      };
      walk(piSessionsRoot, "");
      return out;
    };

    /** Validate a pi-session relative path: no traversal, must end in .jsonl. */
    const isSafePiSessionRel = (rel: string): boolean => {
      if (!rel || rel.includes("..") || rel.startsWith("/")) return false;
      if (!rel.endsWith(".jsonl")) return false;
      // Resolve and confirm it's still under the root
      const full = path.resolve(piSessionsRoot, rel);
      return full.startsWith(piSessionsRoot + path.sep);
    };

    this.app.get("/api/pi-sessions", (_req, res) => {
      try {
        const files = listPiSessionFiles();

        // Build session alias lookup so dashboard can show friendly names.
        const sessions = xSessionStore(this.x).list(this.x, { hasAlias: true });
        const aliasMap = new Map<string, string>();
        for (const s of sessions) {
          if (s.alias) aliasMap.set(s.id, s.alias);
        }

        // Read first line (session header) from each file for metadata.
        const items = files.map(({ rel, full, size, mtime }) => {
          const dirName = rel.split("/")[0]; // encoded vito session id
          let vitoSessionId = "";
          try {
            vitoSessionId = decodeURIComponent(dirName);
          } catch {
            vitoSessionId = dirName;
          }

          let piSessionId = "";
          let piTimestamp = "";
          let piCwd = "";
          let messageCount = 0;
          let lastModel = "";
          let lastUserMessage = "";

          try {
            const content = readFileSync(full, "utf-8");
            const lines = content.trim().split("\n").filter(Boolean);
            for (const line of lines) {
              try {
                const obj = JSON.parse(line);
                if (obj.type === "session") {
                  piSessionId = obj.id || "";
                  piTimestamp = obj.timestamp || "";
                  piCwd = obj.cwd || "";
                } else if (obj.type === "message") {
                  messageCount++;
                  if (obj.message?.role === "user") {
                    const content = obj.message.content;
                    if (typeof content === "string") {
                      lastUserMessage = content.slice(0, 200);
                    } else if (Array.isArray(content)) {
                      const text = content.find((c: any) => c?.type === "text");
                      if (text?.text) lastUserMessage = text.text.slice(0, 200);
                    }
                  }
                } else if (obj.type === "model_change") {
                  lastModel = `${obj.provider}/${obj.modelId}`;
                }
              } catch {
                // skip malformed lines
              }
            }
          } catch {
            // file unreadable; return what we have
          }

          return {
            rel,
            size,
            mtime,
            vitoSessionId,
            alias: aliasMap.get(vitoSessionId) || null,
            piSessionId,
            piTimestamp,
            piCwd,
            messageCount,
            lastModel,
            lastUserMessage,
          };
        });

        items.sort((a, b) => b.mtime - a.mtime);
        res.json({ files: items });
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    });

    // Match any subpath under /api/pi-sessions/. Express 5 named wildcard.
    this.app.get("/api/pi-sessions/*rel", (req, res) => {
      try {
        const rel = (req.params.rel as string[]).join("/");
        if (!isSafePiSessionRel(rel)) {
          res.status(400).json({ error: "Invalid path" });
          return;
        }
        const full = path.resolve(piSessionsRoot, rel);
        if (!existsSync(full)) {
          res.status(404).json({ error: "Pi session not found" });
          return;
        }

        const content = readFileSync(full, "utf-8");
        const lines = content.trim().split("\n").filter(Boolean);
        const parsed = lines.map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return { type: "parse_error", raw: line };
          }
        });
        res.json({ rel, format: "jsonl", lines: parsed });
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    });

    this.app.delete("/api/pi-sessions/*rel", (req, res) => {
      try {
        const rel = (req.params.rel as string[]).join("/");
        if (!isSafePiSessionRel(rel)) {
          res.status(400).json({ error: "Invalid path" });
          return;
        }
        const full = path.resolve(piSessionsRoot, rel);
        if (!existsSync(full)) {
          res.status(404).json({ error: "Pi session not found" });
          return;
        }
        unlinkSync(full);
        res.json({ success: true, deleted: rel });
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    });

    this.app.delete("/api/pi-sessions", (_req, res) => {
      try {
        const files = listPiSessionFiles();
        let deleted = 0;
        for (const { full } of files) {
          try {
            unlinkSync(full);
            deleted++;
          } catch {
            // ignore
          }
        }
        res.json({ success: true, deleted });
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    });

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
