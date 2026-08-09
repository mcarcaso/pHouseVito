import {
  appendFileSync,
  existsSync,
  readFileSync,
  statSync,
} from "node:fs";
import type { Context } from "../../context/Context.js";
import {
  traceEventDataSchema,
  writableTraceEventDataSchema,
} from "../../shared/contracts/trace-event.js";
import {
  StoreRecordNotFoundError,
  UnsupportedStoreOperationError,
} from "../Store.js";
import type {
  CreateTraceEventArgs,
  TraceEvent,
  TraceEventFilter,
  TraceEventListArgs,
  TraceEventStore,
} from "./TraceEventStore.js";
import { getTracePath } from "./trace-files.js";

const MAX_TRACE_SIZE_BYTES = 50 * 1024 * 1024;

export class TraceSizeLimitError extends Error {
  constructor(message = "Trace exceeded the maximum file size") {
    super(message);
    this.name = "TraceSizeLimitError";
  }
}

function parseEvent(
  traceId: string,
  line: string,
  sequence: number
): TraceEvent {
  try {
    return {
      traceId,
      sequence,
      data: traceEventDataSchema.parse(JSON.parse(line)),
    };
  } catch {
    return {
      traceId,
      sequence,
      data: { type: "parse_error", raw: line },
    };
  }
}

function matchesFilter(event: TraceEvent, filter: TraceEventFilter): boolean {
  if (filter.afterSequence !== undefined &&
      (event.sequence ?? -1) <= filter.afterSequence) return false;
  if (filter.types && !filter.types.includes(event.data.type)) return false;
  return true;
}

export class FileTraceEventStore implements TraceEventStore {
  list(x: Context, args: TraceEventListArgs): TraceEvent[] {
    if (args.limit !== undefined && args.limit <= 0) return [];
    if (args.traceIds.length === 0 || args.types?.length === 0) return [];

    const events: TraceEvent[] = [];
    for (const traceId of args.traceIds) {
      const path = getTracePath(x, traceId);
      if (!existsSync(path)) continue;
      const content = readFileSync(path, "utf-8");
      const lines = content.trimEnd().split("\n");
      for (let index = 1; index < lines.length; index++) {
        const line = lines[index];
        if (!line) continue;
        events.push(parseEvent(traceId, line, index - 1));
      }
    }

    const filtered = events.filter((event) => matchesFilter(event, args));
    filtered.sort((left, right) => {
      const difference = (left.sequence ?? 0) - (right.sequence ?? 0);
      return args.order === "newest" ? -difference : difference;
    });
    return args.limit === undefined ? filtered : filtered.slice(0, args.limit);
  }

  count(x: Context, args: TraceEventFilter): number {
    return this.list(x, args).length;
  }

  create(x: Context, args: CreateTraceEventArgs): TraceEvent {
    const data = writableTraceEventDataSchema.parse(args.data);
    const path = getTracePath(x, args.traceId);
    if (!existsSync(path)) {
      throw new StoreRecordNotFoundError(`Trace not found: ${args.traceId}`);
    }
    const line = `${JSON.stringify(data)}\n`;
    const currentSize = statSync(path).size;
    if (currentSize + Buffer.byteLength(line) > MAX_TRACE_SIZE_BYTES) {
      const truncated = JSON.stringify({
        type: "truncated",
        reason: `Trace exceeded ${MAX_TRACE_SIZE_BYTES / 1024 / 1024}MB limit`,
      }) + "\n";
      if (currentSize + Buffer.byteLength(truncated) <= MAX_TRACE_SIZE_BYTES) {
        appendFileSync(path, truncated);
      }
      throw new TraceSizeLimitError();
    }

    appendFileSync(path, line);
    return { traceId: args.traceId, data };
  }

  update(_x: Context, _args: never): never {
    throw new UnsupportedStoreOperationError("Trace events are append-only");
  }

  delete(_x: Context, _args: never): never {
    throw new UnsupportedStoreOperationError("Delete the owning trace instead");
  }

  cmd(_x: Context, _command: never): never {
    throw new UnsupportedStoreOperationError("TraceEventStore has no commands");
  }
}
