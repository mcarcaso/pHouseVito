import type { Context } from "../../context/Context.js";
import type { InboundEvent } from "../../lib/types/inbound-event.js";

export interface DurableSlackEvent {
  id: string;
  authorId: string;
  event: InboundEvent;
}

export interface SlackQueueStore {
  recover(x: Context): number;
  record(x: Context, item: DurableSlackEvent, immediate?: boolean): boolean;
  pending(x: Context, id: string): DurableSlackEvent | undefined;
  pendingTargets(x: Context): string[];
  claim(x: Context, target: string): DurableSlackEvent | undefined;
  reserveSteering(x: Context, id: string): boolean;
  finishSteering(x: Context, id: string, accepted: boolean): boolean;
  discardPending(x: Context, target: string): number;
  finish(x: Context, id: string, error?: string): void;
  counts(x: Context): { pending: number; active: number; interrupted: number };
}
