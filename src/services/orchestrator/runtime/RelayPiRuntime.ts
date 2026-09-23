/**
 * RELAY PI RUNTIME
 *
 * Decorator that handles all output to the channel handler:
 * - Streaming relay (each assistant message as it arrives)
 * - Bundled relay (all messages joined after run)
 * - Final relay (last message only after run)
 * - Tool event relay (tool_start/tool_end forwarded to handler)
 * - Error/interrupt relay
 */

import type { OutputHandler } from "../../../lib/output/OutputHandler.js";
import type { StreamMode } from "../../../lib/output/OutputHandler.js";
import { ProxyPiRuntime } from "./ProxyPiRuntime.js";
import type { PiRuntime, PiRuntimeCallbacks } from "./PiRuntime.js";

export interface RelayOptions {
  handler: OutputHandler | null;
  streamMode: StreamMode;
}

export class RelayPiRuntime extends ProxyPiRuntime {
  private readonly handler: OutputHandler | null;
  private readonly streamMode: StreamMode;
  private completedMessages: string[] = [];

  constructor(delegate: PiRuntime, opts: RelayOptions) {
    super(delegate);
    this.handler = opts.handler;
    this.streamMode = opts.streamMode;
  }

  async run(
    systemPrompt: string,
    userMessage: string,
    callbacks: PiRuntimeCallbacks,
    signal?: AbortSignal,
  ): Promise<void> {
    this.completedMessages = [];
    let delivery = Promise.resolve();
    const enqueueDelivery = (action: () => Promise<void>) => {
      delivery = delivery.then(action);
    };

    const relayCallbacks: PiRuntimeCallbacks = {
      onInvocation: callbacks.onInvocation,
      onRawEvent: callbacks.onRawEvent,
      onNormalizedEvent: (event) => {
        if (event.kind === "assistant" && event.content) {
          this.completedMessages.push(event.content);

          if (this.streamMode === "stream" && this.handler) {
            enqueueDelivery(async () => {
              await this.handler?.relay(event.content);
              await this.handler?.endMessage?.();
              await this.handler?.startTyping?.();
            });
          }
        }

        if (event.kind === "tool_start") {
          enqueueDelivery(async () => {
            try {
              await this.handler?.relayEvent?.({
                kind: "tool_start",
                toolName: event.tool,
                toolCallId: event.callId,
                args: event.args,
              });
            } catch {
              // Progress is non-authoritative; assistant delivery still proceeds.
            }
          });
        } else if (event.kind === "tool_end") {
          enqueueDelivery(async () => {
            try {
              await this.handler?.relayEvent?.({
                kind: "tool_end",
                toolName: event.tool,
                toolCallId: event.callId,
                result: event.result,
                isError: !event.success,
              });
            } catch {
              // Progress is non-authoritative; assistant delivery still proceeds.
            }
          });
        }

        callbacks.onNormalizedEvent(event);
      },
    };

    try {
      await this.delegate.run(systemPrompt, userMessage, relayCallbacks, signal);
      await delivery;
    } catch (err) {
      await delivery.catch(() => {});
      if (signal?.aborted && this.handler) {
        // Flush any in-progress stream before sending interrupt
        if (this.streamMode === "stream") {
          await this.handler.endMessage?.();
        }
        await this.handler.relay("*(interrupted)*");
        await this.handler.endMessage?.();
      } else if (this.handler) {
        await this.handler.relay("⚠️ I couldn't complete that turn. Please try again.");
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

export function withRelay(runtime: PiRuntime, opts: RelayOptions): RelayPiRuntime {
  return new RelayPiRuntime(runtime, opts);
}
