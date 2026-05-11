/**
 * Vito MCP routes — mounted onto the dashboard's Express app so MCP lives in
 * the same process and on the same port as the dashboard.
 *
 * Exposes a `bash` tool and a `get-system-prompt` tool to a single
 * pre-registered OAuth client (Claude). No dynamic client registration, no
 * browser password login, no URL path-token bypass.
 *
 * Routes registered on the parent Express app:
 *   /.well-known/oauth-protected-resource(/mcp)
 *   /.well-known/oauth-authorization-server
 *   /authorize (GET) — only the static client can authorize
 *   /token (POST) — authorization_code, refresh_token, client_credentials
 *   /mcp (GET, POST, DELETE) — bearer token required
 *   /mcp/health (GET)
 *
 * Body parsing (urlencoded) and CORS are scoped to MCP-only paths so the
 * dashboard's own routes are unaffected.
 */

import express from "express";
import crypto from "crypto";
import { spawn } from "child_process";
import { existsSync, readFileSync } from "fs";
import path from "path";
import * as z from "zod/v4";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildSystemBlock } from "./system-instructions.js";
import { CAPABILITIES_MAP } from "./orchestrator_v2/capabilities.js";
import { discoverSkills } from "./skills/discovery.js";

const ROOT = process.cwd();
const USER_DIR = path.join(ROOT, "user");

export interface MountMcpOptions {
  /** Pre-registered OAuth client (Claude advanced/static flow). Required. */
  staticClientId: string;
  staticClientSecret: string;
  /** Access/refresh token TTL. Default 1h. */
  tokenTtlMs?: number;
  /** Sandbox root for the `bash` tool. Default: process.cwd(). */
  bashRoot?: string;
  /** Path to SYSTEM.md. Default: <root>/SYSTEM.md */
  systemPromptPath?: string;
  /** Max bytes returned from bash stdout/stderr (kept as a tail). */
  maxOutputBytes?: number;
  /** Default bash timeout in ms. */
  defaultTimeoutMs?: number;
  /** Hard cap on bash timeout in ms. */
  maxTimeoutMs?: number;
  /** Bot name surfaced in system prompt. Default: "Vito". */
  botName?: string;
}

type AuthCode = { code: string; client_id: string; redirect_uri: string; code_challenge?: string; expires_at: number };
type Token = { access_token: string; refresh_token: string; client_id: string; expires_at: number };

function randomId(prefix = ""): string { return prefix + crypto.randomBytes(24).toString("base64url"); }

function htmlEscape(s: string): string { return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] || c)); }

function getSubmittedClientSecret(req: any): string | undefined {
  if (typeof (req.body as any)?.client_secret === "string") return (req.body as any).client_secret;
  const auth = String(req.headers.authorization || "");
  const match = /^Basic\s+(.+)$/i.exec(auth);
  if (!match) return undefined;
  try {
    const decoded = Buffer.from(match[1], "base64").toString("utf-8");
    const idx = decoded.indexOf(":");
    if (idx === -1) return undefined;
    return decodeURIComponent(decoded.slice(idx + 1));
  } catch {
    return undefined;
  }
}

function getSubmittedClientId(req: any): string {
  if (typeof (req.body as any)?.client_id === "string" && (req.body as any).client_id) return (req.body as any).client_id;
  const auth = String(req.headers.authorization || "");
  const match = /^Basic\s+(.+)$/i.exec(auth);
  if (!match) return "";
  try {
    const decoded = Buffer.from(match[1], "base64").toString("utf-8");
    const idx = decoded.indexOf(":");
    return decodeURIComponent(idx === -1 ? decoded : decoded.slice(0, idx));
  } catch {
    return "";
  }
}

function verifyPkce(codeVerifier: string | undefined, challenge: string | undefined): boolean {
  if (!challenge) return true;
  if (!codeVerifier) return false;
  return crypto.createHash("sha256").update(codeVerifier).digest("base64url") === challenge;
}

