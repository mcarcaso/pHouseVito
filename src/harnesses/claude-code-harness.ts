/**
 * ClaudeCodeHarness — long-lived conversation via the Claude Code CLI.
 *
 * Architecture: stateless wrapper. We don't keep a process running; instead
 * each turn spawns `claude -p <msg> --resume <id> --output-format stream-json`
 * and parses the NDJSON event stream. The session id is captured on the first
 * spawn and persisted to <sessionDir>/session.json so a server restart can
 * still resume.
 *
 * The actual conversation JSONL lives wherever Claude Code stores it
 * (~/.claude/projects/<encoded-cwd>/<session-id>.jsonl). We just hold the
 * pointer; if that file is removed externally we surface a
 * HarnessSessionLostError and let the user run /new.
 *
 * Auth comes from `claude login` (the user's existing subscription/OAuth
 * tokens under ~/.claude/), not from any API key Vito holds.
 */

import { spawn } from "child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { discoverSkills } from "../skills/discovery.js";
import {
  HarnessSessionLostError,
  HarnessUnsupportedError,
  type Harness,
  type HarnessCallbacks,
  type HarnessUsage,
  type NormalizedEvent,
} from "./types.js";

const SESSION_FILE = "session.json";

export interface ClaudeCodeHarnessConfig {
  /** Directory holding session.json. One per Vito session id. */
  sessionDir?: string;
  /** Model name passed via --model. Provider is implicit (CC handles routing). */
  model?: { provider: string; name: string };
  /**
   * CC permission mode. "acceptEdits" lets Vito edit files non-interactively;
   * "default" requires prompts (only useful in headed CC, not -p). For Vito
   * we want fully autonomous, so "acceptEdits" is the sane default.
   */
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan";
  /** Path to the claude binary. Defaults to "claude" on PATH. */
  binaryPath?: string;
  /**
   * User-skills directory (e.g., user/skills/). Used to render a Vito skills
   * index into the harness instructions, since CC's built-in Skill tool does
   * not auto-discover them.
   */
  skillsDir?: string;
}

const DEFAULT_CONFIG: Required<Pick<ClaudeCodeHarnessConfig, "permissionMode" | "binaryPath">> = {
  // Vito runs CC fully autonomously — no user is sitting at a TTY to approve
  // tool calls. Bypass everything; the user opted into this when picking the
  // claude-code harness.
  permissionMode: "bypassPermissions",
  binaryPath: "claude",
};

interface SessionFile {
  sessionId: string;
}

interface CCInitEvent {
  type: "system";
  subtype: "init";
  session_id: string;
  model?: string;
}

interface CCResultEvent {
  type: "result";
  subtype: string;
  session_id?: string;
  is_error?: boolean;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

function ccUsageToHarnessUsage(usage: CCResultEvent["usage"], totalCostUsd: number | undefined): HarnessUsage {
  const input = usage?.input_tokens ?? 0;
  const output = usage?.output_tokens ?? 0;
  const cacheRead = usage?.cache_read_input_tokens ?? 0;
  const cacheWrite = usage?.cache_creation_input_tokens ?? 0;
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens: input + output + cacheRead + cacheWrite,
    cost: {
      // CC only exposes a single total. Leave per-component as 0 — consumers
      // that want a breakdown can compute from token counts + a price table.
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: totalCostUsd ?? 0,
    },
  };
}

/**
 * CC's "session not found" exit messages. Substring-matched on combined
 * stdout+stderr (case-insensitive). Conservative — false negatives just
 * mean we surface a generic error instead of the friendly /new prompt.
 */
const SESSION_LOST_HINTS = [
  "no conversation found",
  "session not found",
  "could not find session",
  "no such session",
];

function looksLikeSessionLost(output: string): boolean {
  const lower = output.toLowerCase();
  return SESSION_LOST_HINTS.some((hint) => lower.includes(hint));
}

export class ClaudeCodeHarness implements Harness {
  private config: ClaudeCodeHarnessConfig;
  private sessionId: string | null = null;
  private currentModelString: string;
  private cachedInstructions: string | null = null;

  constructor(config: ClaudeCodeHarnessConfig = {}) {
    this.config = config;
    this.currentModelString = config.model
      ? `${config.model.provider}/${config.model.name}`
      : "default";
    this.sessionId = this.readSessionFile();
  }

  getName(): string {
    return "claude-code";
  }

