/**
 * TRACING PI RUNTIME
 *
 * Decorator that logs all runtime events to a .jsonl trace file.
 */

import { join } from "node:path";
import type { Context } from "../../../context/Context.js";
import type { WritableTraceEventData } from "../../../shared/schemas/trace-event.js";
import { xLogsDir, xTraceEventStore, xTraceStore } from "../../../lib/x.js";
import { TraceSizeLimitError } from "../../../stores/traces/FileTraceEventStore.js";
import { ProxyPiRuntime } from "./ProxyPiRuntime.js";
import type { PiRuntime, PiRuntimeCallbacks, PiRuntimeUsage } from "./PiRuntime.js";

export interface TracingOptions {
  x: Context;
  session_id: string;
  channel: string;
  target: string;
  model: string;
  traceMessageUpdates?: boolean;
  /** Optional prefix for trace file name (e.g., "profile" → trace-profile-...) */
  tracePrefix?: string;
}

type TraceLine = WritableTraceEventData;

export class TracingPiRuntime extends ProxyPiRuntime {
  private traceId: string = "";
  private readonly options: TracingOptions;
  private readonly traceMessageUpdates: boolean;
  private truncated: boolean = false;

  constructor(delegate: PiRuntime, options: TracingOptions) {
    super(delegate);
    this.options = options;
    this.traceMessageUpdates = options.traceMessageUpdates ?? false;
  }

  private pendingLines: TraceLine[] = [];

  get tracePath(): string {
    return this.traceId ? join(xLogsDir(this.options.x), this.traceId) : "";
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
    if (!this.traceId) return; // No trace created yet (shouldn't happen)
    this.writeLine(line);
  }

  private writeLine(line: TraceLine): void {
    if (this.truncated) return;
    try {
      xTraceEventStore(this.options.x).create(this.options.x, {
        traceId: this.traceId,
        data: line,
      });
    } catch (error) {
      if (!(error instanceof TraceSizeLimitError)) throw error;
      this.truncated = true;
      console.warn("⚠️ Trace truncated at 50MB");
    }
  }

  private isMessageUpdateEvent(event: unknown): boolean {
    if (!event || typeof event !== "object") return false;
    const type = (event as { type?: unknown }).type;
    return type === "message_update";
  }

  async run(
    systemPrompt: string,
    userMessage: string,
    callbacks: PiRuntimeCallbacks,
    signal?: AbortSignal
  ): Promise<void> {
    const timestamp = new Date().toISOString();
    const traceType = this.options.tracePrefix === "classifier" || this.options.tracePrefix === "profile"
      ? this.options.tracePrefix
      : "main";
    const trace = xTraceStore(this.options.x).create(this.options.x, {
      traceType,
      timestamp,
      sessionId: this.options.session_id,
      channel: this.options.channel,
      target: this.options.target,
      model: this.options.model,
      harness: this.delegate.getName(),
    });
    this.traceId = trace.id;
    this.truncated = false;

    const startTime = Date.now();
    let messageCount = 0;
    let toolCalls = 0;
    let error: string | undefined;
    let usage: PiRuntimeUsage | undefined;

    this.writeLine({ type: "prompt", content: systemPrompt, length: systemPrompt.length });
    this.writeLine({ type: "user_message", content: userMessage });

    // Flush any pre-run lines (e.g., memory search results)
    for (const line of this.pendingLines) {
      this.writeLine(line);
    }
    this.pendingLines = [];

    const tracingCallbacks: PiRuntimeCallbacks = {
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

      onUsage: (runUsage) => {
        usage = runUsage;
        callbacks.onUsage?.(runUsage);
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
        usage,
      });
    }
  }
}

export function withTracing(runtime: PiRuntime, options: TracingOptions): TracingPiRuntime {
  return new TracingPiRuntime(runtime, options);
}