function formatSkillsForMcpPrompt(): string {
  const skills = discoverSkills(path.join(USER_DIR, "skills")).sort((a, b) => a.name.localeCompare(b.name));
  const lines = skills.map((skill) => {
    const description = skill.description || "";
    return `  <skill>\n    <name>${htmlEscape(skill.name)}</name>\n    <description>${htmlEscape(description)}</description>\n    <location>${htmlEscape(skill.path)}</location>\n  </skill>`;
  });
  return `<skills>\nSkills are reusable task playbooks stored on disk. Each skill is a directory with a SKILL.md file containing frontmatter, exact usage instructions, commands, scripts, parameters, examples, and operational warnings.\n\nIn native Vito/Pi sessions, skills are exposed through a Skill tool. In this MCP connector, there is no Skill tool. You must emulate it manually:\n1. Pick the relevant skill from <available_skills> by name/description.\n2. Use bash to read that skill's SKILL.md before doing anything.\n3. Resolve any relative paths mentioned in SKILL.md relative to the skill directory, not the current working directory.\n4. Follow the documented commands and parameters exactly; never guess script names or flags.\n5. If a skill says to confirm before sending/calling/placing/booking/etc., stop and ask Mike first.\n6. For new skills, create user/skills/<name>/SKILL.md with frontmatter name + description. Never write new skills under src/skills/builtin/.\n\n<available_skills>\n${lines.join("\n")}\n</available_skills>\n</skills>`;
}

