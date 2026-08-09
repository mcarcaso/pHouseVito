import type { Context } from "../../context/Context.js";
import type {
  TraceEventData,
  TraceEventType,
  WritableTraceEventData,
} from "../../shared/contracts/trace-event.js";
import type { Store } from "../Store.js";

export interface TraceEvent {
  traceId: string;
  sequence?: number;
  data: TraceEventData;
}

export interface TraceEventFilter {
  traceIds: string[];
  types?: TraceEventType[];
  afterSequence?: number;
}

export interface TraceEventListArgs extends TraceEventFilter {
  limit?: number;
  order?: "oldest" | "newest";
}

export interface CreateTraceEventArgs {
  traceId: string;
  data: WritableTraceEventData;
}

export interface TraceEventStore extends Store<
  TraceEvent,
  TraceEventListArgs,
  CreateTraceEventArgs,
  never,
  never,
  never
> {
  list(x: Context, args: TraceEventListArgs): TraceEvent[];
  count(x: Context, args: TraceEventFilter): number;
  create(x: Context, args: CreateTraceEventArgs): TraceEvent;
  update(x: Context, args: never): never;
  delete(x: Context, args: never): never;
  cmd(x: Context, command: never): never;
}
