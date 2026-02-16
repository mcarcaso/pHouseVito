/**
 * TRACING HARNESS
 *
 * Decorator that logs all harness events to a .jsonl trace file.
 */

import { appendFileSync, mkdirSync, statSync } from "fs";
import { dirname, join } from "path";
import { ProxyHarness } from "./proxy.js";
import type { Harness, HarnessCallbacks, NormalizedEvent } from "./types.js";

// Max trace file size: 50MB (prevents runaway traces from filling disk)
const MAX_TRACE_SIZE_BYTES = 50 * 1024 * 1024;

export interface TracingOptions {
  session_id: string;
  channel: string;
  target: string;
  model: string;
}

type TraceLine =
  | { type: "header"; timestamp: string; session_id: string; channel: string; target: string; model: string; harness: string }
  | { type: "invocation"; command: string }
  | { type: "prompt"; content: string; length: number }
  | { type: "user_message"; content: string }
  | { type: "raw_event"; ts: number; event: unknown }
  | { type: "normalized_event"; ts: number; event: NormalizedEvent }
  | { type: "footer"; duration_ms: number; message_count: number; tool_calls: number; success: boolean; error?: string };

export class TracingHarness extends ProxyHarness {
  private traceFile: string = "";
  private readonly options: TracingOptions;
  private truncated: boolean = false;

  constructor(delegate: Harness, options: TracingOptions) {
    super(delegate);
    this.options = options;
  }

  get tracePath(): string {
    return this.traceFile;
  }

  private writeLine(line: TraceLine): void {
    // Skip writes if we've already truncated
    if (this.truncated) return;
    
    // Check file size before writing
    try {
      const stats = statSync(this.traceFile);
      if (stats.size > MAX_TRACE_SIZE_BYTES) {
        appendFileSync(this.traceFile, JSON.stringify({ type: "truncated", reason: `Trace exceeded ${MAX_TRACE_SIZE_BYTES / 1024 / 1024}MB limit` }) + "\n");
        this.truncated = true;
        console.warn(`⚠️ Trace file truncated at ${(stats.size / 1024 / 1024).toFixed(1)}MB`);
        return;
      }
    } catch (e) {
      // File might not exist yet on first write
    }
    
    appendFileSync(this.traceFile, JSON.stringify(line) + "\n");
  }

  async run(
    systemPrompt: string,
    userMessage: string,
    callbacks: HarnessCallbacks,
    signal?: AbortSignal
  ): Promise<void> {
    // Create a fresh trace file for each run
    const timestamp = new Date().toISOString().replace(/:/g, "-");
    const suffix = Math.random().toString(36).slice(2, 8); // 6 random chars for uniqueness
    this.traceFile = join("logs", `trace-${timestamp}-${suffix}.jsonl`);
    mkdirSync(dirname(this.traceFile), { recursive: true });

    const startTime = Date.now();
    let messageCount = 0;
    let toolCalls = 0;
    let error: string | undefined;

    this.writeLine({
      type: "header",
      timestamp: new Date().toISOString(),
      session_id: this.options.session_id,
      channel: this.options.channel,
      target: this.options.target,
      model: this.options.model,
      harness: this.delegate.getName(),
    });

    this.writeLine({ type: "prompt", content: systemPrompt, length: systemPrompt.length });
    this.writeLine({ type: "user_message", content: userMessage });

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

export function withTracing(harness: Harness, options: TracingOptions): TracingHarness {
  return new TracingHarness(harness, options);
}
