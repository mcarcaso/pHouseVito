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
  traceMessageUpdates?: boolean;
  /** Optional prefix for trace file name (e.g., "profile" → trace-profile-...) */
  tracePrefix?: string;
}

type TraceLine =
  | { type: "header"; timestamp: string; session_id: string; channel: string; target: string; model: string; harness: string }
  | { type: "invocation"; command: string }
  | { type: "prompt"; content: string; length: number }
  | { type: "user_message"; content: string }
  | { type: "raw_event"; ts: number; event: unknown }
  | { type: "normalized_event"; ts: number; event: NormalizedEvent }
  | { type: "memory_search"; query: string; duration_ms: number; results_found: number; results_injected: number; results: unknown[]; skipped?: string }
  | { type: "embedding_result"; skipped?: string; chunks_created: number; chunks: unknown[]; unembedded_messages: number; unembedded_chars: number; duration_ms: number }
  | { type: "profile_update"; skipped?: string; updated: boolean; duration_ms: number; traceFile?: string }
  | { type: "footer"; duration_ms: number; message_count: number; tool_calls: number; success: boolean; error?: string };

export class TracingHarness extends ProxyHarness {
  private traceFile: string = "";
  private readonly options: TracingOptions;
  private readonly traceMessageUpdates: boolean;
  private truncated: boolean = false;

  constructor(delegate: Harness, options: TracingOptions) {
    super(delegate);
    this.options = options;
    this.traceMessageUpdates = options.traceMessageUpdates ?? false;
  }

  private pendingLines: TraceLine[] = [];

  get tracePath(): string {
    return this.traceFile;
  }

  /**
   * Queue a trace line to be written before the run starts.
   * Used for pre-run context like memory search results that happen
   * before the trace file is created.
   */
  writePreRunLine(line: TraceLine): void {
    this.pendingLines.push(line);
  }

  /**
   * Write a trace line after the run has completed (after footer).
   * Used for background tasks like embeddings and profile updates
   * that fire after the main LLM response.
   */
  writePostRunLine(line: TraceLine): void {
    if (!this.traceFile) return; // No trace file created yet (shouldn't happen)
    this.writeLine(line);
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

  private isMessageUpdateEvent(event: unknown): boolean {
    if (!event || typeof event !== "object") return false;
    const type = (event as { type?: unknown }).type;
    return type === "message_update";
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
    const prefix = this.options.tracePrefix ? `trace-${this.options.tracePrefix}` : "trace";
    this.traceFile = join("logs", `${prefix}-${timestamp}-${suffix}.jsonl`);
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

    // Flush any pre-run lines (e.g., memory search results)
    for (const line of this.pendingLines) {
      this.writeLine(line);
    }
    this.pendingLines = [];

    const tracingCallbacks: HarnessCallbacks = {
      onInvocation: (cliCommand: string) => {
        this.writeLine({ type: "invocation", command: cliCommand });
        callbacks.onInvocation?.(cliCommand);
      },

      onRawEvent: (event: unknown) => {
        if (this.traceMessageUpdates || !this.isMessageUpdateEvent(event)) {
          this.writeLine({ type: "raw_event", ts: Date.now() - startTime, event });
        }
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