  /**
   * Harness-specific instructions injected into the system prompt.
   *
   * CC's built-in Skill tool only auto-discovers skills under .claude/skills/
   * paths — Vito's skills aren't there. So we list the discovered skills
   * inline (name, description, path) and tell the agent to Read SKILL.md
   * directly when invoking one. Computed lazily once per harness instance,
   * since skill set changes require a /new anyway.
   *
   * Other layout/rules already live in SYSTEM.md (which Vito loads into the
   * system prompt). Don't duplicate them here.
   */
  getCustomInstructions(): string {
    if (this.cachedInstructions !== null) return this.cachedInstructions;

    const lines: string[] = [];
    lines.push("You are running inside the Claude Code harness, fully non-interactive.");
    lines.push("");
    lines.push("Vito skills (CC's built-in Skill tool does NOT auto-discover these — Read the SKILL.md path directly to invoke one):");

    if (this.config.skillsDir) {
      const skills = discoverSkills(this.config.skillsDir);
      if (skills.length === 0) {
        lines.push("(none discovered)");
      } else {
        for (const skill of skills) {
          const tag = skill.isBuiltin ? "[builtin]" : "[user]";
          const desc = skill.description?.trim() || "(no description)";
          lines.push(`- ${skill.name} ${tag} — ${desc}`);
          lines.push(`    path: ${skill.path}`);
        }
      }
    } else {
      lines.push("(skills directory not configured)");
    }

    lines.push("");
    lines.push("New skills go under user/skills/<name>/SKILL.md — never src/skills/builtin/ (that's framework code).");

    this.cachedInstructions = lines.join("\n");
    return this.cachedInstructions;
  }

  getModel(): string {
    return this.currentModelString;
  }

  /**
   * Stash the new model selection. CC reads --model per spawn, so the change
   * takes effect on the next run() — there's no live process to mutate.
   */
  async setModel(model: { provider: string; name: string }): Promise<void> {
    this.config = { ...this.config, model };
    this.currentModelString = `${model.provider}/${model.name}`;
  }

  /**
   * /compact has no equivalent in `claude -p` mode — compaction is an
   * interactive concept inside the live CC TUI. Surface as unsupported so
   * the orchestrator tells the user.
   */
  async compact(): Promise<unknown> {
    throw new HarnessUnsupportedError("compact", "Claude Code does not support manual compaction in non-interactive mode.");
  }

  /**
   * /new — drop the stored session id (so the next run starts fresh) and
   * delete the pointer file from disk. We deliberately don't try to delete
   * the session JSONL under ~/.claude/projects/ — that's CC's storage and
   * the user may want it as history.
   */
  async reset(): Promise<void> {
    this.sessionId = null;
    if (this.config.sessionDir) {
      const file = join(this.config.sessionDir, SESSION_FILE);
      try { if (existsSync(file)) unlinkSync(file); } catch { /* ignore */ }
    }
  }

  async dispose(): Promise<void> {
    // Stateless wrapper — nothing to tear down.
  }

  isFresh(): boolean {
    return this.sessionId === null;
  }

