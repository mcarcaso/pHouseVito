/**
 * PROXY HARNESS
 * 
 * Base class for harness decorators. Implements the Harness interface
 * and delegates all calls to a wrapped harness.
 * 
 * Extend this to add behavior (logging, tracing, retries, etc.)
 * without modifying the underlying harness.
 */

import type { Harness, HarnessCallbacks } from "./types.js";

// ════════════════════════════════════════════════════════════════════════════
// PROXY HARNESS (Base Decorator)
// ════════════════════════════════════════════════════════════════════════════

export class ProxyHarness implements Harness {
  protected readonly delegate: Harness;

  constructor(delegate: Harness) {
    this.delegate = delegate;
  }

  getName(): string {
    return this.delegate.getName();
  }

  getCustomInstructions(): string {
    return this.delegate.getCustomInstructions?.() || "";
  }

  async run(
    systemPrompt: string,
    userMessage: string,
    callbacks: HarnessCallbacks,
    signal?: AbortSignal
  ): Promise<void> {
    return this.delegate.run(systemPrompt, userMessage, callbacks, signal);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// TRACING HARNESS (Decorator that logs all events)
// ════════════════════════════════════════════════════════════════════════════

import { appendFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import type { NormalizedEvent } from "./types.js";

/**
 * Options for creating a tracing harness
 */
export interface TracingOptions {
  session_id: string;
  channel: string;
  target: string;
  model: string;
}

/**
 * Trace line types for the .jsonl file — matches src/traceTypes.ts
 */
type TraceLine =
  | { type: "header"; timestamp: string; session_id: string; channel: string; target: string; model: string; harness: string }
  | { type: "invocation"; command: string }
  | { type: "prompt"; content: string; length: number }
  | { type: "user_message"; content: string }
  | { type: "raw_event"; ts: number; event: unknown }
  | { type: "normalized_event"; ts: number; event: NormalizedEvent }
  | { type: "footer"; duration_ms: number; message_count: number; tool_calls: number; success: boolean; error?: string };

export class TracingHarness extends ProxyHarness {
  private readonly traceFile: string;
  private readonly options: TracingOptions;

  constructor(delegate: Harness, options: TracingOptions) {
    super(delegate);
    this.options = options;
    // Auto-generate trace file path with timestamp
    const timestamp = new Date().toISOString().replace(/:/g, "-");
    this.traceFile = join("logs", `trace-${timestamp}.jsonl`);
  }

  /** Get the path to the trace file */
  get tracePath(): string {
    return this.traceFile;
  }

  private writeLine(line: TraceLine): void {
    appendFileSync(this.traceFile, JSON.stringify(line) + "\n");
  }

  async run(
    systemPrompt: string,
    userMessage: string,
    callbacks: HarnessCallbacks,
    signal?: AbortSignal
  ): Promise<void> {
    // Ensure trace directory exists
    mkdirSync(dirname(this.traceFile), { recursive: true });

    const startTime = Date.now();
    let messageCount = 0;
    let toolCalls = 0;
    let error: string | undefined;

    // Write header
    this.writeLine({
      type: "header",
      timestamp: new Date().toISOString(),
      session_id: this.options.session_id,
      channel: this.options.channel,
      target: this.options.target,
      model: this.options.model,
      harness: this.delegate.getName(),
    });

    // Write prompt and user message
    this.writeLine({ type: "prompt", content: systemPrompt, length: systemPrompt.length });
    this.writeLine({ type: "user_message", content: userMessage });

    // Wrap callbacks to intercept and log events
    const tracingCallbacks: HarnessCallbacks = {
      onInvocation: (cliCommand: string) => {
        this.writeLine({ type: "invocation", command: cliCommand });
        callbacks.onInvocation?.(cliCommand);
      },

      onRawEvent: (event: unknown) => {
        this.writeLine({ type: "raw_event", ts: Date.now() - startTime, event });
        callbacks.onRawEvent(event);
      },

      onNormalizedEvent: (event) => {
        // Count business events for footer stats
        if (event.kind === "assistant") messageCount++;
        if (event.kind === "tool_start") toolCalls++;

        this.writeLine({ type: "normalized_event", ts: Date.now() - startTime, event });
        callbacks.onNormalizedEvent(event);
      },
    };

    try {
      await this.delegate.run(systemPrompt, userMessage, tracingCallbacks, signal);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      // Write footer
      this.writeLine({
        type: "footer",
        duration_ms: Date.now() - startTime,
        message_count: messageCount,
        tool_calls: toolCalls,
        success: !error,
        error,
      });
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// FACTORY FUNCTION
// ════════════════════════════════════════════════════════════════════════════

/**
 * Wrap a harness with tracing.
 *
 * Usage:
 *   const traced = withTracing(harness, { session_id, channel, target, model });
 */
export function withTracing(harness: Harness, options: TracingOptions): TracingHarness {
  return new TracingHarness(harness, options);
}
