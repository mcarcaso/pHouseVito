import type { InboundEvent } from "../../lib/types/inbound-event.js";

/** Stable transport identity for a queued invocation. Never use message text as identity. */
export function queuedEventId(event: InboundEvent): string | undefined {
  const raw = event.raw;
  if (!raw || typeof raw !== "object") return;
  if ("requestId" in raw && typeof raw.requestId === "string") return raw.requestId;
  if (event.channel === "telegram" && "message" in raw) {
    const message = raw.message;
    if (
      message &&
      typeof message === "object" &&
      "message_id" in message &&
      typeof message.message_id === "number"
    ) {
      return `${event.target}:${message.message_id}`;
    }
  }
  return;
}

export type SteerQueuedResult = "steered" | "expired" | "forbidden" | "ineligible";

/** Channel-independent eligibility; platform adapters may add stricter origin checks. */
export function queuedSteeringEligibility(input: {
  senderId: unknown;
  requesterId: string;
  content: string;
  attachments?: readonly unknown[];
}): "forbidden" | "ineligible" | undefined {
  if (input.senderId !== input.requesterId) return "forbidden";
  if (input.attachments?.length || !input.content.trim()) return "ineligible";
}
