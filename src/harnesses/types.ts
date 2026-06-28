/**
 * HARNESS INTERFACE
 *
 * A harness wraps an AI model/agent and provides a unified way to
 * send prompts, receive events, and manage long-lived session state.
 *
 * Two implementations are envisioned:
 *   - PiSessionHarness — in-process @earendil-works/pi-coding-agent AgentSession
 *   - ClaudeCodeHarness — subprocess `claude -p ... --resume <id>` CLI
 *
 * Both keep a stable system prompt across turns so Anthropic prompt caching
 * hits on every turn.
 */

// ════════════════════════════════════════════════════════════════════════════
// NORMALIZED EVENTS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Business events that match what we store in the messages table.
 */
export type NormalizedEvent =
  | { kind: "assistant"; content: string }
  | { kind: "tool_start"; tool: string; callId: string; args: unknown }
  | { kind: "tool_end"; tool: string; callId: string; result: string; success: boolean }
  | { kind: "error"; message: string };

export interface HarnessUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

// ════════════════════════════════════════════════════════════════════════════
// CALLBACKS
// ════════════════════════════════════════════════════════════════════════════

export interface HarnessCallbacks {
  /** Fired before execution starts, with CLI-equivalent command for tracing */
  onInvocation?: (cliCommand: string) => void;

  /** Every event from the underlying system, for tracing */
  onRawEvent: (event: unknown) => void;

  /** Business events we care about */
  onNormalizedEvent: (event: NormalizedEvent) => void;

  /** Optional per-run usage/cost summary, when the harness can expose it */
  onUsage?: (usage: HarnessUsage) => void;
}

// ════════════════════════════════════════════════════════════════════════════
// ERRORS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Thrown when a caller invokes a lifecycle method the harness doesn't support
 * (e.g., manual /compact on a harness that has no equivalent operation).
 */
export class HarnessUnsupportedError extends Error {
  constructor(public readonly operation: string, message?: string) {
    super(message ?? `Harness does not support: ${operation}`);
    this.name = "HarnessUnsupportedError";
  }
}

/**
 * Thrown when the underlying session storage is gone — e.g., the Claude Code
 * JSONL referenced by a stored session id was deleted from ~/.claude/projects/.
 * The orchestrator surfaces this and instructs the user to run /new.
 */
export class HarnessSessionLostError extends Error {
  constructor(message?: string) {
    super(message ?? "Harness session is no longer available");
    this.name = "HarnessSessionLostError";
  }
}

// ════════════════════════════════════════════════════════════════════════════
// THE HARNESS
// ════════════════════════════════════════════════════════════════════════════

export interface Harness {
  /**
   * Unique harness identifier (e.g., "pi-coding-agent", "claude-code").
   */
  getName(): string;

  /**
   * Optional harness-specific instructions to inject into system prompt.
   * Use this when the harness environment has quirks the AI needs to know about
   * (e.g., "skills don't work via Skill tool, invoke scripts manually").
   */
  getCustomInstructions?(): string;

  /**
   * Run a prompt to completion.
   *
   * System prompt has tools embedded.
   * User message has attachment paths embedded.
   * Harness figures out the rest.
   *
   * The system prompt is set once on first call and reused on subsequent calls
   * — implementations should ignore `systemPrompt` after initialization so the
   * cached prefix stays stable. The orchestrator passes it on every call so
   * the harness can capture it lazily.
   */
  run(
    systemPrompt: string,
    userMessage: string,
    callbacks: HarnessCallbacks,
    signal?: AbortSignal
  ): Promise<void>;

  // ──────────────────────────────────────────────────────────────────────────
  // LIFECYCLE — optional. Orchestrator no-ops gracefully when missing.
  // ──────────────────────────────────────────────────────────────────────────

  /** Current model identifier for logging/tracing (e.g., "anthropic/claude-sonnet-4"). */
  getModel?(): string;

  /**
   * Hot-swap the model. May be a no-op if the underlying system can't change
   * model mid-session (in which case the new model takes effect on the next run).
   */
  setModel?(model: { provider: string; name: string; openRouterProvider?: string }): Promise<void>;

  /**
   * Reset session state. Equivalent to /new — the next run() call starts a
   * brand-new conversation. Implementations must persist any "fresh next
   * start" intent to disk so a server restart between /new and the next
   * message still results in a fresh session.
   */
  reset?(): Promise<void>;

  /**
   * Whether the next run() call will create a brand-new session (true) or
   * resume existing on-disk state (false). Used by the orchestrator to
   * decide whether to seed the first prompt with a <history> block from
   * Vito's own message DB.
   *
   * Default behavior when not implemented: pessimistic (false) — assume
   * the harness has its own state and don't seed.
   */
  isFresh?(): boolean;

  /**
   * Manually summarize older turns of the live session.
   * May throw HarnessUnsupportedError on harnesses without an equivalent.
   * Returns implementation-defined metadata (e.g., tokensBefore/tokensAfter).
   */
  compact?(customInstructions?: string): Promise<unknown>;

  /**
   * Tear down session resources. Called on shutdown. Should not throw.
   */
  dispose?(): Promise<void>;
}
