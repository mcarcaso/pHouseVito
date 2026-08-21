import type { Context } from "../../context/Context.js";
import type { Store } from "../Store.js";

export type TraceType = "main" | "classifier" | "profile";

export interface Trace {
  id: string;
  traceType: TraceType;
  createdAt: number;
  updatedAt: number;
  size: number;
  sessionId: string | null;
  channel: string | null;
  target: string | null;
  model: string | null;
  harness: string | null;
  preview: string;
  userMessage: string;
  hasEmbedding: boolean;
  cost: number | null;
}

export interface TraceFilter {
  ids?: string[];
  sessionIds?: string[];
  traceTypes?: TraceType[];
}

export interface TraceListArgs extends TraceFilter {
  offset?: number;
  limit?: number;
  order?: "recent" | "oldest";
}

export interface CreateTraceArgs {
  traceType?: TraceType;
  timestamp: string;
  sessionId: string;
  channel: string;
  target: string;
  model: string;
  harness: string;
}

export interface DeleteTraceArgs {
  ids: string[];
}

export interface TraceStore extends Store<
  Trace,
  TraceListArgs,
  CreateTraceArgs,
  never,
  DeleteTraceArgs,
  never
> {
  list(x: Context, args: TraceListArgs): Trace[];
  count(x: Context, args: TraceFilter): number;
  create(x: Context, args: CreateTraceArgs): Trace;
  update(x: Context, args: never): never;
  delete(x: Context, args: DeleteTraceArgs): number;
  cmd(x: Context, command: never): never;
}