  async run(
    systemPrompt: string,
    userMessage: string,
    callbacks: HarnessCallbacks,
    signal?: AbortSignal
  ): Promise<void> {
    const binary = this.config.binaryPath ?? DEFAULT_CONFIG.binaryPath;
    const permissionMode = this.config.permissionMode ?? DEFAULT_CONFIG.permissionMode;

    const args: string[] = [
      "-p",
      userMessage,
      "--output-format", "stream-json",
      // stream-json with -p requires --verbose in current CC versions.
      "--verbose",
      "--permission-mode", permissionMode,
    ];

    if (this.config.model) {
      args.push("--model", this.config.model.name);
    }

    if (this.sessionId) {
      args.push("--resume", this.sessionId);
    } else {
      // First turn for this Vito session: append Vito's prompt to CC's defaults
      // rather than replacing them. CC's defaults carry tool guidance we want
      // to keep.
      args.push("--append-system-prompt", systemPrompt);
    }

    callbacks.onInvocation?.(this.buildCliCommandPreview(args));

    const proc = spawn(binary, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Track callId → tool name so we can backfill tool_end events (CC's
    // tool_result blocks reference tool_use_id but not the tool name).
    const callIdToToolName = new Map<string, string>();

    let stderrBuf = "";
    let stdoutTail = ""; // last bytes of stdout for error matching when we exit non-zero
    let lineBuf = "";
    let aborted = false;

    const abortHandler = () => {
      aborted = true;
      try { proc.kill("SIGTERM"); } catch { /* ignore */ }
    };
    signal?.addEventListener("abort", abortHandler);

    proc.stderr.setEncoding("utf8");
    proc.stderr.on("data", (chunk: string) => {
      stderrBuf += chunk;
      // Cap stderr buffer at 16K to avoid runaway memory if CC dumps a wall.
      if (stderrBuf.length > 16384) stderrBuf = stderrBuf.slice(-16384);
    });

    let finalUsage: HarnessUsage | undefined;
    let resultErrorMessage: string | undefined;

    const handleEvent = (event: unknown) => {
      callbacks.onRawEvent(event);
      if (!event || typeof event !== "object") return;

      const ev = event as Record<string, unknown>;
      const type = ev.type;

      if (type === "system" && ev.subtype === "init") {
        const init = ev as unknown as CCInitEvent;
        if (init.session_id && !this.sessionId) {
          this.sessionId = init.session_id;
          this.writeSessionFile({ sessionId: init.session_id });
        }
        if (typeof init.model === "string") {
          this.currentModelString = init.model;
        }
        return;
      }

      if (type === "assistant") {
        const message = ev.message as Record<string, unknown> | undefined;
        const content = Array.isArray(message?.content) ? (message!.content as unknown[]) : [];
        for (const block of content) {
          if (!block || typeof block !== "object") continue;
          const b = block as Record<string, unknown>;
          if (b.type === "text" && typeof b.text === "string" && b.text.length > 0) {
            const norm: NormalizedEvent = { kind: "assistant", content: b.text };
            callbacks.onNormalizedEvent(norm);
          } else if (b.type === "tool_use") {
            const callId = typeof b.id === "string" ? b.id : "";
            const tool = typeof b.name === "string" ? b.name : "unknown";
            if (callId) callIdToToolName.set(callId, tool);
            callbacks.onNormalizedEvent({
              kind: "tool_start",
              tool,
              callId,
              args: b.input ?? {},
            });
          }
        }
        return;
      }

      if (type === "user") {
        const message = ev.message as Record<string, unknown> | undefined;
        const content = Array.isArray(message?.content) ? (message!.content as unknown[]) : [];
        for (const block of content) {
          if (!block || typeof block !== "object") continue;
          const b = block as Record<string, unknown>;
          if (b.type === "tool_result") {
            const callId = typeof b.tool_use_id === "string" ? b.tool_use_id : "";
            const tool = callIdToToolName.get(callId) ?? "unknown";
            const isError = b.is_error === true;
            const result = serializeToolResult(b.content);
            callbacks.onNormalizedEvent({
              kind: "tool_end",
              tool,
              callId,
              result,
              success: !isError,
            });
          }
        }
        return;
      }

      if (type === "result") {
        const result = ev as unknown as CCResultEvent;
        finalUsage = ccUsageToHarnessUsage(result.usage, result.total_cost_usd);
        if (result.is_error) {
          resultErrorMessage = (typeof ev.result === "string" ? ev.result : undefined)
            ?? `claude exited with subtype=${result.subtype}`;
        }
        return;
      }
    };

    try {
      proc.stdout.setEncoding("utf8");
      for await (const chunk of proc.stdout as AsyncIterable<string>) {
        stdoutTail = (stdoutTail + chunk).slice(-4096);
        lineBuf += chunk;
        let nl = lineBuf.indexOf("\n");
        while (nl !== -1) {
          const line = lineBuf.slice(0, nl).trim();
          lineBuf = lineBuf.slice(nl + 1);
          if (line.length > 0) {
            try {
              handleEvent(JSON.parse(line));
            } catch {
              callbacks.onRawEvent({ type: "parse_error", line });
            }
          }
          nl = lineBuf.indexOf("\n");
        }
      }
      // Flush any trailing partial line (rare — CC always terminates lines)
      const tail = lineBuf.trim();
      if (tail.length > 0) {
        try { handleEvent(JSON.parse(tail)); } catch { /* ignore */ }
      }

      const exitCode: number = await new Promise((resolve) => {
        if (proc.exitCode !== null) resolve(proc.exitCode);
        else proc.once("exit", (code) => resolve(code ?? 0));
      });

      if (aborted) {
        callbacks.onNormalizedEvent({ kind: "error", message: "aborted" });
        return;
      }

      if (exitCode !== 0) {
        const combined = `${stdoutTail}\n${stderrBuf}`;
        if (looksLikeSessionLost(combined) && this.sessionId) {
          // The id we held is stale. Clear it so /new gives a clean slate.
          this.sessionId = null;
          throw new HarnessSessionLostError(
            `Claude Code session ${this.sessionId ?? "(unknown)"} not found on disk.`
          );
        }
        const msg = stderrBuf.trim() || `claude exited with code ${exitCode}`;
        callbacks.onNormalizedEvent({ kind: "error", message: msg });
        throw new Error(msg);
      }

      if (resultErrorMessage) {
        callbacks.onNormalizedEvent({ kind: "error", message: resultErrorMessage });
        throw new Error(resultErrorMessage);
      }

      if (finalUsage) {
        callbacks.onUsage?.(finalUsage);
      }
    } finally {
      signal?.removeEventListener("abort", abortHandler);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // INTERNAL
  // ──────────────────────────────────────────────────────────────────────────

  private readSessionFile(): string | null {
    if (!this.config.sessionDir) return null;
    const file = join(this.config.sessionDir, SESSION_FILE);
    try {
      if (!existsSync(file)) return null;
      const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<SessionFile>;
      return typeof parsed.sessionId === "string" ? parsed.sessionId : null;
    } catch {
      return null;
    }
  }

  private writeSessionFile(data: SessionFile): void {
    if (!this.config.sessionDir) return;
    try {
      mkdirSync(this.config.sessionDir, { recursive: true });
      writeFileSync(join(this.config.sessionDir, SESSION_FILE), JSON.stringify(data));
    } catch (err) {
      console.warn("[claude-code] Failed to persist session id:", err);
    }
  }

  private buildCliCommandPreview(args: string[]): string {
    const escape = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
    return [this.config.binaryPath ?? DEFAULT_CONFIG.binaryPath, ...args.map(escape)].join(" ");
  }
}

function serializeToolResult(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const b = block as Record<string, unknown>;
      if (typeof b.text === "string") parts.push(b.text);
      else parts.push(JSON.stringify(b));
    }
    return parts.join("\n");
  }
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}
