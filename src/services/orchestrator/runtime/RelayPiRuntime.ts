/**
 * RELAY PI RUNTIME
 *
 * Chat delivery is opinionated: temporary reasoning summaries and tool status,
 * permanent public commentary, then a clean final response. Final-only delivery
 * remains an internal transport policy for non-chat callers and conditional jobs.
 */

import type { AgentActivityEvent, OutputHandler } from "../../../lib/output/OutputHandler.js";
import { ProxyPiRuntime } from "./ProxyPiRuntime.js";
import type { PiRuntime, PiRuntimeCallbacks } from "./PiRuntime.js";

export type RelayDelivery = "chat" | "final";

export interface RelayOptions {
  handler: OutputHandler | null;
  delivery?: RelayDelivery;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function providerSummary(message: Record<string, unknown> | undefined): string | undefined {
  if (message?.role !== "assistant" || !Array.isArray(message.content)) return;
  let summary: string | undefined;
  for (const candidate of message.content) {
    const block = record(candidate);
    if (block?.type !== "thinking" || typeof block.thinkingSignature !== "string") continue;
    try {
      const signature = record(JSON.parse(block.thinkingSignature));
      if (signature?.type !== "reasoning" || !Array.isArray(signature.summary)) continue;
      for (const candidatePart of signature.summary) {
        const part = record(candidatePart);
        if (part?.type !== "summary_text" || typeof part.text !== "string") continue;
        for (const paragraph of part.text.replace(/\r\n?/g, "\n").split(/\n\s*\n/)) {
          const first = paragraph.trim().split("\n")[0]?.trim();
          if (first) summary = first.slice(0, 300);
        }
      }
    } catch {
      // Encrypted provider-private reasoning is not displayable. Only its summary is used.
    }
  }
  return summary;
}

/** Extract the provider-authored thought summary and coarse activity. */
function progressEvent(value: unknown): AgentActivityEvent | undefined {
  const event = record(value);
  if (!event || typeof event.type !== "string") return;
  if (event.type === "agent_start") return { kind: "thinking", activity: "thinking" };
  const update = record(event.assistantMessageEvent);
  const message = record(event.message) ?? record(update?.partial);
  const summary = providerSummary(message);
  if (event.type === "message_update" && typeof update?.type === "string") {
    const activity = update.type.startsWith("text_") ? "responding" : "thinking";
    return { kind: "thinking", activity, ...(summary ? { content: summary } : {}) };
  }
  if (event.type !== "message_start" && event.type !== "message_end") return;
  if (message?.role !== "assistant") return;
  const activity = message.stopReason === "stop" ? "finishing" : "thinking";
  return { kind: "thinking", activity, ...(summary ? { content: summary } : {}) };
}

export class RelayPiRuntime extends ProxyPiRuntime {
  private readonly handler: OutputHandler | null;
  private readonly delivery: RelayDelivery;
  private finalMessages: string[] = [];

  constructor(delegate: PiRuntime, opts: RelayOptions) {
    super(delegate);
    this.handler = opts.handler;
    this.delivery = opts.delivery ?? "chat";
  }

  async run(
    systemPrompt: string,
    userMessage: string,
    callbacks: PiRuntimeCallbacks,
    signal?: AbortSignal,
  ): Promise<void> {
    this.finalMessages = [];
    let deliveryQueue = Promise.resolve();
    const enqueueDelivery = (action: () => Promise<void>) => {
      deliveryQueue = deliveryQueue.then(action);
    };

    const relayCallbacks: PiRuntimeCallbacks = {
      onInvocation: callbacks.onInvocation,
      onRawEvent: (event) => {
        callbacks.onRawEvent(event);
        if (this.delivery !== "chat") return;
        const progress = progressEvent(event);
        if (progress) {
          enqueueDelivery(async () => {
            try {
              await this.handler?.relayEvent?.(progress);
            } catch {
              // Progress is non-authoritative; assistant delivery still proceeds.
            }
          });
        }
      },
      onNormalizedEvent: (event) => {
        if ((event.kind === "commentary" || event.kind === "assistant") && event.content) {
          if (event.kind === "assistant") this.finalMessages.push(event.content);
          if (this.delivery === "chat" && this.handler) {
            const content =
              event.kind === "commentary"
                ? `💬${event.content.startsWith("MEDIA:") ? "\n" : " "}${event.content}`
                : event.content;
            enqueueDelivery(async () => {
              await this.handler?.relay(content);
              await this.handler?.endMessage?.();
              await this.handler?.startTyping?.();
            });
          }
        }

        if (this.delivery === "chat" && event.kind === "tool_start") {
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
        } else if (this.delivery === "chat" && event.kind === "tool_end") {
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
      await deliveryQueue;
    } catch (err) {
      await deliveryQueue.catch(() => {});
      if (signal?.aborted && this.handler) {
        if (this.delivery === "chat") await this.handler.endMessage?.();
        await this.handler.relay("*(interrupted)*");
        await this.handler.endMessage?.();
      } else if (this.handler) {
        await this.handler.relay("⚠️ I couldn't complete that turn. Please try again.");
        await this.handler.endMessage?.();
      }
      throw err;
    }

    if (this.handler && this.delivery === "final" && this.finalMessages.length > 0) {
      const last = this.finalMessages[this.finalMessages.length - 1];
      await this.handler.relay(last);
      await this.handler.endMessage?.();
    }
  }
}

export function withRelay(runtime: PiRuntime, opts: RelayOptions): RelayPiRuntime {
  return new RelayPiRuntime(runtime, opts);
}
