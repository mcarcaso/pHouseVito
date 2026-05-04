/**
 * Long-lived Pi Session Harness (v2)
 *
 * Wraps @mariozechner/pi-coding-agent so a single AgentSession is reused across
 * multiple inbound user messages within the same Vito session. This is what
 * unlocks Anthropic prompt caching: the system prompt is set once at session
 * creation and the conversation history grows inside pi's own state, so every
 * subsequent turn can hit the cache.
 *
 * Lifecycle:
 *   - First call to run(): captures the system prompt, creates the AgentSession.
 *   - Subsequent run() calls: ignore the systemPrompt argument, reuse the
 *     existing AgentSession, just call .prompt(userMessage).
 *   - dispose(): tears down the AgentSession (called from /new, shutdown).
 */

import { getModel } from "@mariozechner/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager as PiSessionManager,
  type AgentSession,
  type AgentSessionEvent,
} from "@mariozechner/pi-coding-agent";
import { discoverSkills } from "../skills/discovery.js";
import type { Harness, HarnessCallbacks, HarnessUsage, NormalizedEvent } from "../harnesses/types.js";

export interface PiSessionHarnessConfig {
  model?: { provider: string; name: string };
  thinkingLevel?: "off" | "low" | "medium" | "high";
  skillsDir?: string;
}

const DEFAULT_CONFIG: PiSessionHarnessConfig = {
  model: { provider: "anthropic", name: "claude-sonnet-4-20250514" },
  thinkingLevel: "off",
};

function toUsage(value: unknown): HarnessUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const usage = value as Record<string, unknown>;
  const cost = (usage.cost && typeof usage.cost === "object") ? usage.cost as Record<string, unknown> : {};
  const input = Number(usage.input ?? 0);
  const output = Number(usage.output ?? 0);
  const cacheRead = Number(usage.cacheRead ?? 0);
  const cacheWrite = Number(usage.cacheWrite ?? 0);
  const totalTokens = Number(usage.totalTokens ?? (input + output + cacheRead + cacheWrite));
  return {
    input, output, cacheRead, cacheWrite, totalTokens,
    cost: {
      input: Number(cost.input ?? 0),
      output: Number(cost.output ?? 0),
      cacheRead: Number(cost.cacheRead ?? 0),
      cacheWrite: Number(cost.cacheWrite ?? 0),
      total: Number(cost.total ?? 0),
    },
  };
}

function addUsage(a: HarnessUsage | undefined, b: HarnessUsage | undefined): HarnessUsage | undefined {
  if (!a) return b;
  if (!b) return a;
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    totalTokens: a.totalTokens + b.totalTokens,
    cost: {
      input: a.cost.input + b.cost.input,
      output: a.cost.output + b.cost.output,
      cacheRead: a.cost.cacheRead + b.cost.cacheRead,
      cacheWrite: a.cost.cacheWrite + b.cost.cacheWrite,
      total: a.cost.total + b.cost.total,
    },
  };
}

function getAssistantUsageFromMessage(message: unknown): HarnessUsage | undefined {
  if (!message || typeof message !== "object") return undefined;
  const msg = message as Record<string, unknown>;
  if (msg.role !== "assistant") return undefined;
  return toUsage(msg.usage);
}

export class PiSessionHarness implements Harness {
  private config: PiSessionHarnessConfig;
  private piSession: AgentSession | null = null;
  private storedSystemPrompt: string | null = null;
  private aborted = false;

