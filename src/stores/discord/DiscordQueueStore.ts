import type { Context } from "../../context/Context.js";
import type { Attachment } from "../../lib/types/inbound-event.js";

export interface DurableDiscordEvent {
  id: string;
  channel: string;
  transportChannel: string;
  target: string;
  sessionKey: string;
  author: string;
  authorId: string;
  timestamp: number;
  content: string;
  hasMention: boolean;
  commandAuthorized: boolean;
  attachments: Attachment[];
}

export interface DiscordQueueCounts {
  pending: number;
  active: number;
  interrupted: number;
}

export interface DiscordDeliveryReceipt {
  id: string;
  fingerprint: string;
  status: "pending" | "delivering" | "completed" | "failed" | "unknown";
  nextPiece: number;
}

export interface DiscordQueueStore {
  recover(x: Context): number;
  record(x: Context, event: DurableDiscordEvent): boolean;
  pending(x: Context, id: string): DurableDiscordEvent | undefined;
  pendingChannels(x: Context): string[];
  claim(x: Context, channel: string): DurableDiscordEvent | undefined;
  consumePending(x: Context, id: string): boolean;
  discardPending(x: Context, channel: string): number;
  complete(x: Context, id: string): void;
  interrupt(x: Context, id: string, error: string): void;
  counts(x: Context): DiscordQueueCounts;
  delivery(x: Context, id: string): DiscordDeliveryReceipt | undefined;
  createDelivery(x: Context, id: string, fingerprint: string): DiscordDeliveryReceipt;
  advanceDelivery(x: Context, id: string, nextPiece: number): void;
  finishDelivery(x: Context, id: string): void;
  failDelivery(x: Context, id: string, errorKnownNoEffect: boolean): void;
}