export function mountMcp(app: any, options: MountMcpOptions): void {
  const STATIC_CLIENT_ID = options.staticClientId;
  const STATIC_CLIENT_SECRET = options.staticClientSecret;
  const TOKEN_TTL_MS = options.tokenTtlMs ?? 60 * 60 * 1000;
  const BASH_ROOT = path.resolve(options.bashRoot ?? ROOT);
  const SYSTEM_PROMPT_PATH = path.resolve(options.systemPromptPath ?? path.join(ROOT, "SYSTEM.md"));
  const MAX_OUTPUT_BYTES = options.maxOutputBytes ?? 64 * 1024;
  const DEFAULT_TIMEOUT_MS = options.defaultTimeoutMs ?? 30_000;
  const MAX_TIMEOUT_MS = options.maxTimeoutMs ?? 120_000;
  const BOT_NAME = options.botName ?? "Vito";

  const authCodes = new Map<string, AuthCode>();
  const accessTokens = new Map<string, Token>();
  const refreshTokens = new Map<string, Token>();

  function issueToken(clientId: string): Token {
    const token: Token = { access_token: randomId("at_"), refresh_token: randomId("rt_"), client_id: clientId, expires_at: Date.now() + TOKEN_TTL_MS };
    accessTokens.set(token.access_token, token);
    refreshTokens.set(token.refresh_token, token);
    return token;
  }

  function sendToken(res: any, token: Token): void {
    res.json({ access_token: token.access_token, token_type: "Bearer", expires_in: Math.floor(TOKEN_TTL_MS / 1000), refresh_token: token.refresh_token });
  }

  function baseUrl(req: any): string {
    const xfp = String(req?.headers?.["x-forwarded-proto"] || "").split(",")[0].trim();
    const xfh = String(req?.headers?.["x-forwarded-host"] || "").split(",")[0].trim();
    const host = xfh || req?.headers?.host || "";
    const proto = xfp || (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
    return `${proto}://${host}`;
  }

  function mcpResourceMetadataUrl(req: any): string {
    return `${baseUrl(req)}/.well-known/oauth-protected-resource/mcp`;
  }

  function sendAuthError(req: any, res: any, status: number, error: string, description: string): void {
    res.setHeader("WWW-Authenticate", `Bearer error="${error}", error_description="${description}", resource_metadata="${mcpResourceMetadataUrl(req)}"`);
    res.status(status).json({ error, error_description: description });
  }

  function requireBearer(req: any, res: any, next: any): void {
    const token = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ""))?.[1];
    if (!token) {
      sendAuthError(req, res, 401, "invalid_token", "Missing Authorization header");
      return;
    }
    const record = accessTokens.get(token);
    if (!record || record.expires_at < Date.now()) {
      if (record) accessTokens.delete(token);
      sendAuthError(req, res, 401, "invalid_token", "Invalid or expired token");
      return;
    }
    req.auth = { token, clientId: record.client_id, scopes: [], expiresAt: Math.floor(record.expires_at / 1000) };
    next();
  }

  function safeCwd(cwd?: string): string {
    const resolved = path.resolve(BASH_ROOT, cwd || ".");
    if (resolved !== BASH_ROOT && !resolved.startsWith(BASH_ROOT + path.sep)) throw new Error(`cwd must stay under ${BASH_ROOT}`);
    return resolved;
  }

  function trimBuffer(current: string, chunk: Buffer): string {
    const next = current + chunk.toString("utf-8");
    if (Buffer.byteLength(next, "utf-8") <= MAX_OUTPUT_BYTES) return next;
    return next.slice(-MAX_OUTPUT_BYTES);
  }

  async function runBash(args: { command: string; cwd?: string; timeoutMs?: number; env?: Record<string, string> }): Promise<any> {
    const command = String(args.command || "").trim();
    if (!command) throw new Error("command is required");
    const cwd = safeCwd(args.cwd);
    const timeoutMs = Math.min(Math.max(Number(args.timeoutMs || DEFAULT_TIMEOUT_MS), 1_000), MAX_TIMEOUT_MS);
    const env = { ...process.env, ...(args.env || {}) };
    return await new Promise((resolve) => {
      const startedAt = Date.now();
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const child = spawn("/bin/bash", ["-lc", command], { cwd, env });
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
      }, timeoutMs);
      child.stdout.on("data", (chunk: Buffer) => { stdout = trimBuffer(stdout, chunk); });
      child.stderr.on("data", (chunk: Buffer) => { stderr = trimBuffer(stderr, chunk); });
      child.on("error", (err) => { clearTimeout(timer); resolve({ ok: false, error: err.message, stdout, stderr, durationMs: Date.now() - startedAt }); });
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        resolve({ ok: code === 0 && !timedOut, code, signal, timedOut, stdout, stderr, durationMs: Date.now() - startedAt, truncatedToBytes: MAX_OUTPUT_BYTES });
      });
    });
  }

  function getSystemPrompt(): string {
    const parts: string[] = [];
    const soulPath = path.join(USER_DIR, "SOUL.md");
    if (existsSync(soulPath)) parts.push(`<personality>\n${readFileSync(soulPath, "utf-8")}\n</personality>`);
    if (!existsSync(SYSTEM_PROMPT_PATH)) throw new Error(`system prompt file not found: ${SYSTEM_PROMPT_PATH}`);
    parts.push(buildSystemBlock(true, BOT_NAME));
    parts.push(`<capabilities>\n${CAPABILITIES_MAP}\n</capabilities>`);
    parts.push(formatSkillsForMcpPrompt());
    return parts.join("\n\n");
  }

  function createServer(): McpServer {
    const server = new McpServer({ name: "vito-mcp", version: "1.0.0" });
    server.registerTool("bash", {
      title: "Bash",
      description: "Execute a bash command by spawning /bin/bash -lc. Returns stdout, stderr, exit code, signal, duration, and timeout status.",
      inputSchema: {
        command: z.string().describe("Bash command to execute"),
        cwd: z.string().optional().describe(`Working directory under ${BASH_ROOT}`),
        timeoutMs: z.number().optional().describe(`Timeout in ms, capped at ${MAX_TIMEOUT_MS}`),
        env: z.record(z.string(), z.string()).optional().describe("Additional environment variables"),
      },
    }, async (args) => {
      console.log("[MCP] tool bash start", JSON.stringify({ keys: Object.keys(args || {}), command: (args as any)?.command?.slice?.(0, 200), cwd: (args as any)?.cwd }));
      try {
        const output = await runBash(args);
        console.log("[MCP] tool bash end", JSON.stringify({ ok: output.ok, code: output.code, timedOut: output.timedOut, stdoutBytes: Buffer.byteLength(output.stdout || ""), stderrBytes: Buffer.byteLength(output.stderr || "") }));
        return { content: [{ type: "text", text: JSON.stringify(output, null, 2) }], isError: !output.ok };
      } catch (err: any) {
        console.error("[MCP] tool bash exception", { message: err?.message, stack: err?.stack });
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: err?.message || String(err) }, null, 2) }], isError: true };
      }
    });
    server.registerTool("get-system-prompt", {
      title: "Get System Prompt",
      description: "Return Vito's assembled system prompt: SOUL.md, SYSTEM.md, capabilities, and skill instructions/list.",
      inputSchema: {},
    }, async () => {
      console.log("[MCP] tool get-system-prompt start");
      try {
        const prompt = getSystemPrompt();
        console.log("[MCP] tool get-system-prompt end", JSON.stringify({ chars: prompt.length }));
        return { content: [{ type: "text", text: prompt }] };
      } catch (err: any) {
        console.error("[MCP] tool get-system-prompt exception", { message: err?.message, stack: err?.stack });
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: err?.message || String(err) }, null, 2) }], isError: true };
      }
    });
    return server;
  }

  // ── Path-scoped middleware: CORS, urlencoded body parsing, request logging.
  // Limited to MCP routes so the dashboard's own behavior is unchanged.
  const MCP_PATHS = ["/mcp", "/authorize", "/token", "/register", "/.well-known/oauth-protected-resource", "/.well-known/oauth-authorization-server"];
  const isMcpPath = (p: string) => MCP_PATHS.some((prefix) => p === prefix || p.startsWith(prefix + "/") || p.startsWith(prefix + "?"));

  app.use((req: any, res: any, next: any) => {
    if (!isMcpPath(req.path)) return next();
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  // OAuth endpoints expect form-encoded bodies. Dashboard already mounts
  // express.json globally, but not urlencoded — apply it scoped to MCP paths.
  const urlencoded = express.urlencoded({ extended: false });
  app.use((req: any, res: any, next: any) => {
    if (isMcpPath(req.path)) return urlencoded(req, res, next);
    next();
  });

  app.use((req: any, res: any, next: any) => {
    if (!isMcpPath(req.path)) return next();
    const started = Date.now();
    res.on("finish", () => {
      const b: any = req.body || {};
      console.log(`[MCP] ${req.method} ${req.originalUrl}`, JSON.stringify({
        status: res.statusCode,
        ms: Date.now() - started,
        requestId: req.headers["x-request-id"] || req.headers["cf-ray"] || req.headers["anthropic-request-id"],
        userAgent: req.headers["user-agent"],
        accept: req.headers.accept,
        contentType: req.headers["content-type"],
        body: req.path.startsWith("/mcp") ? { jsonrpc: b.jsonrpc, id: b.id, method: b.method, tool: b.params?.name, argKeys: b.params?.arguments ? Object.keys(b.params.arguments) : [] } : undefined,
      }));
    });
    next();
  });

  app.get("/mcp/health", (req: any, res: any) => { res.json({ ok: true, name: "vito-mcp", transport: "@modelcontextprotocol/sdk StreamableHTTP", url: baseUrl(req) }); });

  function sendProtectedResourceMetadata(req: any, res: any) {
    const base = baseUrl(req);
    const suffix = req.path.replace("/.well-known/oauth-protected-resource", "") || "/mcp";
    res.json({
      resource: `${base}${suffix}`,
      authorization_servers: [base],
      scopes_supported: [],
      bearer_methods_supported: ["header"],
      resource_name: "Vito MCP",
      resource_documentation: `${base}/mcp/health`,
    });
  }
  app.get("/.well-known/oauth-protected-resource", sendProtectedResourceMetadata);
  app.get("/.well-known/oauth-protected-resource/mcp", sendProtectedResourceMetadata);
  app.get("/.well-known/oauth-authorization-server", (req: any, res: any) => {
    const base = baseUrl(req);
    res.json({ issuer: base, authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`, response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token", "client_credentials"], code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic", "none"] });
  });

  function verifyStaticClient(submittedId: string, submittedSecret: unknown): boolean {
    if (submittedId !== STATIC_CLIENT_ID) return false;
    if (typeof submittedSecret !== "string") return false;
    const a = Buffer.from(submittedSecret);
    const b = Buffer.from(STATIC_CLIENT_SECRET);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  app.get("/authorize", (req: any, res: any) => {
    const clientId = String(req.query.client_id || "");
    const redirectUri = String(req.query.redirect_uri || "");
    const state = String(req.query.state || "");
    const codeChallenge = req.query.code_challenge ? String(req.query.code_challenge) : undefined;
    if (clientId !== STATIC_CLIENT_ID) {
      res.status(400).send("Invalid OAuth client");
      return;
    }
    if (!redirectUri) {
      res.status(400).send("Missing redirect_uri");
      return;
    }
    const code = randomId("code_");
    authCodes.set(code, { code, client_id: clientId, redirect_uri: redirectUri, code_challenge: codeChallenge, expires_at: Date.now() + 10 * 60 * 1000 });
    const url = new URL(redirectUri);
    url.searchParams.set("code", code);
    if (state) url.searchParams.set("state", state);
    res.redirect(url.toString());
  });

  app.post("/token", (req: any, res: any) => {
    const grantType = String(req.body?.grant_type || "");
    const submittedClientId = getSubmittedClientId(req);
    const submittedClientSecret = getSubmittedClientSecret(req);
    console.log("[MCP] token request", JSON.stringify({ grantType, clientId: submittedClientId, hasClientSecret: !!submittedClientSecret, authScheme: String(req.headers.authorization || "").split(" ")[0] || "none", hasCode: !!req.body?.code, hasVerifier: !!req.body?.code_verifier, resource: req.body?.resource }));
    if (grantType === "client_credentials") {
      if (!verifyStaticClient(submittedClientId, submittedClientSecret)) {
        res.status(401).json({ error: "invalid_client" });
        return;
      }
      sendToken(res, issueToken(submittedClientId));
      return;
    }
    if (grantType === "authorization_code") {
      const record = authCodes.get(String(req.body?.code || ""));
      if (!record || record.expires_at < Date.now()) {
        res.status(400).json({ error: "invalid_grant" });
        return;
      }
      if (!verifyStaticClient(record.client_id, submittedClientSecret)) {
        res.status(401).json({ error: "invalid_client" });
        return;
      }
      if (String(req.body?.redirect_uri || "") !== record.redirect_uri || !verifyPkce(req.body?.code_verifier, record.code_challenge)) {
        res.status(400).json({ error: "invalid_grant" });
        return;
      }
      authCodes.delete(record.code);
      sendToken(res, issueToken(record.client_id));
      return;
    }
    if (grantType === "refresh_token") {
      const old = refreshTokens.get(String(req.body?.refresh_token || ""));
      if (!old) {
        res.status(400).json({ error: "invalid_grant" });
        return;
      }
      accessTokens.delete(old.access_token);
      refreshTokens.delete(old.refresh_token);
      sendToken(res, issueToken(old.client_id));
      return;
    }
    res.status(400).json({ error: "unsupported_grant_type" });
  });

  async function handleSdkMcp(req: any, res: any, parsedBody?: unknown) {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, parsedBody);
      res.on("close", () => { transport.close(); server.close(); });
    } catch (err: any) {
      console.error("[MCP] SDK handler error", { message: err?.message, stack: err?.stack });
      if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: err?.message || "Internal server error" }, id: null });
    }
  }

  app.post("/mcp", requireBearer, async (req: any, res: any) => { await handleSdkMcp(req, res, req.body); });
  app.get("/mcp", requireBearer, async (req: any, res: any) => { await handleSdkMcp(req, res); });
  app.delete("/mcp", requireBearer, async (_req: any, res: any) => {
    res.status(405).setHeader("Allow", "POST, GET").json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null });
  });

  console.log(`[MCP] mounted on dashboard /mcp (bash root: ${BASH_ROOT}; static client: ${STATIC_CLIENT_ID.slice(0, 8)}…)`);
}