  constructor(config: PiSessionHarnessConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  getName(): string {
    return "pi-session";
  }

  getCustomInstructions(): string {
    return "";
  }

  /** Whether the underlying AgentSession has been created and is reusable. */
  isInitialized(): boolean {
    return this.piSession !== null;
  }

  /**
   * Tear down the AgentSession. Called on /new (clean slate) or shutdown.
   * After dispose, the next run() call will create a fresh session.
   */
  async dispose(): Promise<void> {
    if (this.piSession) {
      try {
        await this.piSession.abort();
      } catch {
        // ignore
      }
      try {
        this.piSession.dispose();
      } catch {
        // ignore
      }
      this.piSession = null;
      this.storedSystemPrompt = null;
    }
  }

  async run(
    systemPrompt: string,
    userMessage: string,
    callbacks: HarnessCallbacks,
    signal?: AbortSignal
  ): Promise<void> {
    this.aborted = false;

    // Lazily create the AgentSession on first call. The system prompt is captured here;
    // later calls reuse the same session and ignore the systemPrompt argument so the
    // cached prefix stays stable.
    if (!this.piSession) {
      const additionalSkillPaths = this.config.skillsDir
        ? discoverSkills(this.config.skillsDir).map((skill) => skill.path)
        : [];

      const resourceLoader = new DefaultResourceLoader({
        cwd: process.cwd(),
        agentDir: process.cwd(),
        noExtensions: true,
        noPromptTemplates: true,
        noThemes: true,
        additionalSkillPaths,
        systemPrompt,
      });
      await resourceLoader.reload();

      const modelConfig = this.config.model || DEFAULT_CONFIG.model!;
      const model = getModel(modelConfig.provider as any, modelConfig.name as any);

      const { session: piSession } = await createAgentSession({
        sessionManager: PiSessionManager.inMemory(),
        model,
        resourceLoader,
        thinkingLevel: this.config.thinkingLevel || "off",
      });

      this.piSession = piSession;
      this.storedSystemPrompt = systemPrompt;
    }

    const piSession = this.piSession;

    // Wire abort. Each run() may bring its own AbortSignal; we relay to pi.abort().
    const abortHandler = async () => {
      this.aborted = true;
      try {
        await piSession.abort();
      } catch {
        // ignore
      }
    };
    signal?.addEventListener("abort", abortHandler);

    // Track text/thinking deltas for the in-flight assistant turn.
    let currentMessageText = "";
    let currentThinkingText = "";
    let hasEmittedAssistantText = false;
    let hasEmittedThought = false;
    let accumulatedUsage: HarnessUsage | undefined;
    let finalUsage: HarnessUsage | undefined;
    let hasEmittedUsage = false;

    const unsubscribe = piSession.subscribe((event: AgentSessionEvent) => {
      callbacks.onRawEvent(event);

      switch (event.type) {
        case "message_start":
          if (event.message.role === "assistant") {
            currentMessageText = "";
            currentThinkingText = "";
            hasEmittedAssistantText = false;
            hasEmittedThought = false;
          }
          break;

        case "message_update": {
          const msgEvent = event.assistantMessageEvent;
          if (msgEvent.type === "text_delta") {
            currentMessageText += msgEvent.delta;
          }
          break;
        }

        case "message_end":
          if (event.message.role === "assistant") {
            if ((!currentThinkingText || !currentMessageText) && Array.isArray((event.message as any)?.content)) {
              for (const block of (event.message as any).content) {
                if (!currentThinkingText && block?.type === "thinking" && typeof block.thinking === "string") {
                  currentThinkingText = block.thinking;
                }
                if (!currentMessageText && block?.type === "text" && typeof block.text === "string") {
                  currentMessageText = block.text;
                }
              }
            }

            if (currentThinkingText && !hasEmittedThought) {
              const ev: NormalizedEvent = { kind: "assistant", content: currentThinkingText };
              callbacks.onNormalizedEvent(ev);
              currentThinkingText = "";
              hasEmittedThought = true;
            }

            if (currentMessageText && !hasEmittedAssistantText) {
              const ev: NormalizedEvent = { kind: "assistant", content: currentMessageText };
              callbacks.onNormalizedEvent(ev);
              currentMessageText = "";
              hasEmittedAssistantText = true;
            }
          }
          break;

        case "turn_end":
          accumulatedUsage = addUsage(accumulatedUsage, getAssistantUsageFromMessage(event.message));
          break;

        case "agent_end":
          // For long-lived sessions, agent_end fires when the prompt() call settles.
          // event.messages contains the full conversation; only count usage from
          // assistant messages emitted in this turn (those have fresh usage). To stay
          // simple and avoid double counting across turns, we prefer accumulatedUsage.
          finalUsage = accumulatedUsage ?? finalUsage;
          break;

        case "tool_execution_start":
          callbacks.onNormalizedEvent({
            kind: "tool_start",
            tool: event.toolName,
            callId: event.toolCallId,
            args: event.args,
          });
          break;

        case "tool_execution_end":
          callbacks.onNormalizedEvent({
            kind: "tool_end",
            tool: event.toolName,
            callId: event.toolCallId,
            result: typeof event.result === "string" ? event.result : JSON.stringify(event.result),
            success: !event.isError,
          });
          break;
      }
    });

    callbacks.onInvocation?.(this.buildCliCommand(userMessage));

    try {
      await piSession.prompt(userMessage);

      if (currentThinkingText && !hasEmittedThought) {
        callbacks.onNormalizedEvent({ kind: "assistant", content: currentThinkingText });
        hasEmittedThought = true;
      }
      if (currentMessageText && !hasEmittedAssistantText) {
        callbacks.onNormalizedEvent({ kind: "assistant", content: currentMessageText });
        hasEmittedAssistantText = true;
      }

      const usage = finalUsage ?? accumulatedUsage;
      if (usage) {
        callbacks.onUsage?.(usage);
        hasEmittedUsage = true;
      }
    } catch (err) {
      if (this.aborted) {
        callbacks.onNormalizedEvent({ kind: "error", message: "aborted" });
      } else {
        const message = err instanceof Error ? err.message : String(err);
        callbacks.onNormalizedEvent({ kind: "error", message });
        throw err;
      }
    } finally {
      const usage = finalUsage ?? accumulatedUsage;
      if (usage && !hasEmittedUsage) {
        callbacks.onUsage?.(usage);
      }
      unsubscribe();
      signal?.removeEventListener("abort", abortHandler);
      // NOTE: do NOT dispose the session here — that's the whole point of v2.
    }
  }

  private buildCliCommand(userMessage: string): string {
    const modelConfig = this.config.model || DEFAULT_CONFIG.model!;
    const escape = (s: string) => s.replace(/'/g, "'\\''");
    return `pi-coding-agent --model ${modelConfig.provider}/${modelConfig.name} -p '${escape(userMessage)}' (long-lived session)`;
  }
}
