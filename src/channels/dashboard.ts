import type {
  Channel,
  InboundEvent,
  OutputHandler,
  OutboundMessage,
} from "../types.js";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import path from "path";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { readSecrets, writeSecrets, loadSecrets, getSecretsForDashboard, SYSTEM_KEYS } from "../secrets.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ATTACHMENTS_DIR = path.join(process.cwd(), "data", "attachments");
const CONFIG_PATH = path.join(process.cwd(), "user", "vito.config.json");

interface DashboardMessage {
  type: "chat" | "typing" | "status";
  sessionId?: string;
  content?: string;
  timestamp?: number;
  author?: string;
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
  private wss = new WebSocketServer({ server: this.server });
  private clients = new Set<WebSocket>();
  private port = 3030;
  private eventHandler?: (event: InboundEvent) => void;

  private skillsGetter?: () => any[];
  private cronManager?: {
    scheduleJob: (job: any) => void;
    removeJob: (name: string) => boolean;
    getActiveJobs: () => string[];
  };

  constructor(private db: any, private queries: any, private config: any) {
    this.setupExpress();
    this.setupWebSocket();
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
  }) {
    this.cronManager = manager;
  }

  reloadConfig(config: any) {
    this.config = config;
    console.log("[Dashboard] Config reloaded");
  }

  private setupExpress() {
    this.app.use(express.json({ limit: "200mb" }));
    this.app.use(express.static(path.join(__dirname, "../../dashboard/dist")));

    // Serve uploaded attachments
    if (!existsSync(ATTACHMENTS_DIR)) mkdirSync(ATTACHMENTS_DIR, { recursive: true });
    this.app.use("/attachments", express.static(ATTACHMENTS_DIR));

    // API endpoints
    this.app.get("/api/config", (req, res) => {
      res.json(this.config);
    });

    this.app.put("/api/config", (req, res) => {
      const updates = req.body;
      // Deep merge updates into config
      if (updates.model) Object.assign(this.config.model, updates.model);
      if (updates.memory) Object.assign(this.config.memory, updates.memory);
      if (updates.channels) {
        for (const [name, channelUpdate] of Object.entries(updates.channels)) {
          if (!this.config.channels[name]) {
            this.config.channels[name] = { enabled: true };
          }
          Object.assign(this.config.channels[name], channelUpdate);
        }
      }
      this.saveConfig();
      res.json(this.config);
    });

    this.app.get("/api/sessions", (req, res) => {
      const sessions = this.queries.getAllSessions();
      res.json(sessions);
    });

    this.app.get("/api/sessions/:id/messages", (req, res) => {
      const messages = this.queries.getAllMessagesForSession(req.params.id);
      res.json(messages);
    });

    this.app.get("/api/sessions/:id/config", (req, res) => {
      const session = this.queries.getSession(req.params.id);
      if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
      }
      res.json(JSON.parse(session.config || "{}"));
    });

    this.app.put("/api/sessions/:id/config", (req, res) => {
      const session = this.queries.getSession(req.params.id);
      if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
      }
      const current = JSON.parse(session.config || "{}");
      const updated = { ...current, ...req.body };
      this.queries.updateSessionConfig(req.params.id, JSON.stringify(updated));
      res.json(updated);
    });

    this.app.get("/api/memories", (req, res) => {
      const memoriesDir = path.join(process.cwd(), "user", "memories");
      if (!existsSync(memoriesDir)) {
        res.json([]);
        return;
      }
      const files = readdirSync(memoriesDir).filter((f: string) => f.endsWith(".md"));
      const memories = files.map((f: string, i: number) => {
        const filePath = path.join(memoriesDir, f);
        const content = readFileSync(filePath, "utf-8");
        const stat = statSync(filePath);
        return {
          id: i + 1,
          timestamp: stat.mtimeMs,
          title: f,
          content,
        };
      });
      res.json(memories);
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
      res.json(this.config.cron.jobs || []);
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
      
      // Schedule it
      if (this.cronManager) {
        this.cronManager.scheduleJob(job);
      }
      
      res.json(job);
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

    // Server restart endpoint
    this.app.post("/api/server/restart", (req, res) => {
      res.json({ ok: true, message: "Restarting server..." });
      // Give the response time to flush, then restart via PM2
      setTimeout(() => {
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
            url: meta.url || `https://${appName}.theworstproductions.com`,
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

    // ── Traces ──

    this.app.get("/api/traces", (req, res) => {
      const limit = parseInt(req.query.limit as string) || 50;
      const traces = this.queries.getRecentTraces(limit);
      res.json(traces);
    });

    this.app.get("/api/traces/:id", (req, res) => {
      const id = parseInt(req.params.id);
      const trace = this.queries.getTrace(id);
      if (!trace) {
        res.status(404).json({ error: "Trace not found" });
        return;
      }
      res.json(trace);
    });

    // Serve the React app for all other routes
    this.app.use((req, res) => {
      res.sendFile(path.join(__dirname, "../../dashboard/dist/index.html"));
    });
  }

  private setupWebSocket() {
    this.wss.on("connection", (ws) => {
      console.log("Dashboard client connected");
      this.clients.add(ws);

      ws.on("message", (data) => {
        try {
          const msg: DashboardMessage = JSON.parse(data.toString());

          if (msg.type === "chat" && msg.content && this.eventHandler) {
            // Parse sessionId to extract target (e.g., "dashboard:default" -> "default")
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
              raw: msg,
            };
            this.eventHandler(event);
          }
        } catch (err) {
          console.error("Error processing dashboard message:", err);
        }
      });

      ws.on("close", () => {
        this.clients.delete(ws);
        console.log("Dashboard client disconnected");
      });
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
    // Force-close all connected WebSocket clients
    for (const client of this.clients) {
      client.terminate();
    }
    this.clients.clear();
    this.wss.close();
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
    return new DashboardOutputHandler(this.clients, event);
  }

  getSessionKey(payload: any): string {
    return payload.sessionId || "dashboard:default";
  }
}

class DashboardOutputHandler implements OutputHandler {
  constructor(
    private clients: Set<WebSocket>,
    private event: InboundEvent
  ) {}

  async relay(): Promise<void> {
    // no-op — frontend refetches from DB
  }

  async relayEvent(): Promise<void> {
    // Tool call stored in DB — tell frontend to refresh
    this.broadcast({ type: "refresh", sessionId: this.event.sessionKey });
  }

  async startTyping(): Promise<void> {
    this.broadcast({ type: "typing", sessionId: this.event.sessionKey });
  }

  async endMessage(): Promise<void> {
    // New message stored in DB — tell frontend to refresh
    this.broadcast({ type: "refresh", sessionId: this.event.sessionKey });
  }

  async stopTyping(): Promise<void> {
    this.broadcast({ type: "done", sessionId: this.event.sessionKey });
  }

  private broadcast(msg: any) {
    const data = JSON.stringify(msg);
    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  }
}

// Secrets helpers now live in ../secrets.ts
