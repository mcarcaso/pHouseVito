/**
 * RELAY HARNESS
 *
 * Decorator that handles all output to the channel handler:
 * - Streaming relay (each assistant message as it arrives)
 * - Bundled relay (all messages joined after run)
 * - Final relay (last message only after run)
 * - Tool event relay (tool_start/tool_end forwarded to handler)
 * - Error/interrupt relay
 */

import type { OutputHandler, StreamMode } from "../types.js";
import { ProxyHarness } from "./proxy.js";
import type { Harness, HarnessCallbacks } from "./types.js";

export interface RelayOptions {
  handler: OutputHandler | null;
  streamMode: StreamMode;
}

export class RelayHarness extends ProxyHarness {
  private readonly handler: OutputHandler | null;
  private readonly streamMode: StreamMode;
  private completedMessages: string[] = [];

  constructor(delegate: Harness, opts: RelayOptions) {
    super(delegate);
    this.handler = opts.handler;
    this.streamMode = opts.streamMode;
  }

  async run(
    systemPrompt: string,
    userMessage: string,
    callbacks: HarnessCallbacks,
    signal?: AbortSignal
  ): Promise<void> {
    this.completedMessages = [];

    const relayCallbacks: HarnessCallbacks = {
      onInvocation: callbacks.onInvocation,
      onRawEvent: callbacks.onRawEvent,
      onNormalizedEvent: (event) => {
        if (event.kind === "assistant" && event.content) {
          this.completedMessages.push(event.content);

          if (this.streamMode === "stream" && this.handler) {
            this.handler.relay(event.content).catch((err: any) => {
              console.error(`[Relay] relay failed during stream: ${err.message}`);
            });
            this.handler.endMessage?.()?.catch((err: any) => {
              console.error(`[Relay] endMessage failed during stream: ${err.message}`);
            });
            this.handler.startTyping?.()?.catch(() => {});
          }
        }

        if (event.kind === "tool_start") {
          this.handler?.relayEvent?.({
            kind: "tool_start",
            toolName: event.tool,
            toolCallId: event.callId,
            args: event.args,
          })?.catch(() => {});
        } else if (event.kind === "tool_end") {
          this.handler?.relayEvent?.({
            kind: "tool_end",
            toolName: event.tool,
            toolCallId: event.callId,
            result: event.result,
            isError: !event.success,
          })?.catch(() => {});
        }

        callbacks.onNormalizedEvent(event);
      },
    };

    try {
      await this.delegate.run(systemPrompt, userMessage, relayCallbacks, signal);
    } catch (err) {
      if (signal?.aborted && this.handler) {
        // Flush any in-progress stream before sending interrupt
        if (this.streamMode === "stream") {
          await this.handler.endMessage?.();
        }
        await this.handler.relay("*(interrupted)*");
        await this.handler.endMessage?.();
      } else if (this.handler) {
        const msg = err instanceof Error ? err.message : String(err);
        await this.handler.relay(`⚠️ ${msg}`);
        await this.handler.endMessage?.();
      }
      throw err;
    }

    // Post-run relay for non-stream modes
    if (this.handler) {
      if (this.streamMode === "bundled") {
        const combined = this.completedMessages.join("\n\n");
        await this.handler.relay(combined);
        await this.handler.endMessage?.();
      } else if (this.streamMode === "final" && this.completedMessages.length > 0) {
        const last = this.completedMessages[this.completedMessages.length - 1];
        await this.handler.relay(last);
        await this.handler.endMessage?.();
      }
    }
  }
}

export function withRelay(harness: Harness, opts: RelayOptions): RelayHarness {
  return new RelayHarness(harness, opts);
}
