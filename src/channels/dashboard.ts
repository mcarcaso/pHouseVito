import type {
  Channel,
  InboundEvent,
  OutputHandler,
} from "../types.js";
import express from "express";
import http from "http";
const createServer = http.createServer.bind(http);
import path from "path";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, openSync, readSync, closeSync, unlinkSync } from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { readSecrets, writeSecrets, loadSecrets, getSecretsForDashboard, SYSTEM_KEYS, PROVIDER_API_KEYS, getProviderKeyStatus, getProviderAuthStatus } from "../secrets.js";
import Database from "better-sqlite3";
import { getProviders, getModels } from "@mariozechner/pi-ai";
import { searchMemory } from "../memory/search.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ATTACHMENTS_DIR = path.join(process.cwd(), "data", "attachments");
const DRIVE_DIR = path.join(process.cwd(), "user", "drive");
const CONFIG_PATH = path.join(process.cwd(), "user", "vito.config.json");

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

  private skillsGetter?: () => any[];
  private cronManager?: {
    scheduleJob: (job: any) => void;
    removeJob: (name: string) => boolean;
    getActiveJobs: () => string[];
    triggerJob: (name: string) => Promise<boolean>;
    checkHealth: () => { name: string; isActive: boolean; nextRun: Date | null }[];
  };
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
  }) => Promise<string>;

  constructor(private db: any, private queries: any, private config: any) {
    this.setupExpress();
  }

  /** Save current config to disk */
  private saveConfig(): void {
    try {
      writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2) + "\n", "utf-8");
      console.log("[Dashboard] Config saved to disk");
    } catch (err) {
      console.error("[Dashboard] Failed to save config:", err);
    }
  }

  setSkillsGetter(getter: () => any[]) {
    this.skillsGetter = getter;
  }

  setCronManager(manager: {
    scheduleJob: (job: any) => void;
    removeJob: (name: string) => boolean;
    getActiveJobs: () => string[];
    triggerJob: (name: string) => Promise<boolean>;
    checkHealth: () => { name: string; isActive: boolean; nextRun: Date | null }[];
  }) {
    this.cronManager = manager;
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
  }) => Promise<string>) {
    this.askHandler = handler;
  }

  reloadConfig(config: any) {
    this.config = config;
    console.log("[Dashboard] Config reloaded");
  }

  private setupExpress() {
    // Subdomain app proxy — routes appname.basedomain requests to the app's PM2 port
    // Must be before express.json() so request body can be piped to the upstream app
    this.app.use((req, res, next) => {
      const host = (req.headers.host || "").split(":")[0]; // strip port
      // Read baseDomain from config
      let baseDomain: string | undefined;
      try {
        const config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
        baseDomain = config.apps?.baseDomain;
      } catch {}
      if (!baseDomain || !host.endsWith(baseDomain)) return next();

      const prefix = host.slice(0, -(baseDomain.length + 1)); // e.g. "myapp"
      if (!prefix || prefix.includes(".")) return next(); // no nested subdomains

      const appDir = path.join(process.cwd(), "user", "apps", prefix);
      const metaPath = path.join(appDir, ".vito-app.json");
      if (!existsSync(metaPath)) return next();

      let port: number;
      try {
        const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
        port = meta.port;
      } catch {
        return next();
      }

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

      // Localhost bypass — internal calls (skills, cron, etc.) are trusted
      const remoteAddr = req.ip || req.socket.remoteAddress || "";
      const isLocalhost = remoteAddr === "127.0.0.1" || remoteAddr === "::1" || remoteAddr === "::ffff:127.0.0.1";
      if (isLocalhost) return next();

      // If no password set, allow all (first-time setup)
      const secrets = readSecrets();
      if (!secrets.DASHBOARD_PASSWORD_HASH) return next();

      // Check session cookie
      const sessionId = parseCookie(req.headers.cookie, "session");
      const session = sessions.get(sessionId);
      if (!session || session.expires < Date.now()) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      next();
    });

    // Serve uploaded attachments (auth-gated)
    this.app.use("/attachments", (req, res, next) => {
      const remoteAddr = req.ip || req.socket.remoteAddress || "";
      const isLocalhost = remoteAddr === "127.0.0.1" || remoteAddr === "::1" || remoteAddr === "::ffff:127.0.0.1";
      if (isLocalhost) return next();
      const secrets = readSecrets();
      if (!secrets.DASHBOARD_PASSWORD_HASH) return next();
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

    this.app.get("/api/config", (req, res) => {
      res.json(this.config);
    });

    this.app.put("/api/config", (req, res) => {
      const updates = req.body;
      // Deep merge updates into config
      if (updates.bot) {
        if (!this.config.bot) {
          this.config.bot = {};
        }
        Object.assign(this.config.bot, updates.bot);
      }
      if (updates.settings) {
        if (!this.config.settings) {
          this.config.settings = {};
        }
        Object.assign(this.config.settings, updates.settings);
      }
      if (updates.compaction) Object.assign(this.config.compaction, updates.compaction);
      if (updates.channels) {
        for (const [name, channelUpdate] of Object.entries(updates.channels)) {
          // Replace channel config entirely (allows removal of nested keys like settings)
          this.config.channels[name] = channelUpdate as any;
        }
      }
      if (updates.harnesses) {
        if (!this.config.harnesses) {
          this.config.harnesses = {};
        }
        // Merge each harness config
        for (const [name, harnessUpdate] of Object.entries(updates.harnesses)) {
          (this.config.harnesses as any)[name] = harnessUpdate;
        }
      }
      if (updates.sessions !== undefined) {
        // Replace sessions entirely (allows deletion)
        this.config.sessions = updates.sessions || {};
      }
      this.saveConfig();
      res.json(this.config);
    });

    // Harnesses endpoint
    this.app.get("/api/harnesses", (req, res) => {
      // Get config and list registered harnesses
      const harnesses = this.config.harnesses || {};
      const defaultHarness = this.config.settings?.harness || "claude-code";
      
      // Build harness info
      const available: Record<string, any> = {
        "pi-coding-agent": {
          name: "pi-coding-agent",
          description: "Pi Coding Agent — Anthropic Claude with full tool use",
          config: harnesses["pi-coding-agent"] || null,
          isDefault: defaultHarness === "pi-coding-agent"
        },
        "claude-code": {
          name: "claude-code",
          description: "Claude Code CLI — Anthropic's official coding agent",
          config: harnesses["claude-code"] || { model: "sonnet", permissionMode: "bypassPermissions" },
          isDefault: defaultHarness === "claude-code"
        }
      };
      
      // Get session overrides from config file
      const sessionOverrides = this.config.sessions 
        ? Object.entries(this.config.sessions).map(([id, settings]: [string, any]) => ({
            id,
            harness: settings.harness || defaultHarness,
            overrides: settings["pi-coding-agent"] || settings["claude-code"] || null
          }))
        : [];
      
      res.json({
        default: defaultHarness,
        available,
        sessionOverrides
      });
    });

    // Model discovery endpoints
    this.app.get("/api/models/providers", (req, res) => {
      try {
        const providers = getProviders();
        const keyStatus = getProviderKeyStatus();
        const authStatus = getProviderAuthStatus();
        // Return providers with their API key status
        res.json({
          providers,
          keyStatus,
          authStatus,
          keyInfo: PROVIDER_API_KEYS
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

    this.app.get("/api/sessions", (req, res) => {
      const sessions = this.queries.getAllSessions();
      res.json(sessions);
    });

    this.app.get("/api/sessions/:id/messages", (req, res) => {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
      const beforeId = req.query.before ? parseInt(req.query.before as string) : undefined;
      const afterId = req.query.after ? parseInt(req.query.after as string) : undefined;
      const hideThoughts = req.query.hideThoughts === 'true';
      const hideTools = req.query.hideTools === 'true';
      const messages = this.queries.getAllMessagesForSession(req.params.id, limit, beforeId, hideThoughts, hideTools, afterId);
      const total = this.queries.countMessagesForSession(req.params.id, hideThoughts, hideTools);
      res.json({ messages, total });
    });

    this.app.get("/api/sessions/:id/config", (req, res) => {
      const sessionId = req.params.id;
      const session = this.queries.getSession(sessionId);
      if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
      }
      // Session settings now live in config file, not DB
      const sessionSettings = this.config.sessions?.[sessionId] || {};
      res.json(sessionSettings);
    });

    this.app.put("/api/sessions/:id/config", (req, res) => {
      const sessionId = req.params.id;
      const session = this.queries.getSession(sessionId);
      if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
      }
      
      // Session settings now live in config file, not DB
      if (!this.config.sessions) {
        this.config.sessions = {};
      }
      
      const current = this.config.sessions[sessionId] || {};
      const updated = { ...current, ...req.body };
      
      // Remove keys that are explicitly set to null
      for (const key of Object.keys(updated)) {
        if ((updated as any)[key] === null) {
          delete (updated as any)[key];
        }
      }
      
      // If session settings are now empty, remove the entry
      if (Object.keys(updated).length === 0) {
        delete this.config.sessions[sessionId];
      } else {
        this.config.sessions[sessionId] = updated;
      }
      
      this.saveConfig();
      res.json(updated);
    });

    this.app.put("/api/sessions/:id/alias", (req, res) => {
      const sessionId = req.params.id;
      const session = this.queries.getSession(sessionId);
      if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
      }
      const { alias } = req.body;
      // Empty string or null means remove alias
      const cleanAlias = alias && alias.trim() ? alias.trim() : null;
      this.queries.updateSessionAlias(sessionId, cleanAlias);
      res.json({ id: sessionId, alias: cleanAlias });
    });

    this.app.get("/api/skills", async (req, res) => {
      const skills = this.skillsGetter ? this.skillsGetter() : [];
      res.json(skills);
    });

    this.app.get("/api/skills/:name/files", async (req, res) => {
      const skills = this.skillsGetter ? this.skillsGetter() : [];
      const skill = skills.find((s) => s.name === req.params.name);
      if (!skill) {
        res.status(404).json({ error: "Skill not found" });
        return;
      }
      
      // skill.path is the path to SKILL.md, we need the directory
      const skillDir = path.dirname(skill.path);
      
      // List files in the skill directory
      const fs = await import("fs/promises");
      try {
        const entries = await fs.readdir(skillDir, { withFileTypes: true });
        const files = entries
          .filter((e) => e.isFile())
          .map((e) => ({
            name: e.name,
            path: path.join(skillDir, e.name),
          }));
        res.json(files);
      } catch (err) {
        res.status(500).json({ error: "Failed to read skill directory" });
      }
    });

    // Cron job management
    this.app.get("/api/cron/jobs", (req, res) => {
      const jobs = this.config.cron.jobs || [];
      // Enrich with nextRun info from scheduler
      if (this.cronManager) {
        const health = this.cronManager.checkHealth();
        const healthMap = new Map(health.map(h => [h.name, h]));
        const enriched = jobs.map((job: any) => ({
          ...job,
          nextRun: healthMap.get(job.name)?.nextRun?.toISOString() || null,
          isActive: healthMap.get(job.name)?.isActive ?? false,
        }));
        res.json(enriched);
      } else {
        res.json(jobs);
      }
    });

    this.app.post("/api/cron/jobs", (req, res) => {
      const job = req.body;
      if (!job.name || !job.schedule || !job.session || !job.prompt) {
        res.status(400).json({ error: "Missing required fields: name, schedule, session, prompt" });
        return;
      }
      
      // Validate that the session exists
      const session = this.queries.getSession(job.session);
      if (!session) {
        res.status(400).json({ error: `Session '${job.session}' does not exist` });
        return;
      }
      
      // Check if job name already exists
      if (this.config.cron.jobs.some((j: any) => j.name === job.name)) {
        res.status(400).json({ error: "Job with this name already exists" });
        return;
      }
      
      // Add to config
      this.config.cron.jobs.push(job);
      
      // Save to disk
      this.saveConfig();
      
      // Schedule it and get next run
      let nextRun: string | null = null;
      if (this.cronManager) {
        this.cronManager.scheduleJob(job);
        const health = this.cronManager.checkHealth();
        const jobHealth = health.find(h => h.name === job.name);
        nextRun = jobHealth?.nextRun?.toISOString() || null;
      }
      
      res.json({ ...job, nextRun });
    });

    this.app.put("/api/cron/jobs/:name", (req, res) => {
      const name = req.params.name;
      const index = this.config.cron.jobs.findIndex((j: any) => j.name === name);
      
      if (index === -1) {
        res.status(404).json({ error: "Job not found" });
        return;
      }
      
      const updates = req.body;
      const existingJob = this.config.cron.jobs[index];
      
      // Update job fields (preserve name, allow updating other fields)
      const updatedJob = {
        ...existingJob,
        ...updates,
        name, // Ensure name can't be changed
      };
      
      // Clean up undefined sendCondition (remove if empty string)
      if (updatedJob.sendCondition === '' || updatedJob.sendCondition === null) {
        delete updatedJob.sendCondition;
      }
      
      this.config.cron.jobs[index] = updatedJob;
      
      // Save to disk
      this.saveConfig();
      
      // Reload in scheduler (remove and re-add)
      if (this.cronManager) {
        this.cronManager.removeJob(name);
        this.cronManager.scheduleJob(updatedJob);
      }
      
      res.json(updatedJob);
    });

    this.app.delete("/api/cron/jobs/:name", (req, res) => {
      const name = req.params.name;
      const index = this.config.cron.jobs.findIndex((j: any) => j.name === name);
      
      if (index === -1) {
        res.status(404).json({ error: "Job not found" });
        return;
      }
      
      // Remove from config
      this.config.cron.jobs.splice(index, 1);
      
      // Save to disk
      this.saveConfig();
      
      // Remove from scheduler
      if (this.cronManager) {
        this.cronManager.removeJob(name);
      }
      
      res.json({ success: true });
    });

    this.app.post("/api/cron/jobs/:name/trigger", async (req, res) => {
      const name = req.params.name;
      
      if (!this.cronManager) {
        res.status(500).json({ error: "Scheduler not available" });
        return;
      }

      const success = await this.cronManager.triggerJob(name);
      if (!success) {
        res.status(404).json({ error: "Job not found" });
        return;
      }

      res.json({ success: true, message: `Job '${name}' triggered` });
    });

    this.app.get("/api/cron/health", (req, res) => {
      if (!this.cronManager) {
        res.status(500).json({ error: "Scheduler not available" });
        return;
      }
      const health = this.cronManager.checkHealth();
      const summary = {
        total: health.length,
        active: health.filter(h => h.isActive).length,
      };
      res.json({ summary, jobs: health });
    });

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
        const sessions = this.queries.getAllSessions().filter(
          (s: any) => s.channel === "discord" && !s.alias
        );
        
        const updated: string[] = [];
        const failed: string[] = [];
        
        for (const session of sessions) {
          const channelId = session.channel_target;
          const info = await this.discordChannel.getChannelInfo(channelId);
          
          if (info) {
            // Format alias: "guild-name / channel-name" or just the name for DMs
            const alias = info.guildName 
              ? `${info.guildName} / ${info.name}`
              : info.name;
            
            this.queries.updateSessionAlias(session.id, alias);
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
        const sessions = this.queries.getAllSessions().filter(
          (s: any) => s.channel === "telegram" && !s.alias
        );
        
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
            
            this.queries.updateSessionAlias(session.id, alias);
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

    this.app.get("/api/jobs", (req, res) => {
      // Placeholder for cron jobs
      res.json([]);
    });

    // Soul and System prompt endpoints
    this.app.get("/api/soul", (req, res) => {
      const soulPath = path.join(process.cwd(), "user", "SOUL.md");
      if (!existsSync(soulPath)) {
        res.json({ content: "" });
        return;
      }
      res.json({ content: readFileSync(soulPath, "utf-8") });
    });

    this.app.put("/api/soul", (req, res) => {
      const soulPath = path.join(process.cwd(), "user", "SOUL.md");
      const { content } = req.body;
      writeFileSync(soulPath, content, "utf-8");
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

    // ── Memory API ──

    // User profile JSON
    this.app.get("/api/memory/profile", (req, res) => {
      const profilePath = path.join(process.cwd(), "user", "profile.md");
      if (!existsSync(profilePath)) {
        res.json({ content: null });
        return;
      }
      try {
        const content = readFileSync(profilePath, "utf-8");
        res.json({ content });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // Embeddings stats
    this.app.get("/api/memory/embeddings/stats", (req, res) => {
      const dbPath = path.join(process.cwd(), "user", "embeddings.db");
      if (!existsSync(dbPath)) {
        res.json({ totalChunks: 0, totalSessions: 0, totalDays: 0, oldestDay: null, newestDay: null, sessions: [] });
        return;
      }
      try {
        const db = new Database(dbPath, { readonly: true });
        
        const totals = db.prepare(`
          SELECT COUNT(*) as totalChunks,
                 COUNT(DISTINCT session_id) as totalSessions,
                 COUNT(DISTINCT day) as totalDays,
                 MIN(day) as oldestDay,
                 MAX(day) as newestDay
          FROM chunks
        `).get() as any;

        // Get session aliases from vito.db
        const aliasMap = new Map<string, string>();
        const sessions = this.queries.getAllSessions();
        for (const s of sessions) {
          if (s.alias) aliasMap.set(s.id, s.alias);
        }

        const sessionRows = db.prepare(`
          SELECT session_id, COUNT(*) as count, MIN(day) as first_day, MAX(day) as last_day
          FROM chunks
          GROUP BY session_id
          ORDER BY count DESC
        `).all();

        db.close();

        res.json({
          ...totals,
          sessions: sessionRows.map((s: any) => ({
            ...s,
            alias: aliasMap.get(s.session_id) || null,
          })),
        });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // Embeddings search (hybrid) — uses shared searchMemory() with recency bias
    this.app.get("/api/memory/embeddings/search", async (req, res) => {
      const query = req.query.q as string;
      const mode = (req.query.mode as string) || "hybrid";
      const limit = parseInt(req.query.limit as string) || 10;

      if (!query) {
        res.status(400).json({ error: "Missing query parameter 'q'" });
        return;
      }

      const dbPath = path.join(process.cwd(), "user", "embeddings.db");
      if (!existsSync(dbPath)) {
        res.json({ query, mode, duration_ms: 0, results: [] });
        return;
      }

      const start = Date.now();

      try {
        // Use shared search function (includes recency bias)
        const results = await searchMemory(query, { 
          limit, 
          mode: mode as "hybrid" | "embedding" | "bm25" 
        });

        const duration_ms = Date.now() - start;
        
        // Map to dashboard expected format
        res.json({ 
          query, 
          mode, 
          duration_ms, 
          results: results.map(r => ({
            id: r.id,
            session_id: r.sessionId,
            day: r.day,
            chunk_index: 0, // Not tracked in shared function, but rarely used in UI
            text: r.text,
            context: r.context,
            msg_count: r.msgCount,
            rrfScore: r.rrfScore,
            embeddingScore: r.embeddingScore,
            rawEmbeddingScore: r.rawEmbeddingScore,
            recencyFactor: r.recencyFactor,
            daysAgo: r.daysAgo,
            bm25Score: r.bm25Score,
          }))
        });
      } catch (err: any) {
        console.error("[Dashboard] Embeddings search error:", err);
        res.status(500).json({ error: err.message });
      }
    });

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

    this.app.get("/api/channels/:name/stream-mode", (req, res) => {
      const ch = this.config.channels[req.params.name];
      res.json({ streamMode: ch?.streamMode || "final" });
    });

    this.app.put("/api/channels/:name/stream-mode", (req, res) => {
      const { streamMode } = req.body;
      if (!["stream", "bundled", "final"].includes(streamMode)) {
        res.status(400).json({ error: "Invalid stream mode" });
        return;
      }
      const name = req.params.name;
      if (!this.config.channels[name]) {
        this.config.channels[name] = { enabled: true };
      }
      this.config.channels[name].streamMode = streamMode;
      res.json({ streamMode });
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

      const { question, session, author, channelPrompt } = req.body;
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
        const files: { name: string; size: number; isPublic: boolean }[] = [];

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
            const filePublic = isDrivePathPublic(filePath);
            files.push({ name: entry.name, size: statSync(filePath).size, isPublic: filePublic });
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

    // ── Logs ──

    this.app.get("/api/logs", (req, res) => {
      try {
        const logsDir = path.join(process.cwd(), "logs");
        if (!existsSync(logsDir)) {
          res.json([]);
          return;
        }
        
        // Build a map of session_id → alias for quick lookup
        const sessions = this.queries.getAllSessions();
        const aliasMap = new Map<string, string>();
        for (const s of sessions) {
          if (s.alias) {
            aliasMap.set(s.id, s.alias);
          }
        }
        
        // Support both old .log and new .jsonl formats
        const files = readdirSync(logsDir)
          .filter(f => (f.startsWith("request-") && f.endsWith(".log")) ||
                       (f.startsWith("trace-") && f.endsWith(".jsonl")))
          .map(filename => {
            const filePath = path.join(logsDir, filename);
            const stats = statSync(filePath);
            const isJsonl = filename.endsWith(".jsonl");

            // Read only the first 4KB for preview (avoids reading multi-MB trace files)
            let preview = "";
            let sessionId = "";
            let hasEmbedding = false;
            const readSize = Math.min(stats.size, 4096);
            const buf = Buffer.alloc(readSize);
            const fd = openSync(filePath, "r");
            readSync(fd, buf, 0, readSize, 0);
            closeSync(fd);
            const head = buf.toString("utf-8");

            let userMessage = "";
            if (isJsonl) {
              // Parse first few lines for header and user_message
              try {
                const lines = head.split("\n");
                for (const line of lines) {
                  if (!line.trim()) continue;
                  try {
                    const obj = JSON.parse(line);
                    if (obj.type === "header") {
                      sessionId = obj.session_id || "";
                      preview = `Session: ${obj.session_id}\nChannel: ${obj.channel}\nModel: ${obj.model}`;
                    } else if (obj.type === "user_message") {
                      userMessage = obj.content || "";
                    }
                  } catch {
                    // skip malformed lines
                  }
                }
              } catch {
                preview = head.split("\n").slice(0, 3).join("\n");
              }

              // Detect embedding_result with actual chunks (for list badge)
              try {
                const content = readFileSync(filePath, "utf-8");
                const lines = content.split("\n");
                hasEmbedding = false;
                for (const line of lines) {
                  if (!line.includes('"type":"embedding_result"')) continue;
                  try {
                    const obj = JSON.parse(line);
                    if (obj.type === "embedding_result" && typeof obj.chunks_created === "number" && obj.chunks_created > 0) {
                      hasEmbedding = true;
                      break;
                    }
                  } catch {
                    // ignore parse errors
                  }
                }
              } catch {
                hasEmbedding = false;
              }
            } else {
              preview = head.split("\n").slice(0, 8).join("\n");
            }

            return {
              filename,
              timestamp: stats.mtime.getTime(),
              size: stats.size,
              preview,
              format: isJsonl ? "jsonl" : "text",
              sessionId,
              alias: sessionId ? aliasMap.get(sessionId) || null : null,
              hasEmbedding,
              userMessage,
            };
          })
          .sort((a, b) => b.timestamp - a.timestamp); // Newest first
        
        const limit = parseInt(req.query.limit as string) || 50;
        res.json(files.slice(0, limit));
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    });

    this.app.get("/api/logs/:filename", (req, res) => {
      try {
        const filename = req.params.filename;
        // Security: only allow request-*.log or trace-*.jsonl files
        const isOldFormat = filename.startsWith("request-") && filename.endsWith(".log");
        const isNewFormat = filename.startsWith("trace-") && filename.endsWith(".jsonl");
        
        if ((!isOldFormat && !isNewFormat) || filename.includes("..")) {
          res.status(400).json({ error: "Invalid filename" });
          return;
        }
        
        const filePath = path.join(process.cwd(), "logs", filename);
        if (!existsSync(filePath)) {
          res.status(404).json({ error: "Log not found" });
          return;
        }
        
        const content = readFileSync(filePath, "utf-8");
        
        if (isNewFormat) {
          // Parse JSONL and return structured data
          const lines = content.trim().split("\n").filter(Boolean);
          const parsed = lines.map(line => {
            try {
              return JSON.parse(line);
            } catch {
              return { type: "parse_error", raw: line };
            }
          });
          res.json({ filename, format: "jsonl", lines: parsed });
        } else {
          res.json({ filename, format: "text", content });
        }
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    });

    // Delete a single trace file
    this.app.delete("/api/logs/:filename", (req, res) => {
      try {
        const filename = req.params.filename;
        // Security: only allow request-*.log or trace-*.jsonl files
        const isOldFormat = filename.startsWith("request-") && filename.endsWith(".log");
        const isNewFormat = filename.startsWith("trace-") && filename.endsWith(".jsonl");
        
        if ((!isOldFormat && !isNewFormat) || filename.includes("..")) {
          res.status(400).json({ error: "Invalid filename" });
          return;
        }
        
        const filePath = path.join(process.cwd(), "logs", filename);
        if (!existsSync(filePath)) {
          res.status(404).json({ error: "Log not found" });
          return;
        }
        
        unlinkSync(filePath);
        res.json({ success: true, deleted: filename });
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    });

    // Delete all trace files
    this.app.delete("/api/logs", (req, res) => {
      try {
        const logsDir = path.join(process.cwd(), "logs");
        if (!existsSync(logsDir)) {
          res.json({ success: true, deleted: 0 });
          return;
        }
        
        const files = readdirSync(logsDir)
          .filter(f => (f.startsWith("request-") && f.endsWith(".log")) ||
                       (f.startsWith("trace-") && f.endsWith(".jsonl")));
        
        let deleted = 0;
        for (const filename of files) {
          try {
            unlinkSync(path.join(logsDir, filename));
            deleted++;
          } catch {
            // Skip files that can't be deleted
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
