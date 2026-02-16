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
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, openSync, readSync, closeSync, unlinkSync } from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { readSecrets, writeSecrets, loadSecrets, getSecretsForDashboard, SYSTEM_KEYS, PROVIDER_API_KEYS, getProviderKeyStatus, getProviderAuthStatus } from "../secrets.js";
import { getProviders, getModels } from "@mariozechner/pi-ai";

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
  private discordChannel?: {
    registerSlashCommands: () => Promise<{ success: boolean; count: number; error?: string }>;
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

  setDiscordChannel(discord: {
    registerSlashCommands: () => Promise<{ success: boolean; count: number; error?: string }>;
  }) {
    this.discordChannel = discord;
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
      if (updates.harnesses) {
        if (!this.config.harnesses) {
          this.config.harnesses = {};
        }
        // Merge each harness config
        for (const [name, harnessUpdate] of Object.entries(updates.harnesses)) {
          if (name === 'default') {
            // Default is just a string
            this.config.harnesses.default = harnessUpdate as string;
          } else {
            // Harness-specific config
            this.config.harnesses[name] = harnessUpdate;
          }
        }
      }
      this.saveConfig();
      res.json(this.config);
    });

    // Compaction status endpoint
    this.app.get("/api/compaction/status", (req, res) => {
      const uncompactedCount = this.queries.countUncompacted();
      const threshold = this.config.memory.compactionThreshold;
      res.json({
        uncompactedCount,
        threshold,
        progress: Math.min(uncompactedCount / threshold, 1),
        willTrigger: uncompactedCount > threshold
      });
    });

    // Harnesses endpoint
    this.app.get("/api/harnesses", (req, res) => {
      // Get config and list registered harnesses
      const harnesses = this.config.harnesses || {};
      const defaultHarness = harnesses.default || "pi-coding-agent";
      
      // Build harness info
      const available: Record<string, any> = {
        "pi-coding-agent": {
          name: "pi-coding-agent",
          description: "Pi Coding Agent — Anthropic Claude with full tool use",
          config: harnesses["pi-coding-agent"] || this.config.model || null,
          isDefault: defaultHarness === "pi-coding-agent"
        },
        "claude-code": {
          name: "claude-code",
          description: "Claude Code CLI — Anthropic's official coding agent",
          config: harnesses["claude-code"] || { model: "sonnet", permissionMode: "bypassPermissions" },
          isDefault: defaultHarness === "claude-code"
        }
      };
      
      // Get sessions with harness overrides
      const sessions = this.queries.getAllSessions();
      const sessionOverrides = sessions
        .map((s: any) => {
          const config = JSON.parse(s.config || "{}");
          if (config.harness || config["pi-coding-agent"] || config.model) {
            return {
              id: s.id,
              harness: config.harness || "pi-coding-agent",
              overrides: config["pi-coding-agent"] || (config.model ? { model: config.model } : null)
            };
          }
          return null;
        })
        .filter(Boolean);
      
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
      const hideThoughts = req.query.hideThoughts === 'true';
      const hideTools = req.query.hideTools === 'true';
      const messages = this.queries.getAllMessagesForSession(req.params.id, limit, beforeId, hideThoughts, hideTools);
      const total = this.queries.countMessagesForSession(req.params.id, hideThoughts, hideTools);
      res.json({ messages, total });
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
      // Remove keys that are explicitly set to null
      for (const key of Object.keys(updated)) {
        if (updated[key] === null) {
          delete updated[key];
        }
      }
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
        
        // Parse description from YAML frontmatter
        let description: string | null = null;
        if (content.startsWith("---")) {
          const endIndex = content.indexOf("---", 3);
          if (endIndex !== -1) {
            const frontmatter = content.slice(3, endIndex);
            const match = frontmatter.match(/^description:\s*(.+)$/m);
            if (match) {
              description = match[1].trim();
            }
          }
        }
        
        return {
          id: i + 1,
          timestamp: stat.mtimeMs,
          title: f,
          description,
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
        };
        this.eventHandler(event);
        res.json({ ok: true });
      } else {
        res.status(400).json({ error: "Invalid chat message or no handler" });
      }
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

    // ── Logs ──

    this.app.get("/api/logs", (req, res) => {
      try {
        const logsDir = path.join(process.cwd(), "logs");
        if (!existsSync(logsDir)) {
          res.json([]);
          return;
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
            const readSize = Math.min(stats.size, 4096);
            const buf = Buffer.alloc(readSize);
            const fd = openSync(filePath, "r");
            readSync(fd, buf, 0, readSize, 0);
            closeSync(fd);
            const head = buf.toString("utf-8");

            if (isJsonl) {
              // Parse first line (header) for preview
              try {
                const firstLine = head.split("\n")[0];
                const header = JSON.parse(firstLine);
                preview = `Session: ${header.session_id}\nChannel: ${header.channel}\nModel: ${header.model}`;
              } catch {
                preview = head.split("\n").slice(0, 3).join("\n");
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

  private setupWebSocket() {
    // WebSocket kept for potential future use (live streaming, etc.)
    // Chat messages are now sent via HTTP POST /api/chat
    // Frontend polls for new messages instead of listening to WS events
    this.wss.on("connection", (ws) => {
      this.clients.add(ws);
      ws.on("close", () => {
        this.clients.delete(ws);
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
