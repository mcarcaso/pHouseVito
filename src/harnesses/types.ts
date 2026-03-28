/**
 * HARNESS INTERFACE
 * 
 * A harness wraps an AI model/agent and provides a unified way to
 * send prompts and receive events. Dead simple.
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
}

// ════════════════════════════════════════════════════════════════════════════
// THE HARNESS
// ════════════════════════════════════════════════════════════════════════════

export interface Harness {
  /**
   * Unique harness identifier (e.g., "pi-coding-agent", "claude-code")
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
   */
  run(
    systemPrompt: string,
    userMessage: string,
    callbacks: HarnessCallbacks,
    signal?: AbortSignal
  ): Promise<void>;

}

// ════════════════════════════════════════════════════════════════════════════
// FACTORY (for config/dashboard)
// ════════════════════════════════════════════════════════════════════════════

export interface HarnessFactory {
  readonly name: string;
  readonly displayName: string;

  create(config: unknown): Harness;
  getConfigSchema(): unknown;  // JSON Schema for dashboard UI
  getDefaultConfig(): unknown;
}
