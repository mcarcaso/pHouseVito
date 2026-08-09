/**
 * Per-turn Pi execution contract used by the runtime decorator pipeline.
 * Lifecycle methods stay on PiSessionRuntime, which the orchestrator owns.
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

export interface PiRuntimeUsage {
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

export interface PiRuntimeCallbacks {
  /** Fired before execution starts, with CLI-equivalent command for tracing */
  onInvocation?: (cliCommand: string) => void;

  /** Every event from the underlying system, for tracing */
  onRawEvent: (event: unknown) => void;

  /** Business events we care about */
  onNormalizedEvent: (event: NormalizedEvent) => void;

  /** Optional per-run usage/cost summary, when the runtime can expose it */
  onUsage?: (usage: PiRuntimeUsage) => void;
}

// ════════════════════════════════════════════════════════════════════════════
// PI RUNTIME
// ════════════════════════════════════════════════════════════════════════════

export interface PiRuntime {
  /** Runtime identifier used in trace metadata. */
  getName(): string;

  /**
   * Run a prompt to completion.
   *
   * System prompt has tools embedded.
   * User message has attachment paths embedded.
   * Pi handles model and tool execution.
   *
   * The system prompt is set once on first call and reused on subsequent calls
   * — implementations should ignore `systemPrompt` after initialization so the
   * cached prefix stays stable. The orchestrator passes it on every call so
   * the runtime can capture it lazily.
   */
  run(
    systemPrompt: string,
    userMessage: string,
    callbacks: PiRuntimeCallbacks,
    signal?: AbortSignal
  ): Promise<void>;
}
