import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import type { Context } from "../../context/Context.js";
import { xLogsDir } from "../../lib/x.js";
import { UnsupportedStoreOperationError } from "../Store.js";
import type {
  CreateTraceArgs,
  DeleteTraceArgs,
  Trace,
  TraceFilter,
  TraceListArgs,
  TraceStore,
  TraceType,
} from "./TraceStore.js";
import { getTracePath, isTraceId } from "./trace-files.js";

const traceHeaderSchema = z.object({
  type: z.literal("header"),
  timestamp: z.string(),
  session_id: z.string(),
  channel: z.string(),
  target: z.string(),
  model: z.string(),
  harness: z.string(),
}).passthrough();

const traceLineSchema = z.object({ type: z.string() }).passthrough();
const footerSchema = z.object({
  type: z.literal("footer"),
  usage: z.object({
    cost: z.object({ total: z.number() }).passthrough(),
  }).passthrough().optional(),
}).passthrough();

function traceTypeFromId(id: string): TraceType {
  if (id.startsWith("trace-classifier-")) return "classifier";
  if (id.startsWith("trace-profile-")) return "profile";
  return "main";
}

function readRange(path: string, position: number, length: number): string {
  if (length <= 0) return "";
  const descriptor = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const bytesRead = readSync(descriptor, buffer, 0, length, position);
    return buffer.subarray(0, bytesRead).toString("utf-8");
  } finally {
    closeSync(descriptor);
  }
}

function parseLine(line: string): Record<string, unknown> | undefined {
  try {
    return traceLineSchema.parse(JSON.parse(line));
  } catch {
    return undefined;
  }
}

function readJsonlTrace(x: Context, id: string): Trace {
  const path = getTracePath(x, id);
  const stats = statSync(path);
  const head = readRange(path, 0, Math.min(stats.size, 262_144));
  const lines = head.split("\n");
  const headerResult = traceHeaderSchema.safeParse(
    lines[0] ? parseLine(lines[0]) : undefined
  );
  const header = headerResult.success ? headerResult.data : undefined;
  const userLine = lines
    .map(parseLine)
    .find((line) => line?.type === "user_message");
  const userMessage = typeof userLine?.content === "string" ? userLine.content : "";

  const tailSize = Math.min(stats.size, 65_536);
  const tail = readRange(path, Math.max(0, stats.size - tailSize), tailSize);
  let hasEmbedding = false;
  let cost: number | null = null;
  for (const rawLine of tail.split("\n")) {
    const line = parseLine(rawLine);
    if (!line) continue;
    if (line.type === "embedding_result" &&
        typeof line.chunks_created === "number" && line.chunks_created > 0) {
      hasEmbedding = true;
    }
    const footer = footerSchema.safeParse(line);
    if (footer.success && footer.data.usage) {
      cost = footer.data.usage.cost.total;
    }
  }

  const preview = header
    ? `Session: ${header.session_id}\nChannel: ${header.channel}\nModel: ${header.model}`
    : lines.slice(0, 3).join("\n");

  return {
    id,
    traceType: traceTypeFromId(id),
    createdAt: header ? Date.parse(header.timestamp) : stats.birthtimeMs,
    updatedAt: stats.mtimeMs,
    size: stats.size,
    sessionId: header?.session_id ?? null,
    channel: header?.channel ?? null,
    target: header?.target ?? null,
    model: header?.model ?? null,
    harness: header?.harness ?? null,
    preview,
    userMessage,
    hasEmbedding,
    cost,
  };
}

function matchesFilter(trace: Trace, filter: TraceFilter): boolean {
  if (filter.ids && !filter.ids.includes(trace.id)) return false;
  if (filter.sessionIds &&
      (!trace.sessionId || !filter.sessionIds.includes(trace.sessionId))) return false;
  if (filter.traceTypes && !filter.traceTypes.includes(trace.traceType)) return false;
  return true;
}

export class FileTraceStore implements TraceStore {
  list(x: Context, args: TraceListArgs): Trace[] {
    const logsDir = xLogsDir(x);
    if (!existsSync(logsDir)) return [];
    if (args.limit !== undefined && args.limit <= 0) return [];
    if (args.ids?.length === 0 || args.sessionIds?.length === 0 ||
        args.traceTypes?.length === 0) return [];

    const candidates = readdirSync(logsDir)
      .filter(isTraceId)
      .filter((id) => !args.ids || args.ids.includes(id))
      .filter((id) => !args.traceTypes || args.traceTypes.includes(traceTypeFromId(id)))
      .map((id) => ({ id, updatedAt: statSync(getTracePath(x, id)).mtimeMs }))
      .sort((left, right) => args.order === "oldest"
        ? left.updatedAt - right.updatedAt
        : right.updatedAt - left.updatedAt);
    const readTrace = (id: string) => readJsonlTrace(x, id);
    const offset = Math.max(0, args.offset ?? 0);
    const end = args.limit === undefined ? undefined : offset + args.limit;

    if (!args.sessionIds) {
      return candidates.slice(offset, end).map(({ id }) => readTrace(id));
    }

    return candidates
      .map(({ id }) => readTrace(id))
      .filter((trace) => matchesFilter(trace, args))
      .slice(offset, end);
  }

  count(x: Context, args: TraceFilter): number {
    const logsDir = xLogsDir(x);
    if (!existsSync(logsDir)) return 0;
    const ids = readdirSync(logsDir)
      .filter(isTraceId)
      .filter((id) => !args.ids || args.ids.includes(id))
      .filter((id) => !args.traceTypes || args.traceTypes.includes(traceTypeFromId(id)));
    if (!args.sessionIds) return ids.length;
    return ids
      .map((id) => readJsonlTrace(x, id))
      .filter((trace) => matchesFilter(trace, args))
      .length;
  }

  create(x: Context, args: CreateTraceArgs): Trace {
    const logsDir = xLogsDir(x);
    mkdirSync(logsDir, { recursive: true });
    const timestampPart = args.timestamp.replace(/[:.]/g, "-");
    const prefix = args.traceType && args.traceType !== "main"
      ? `trace-${args.traceType}`
      : "trace";
    const id = `${prefix}-${timestampPart}-${randomUUID().slice(0, 6)}.jsonl`;
    const header = {
      type: "header",
      timestamp: args.timestamp,
      session_id: args.sessionId,
      channel: args.channel,
      target: args.target,
      model: args.model,
      harness: args.harness,
    };
    writeFileSync(join(logsDir, id), `${JSON.stringify(header)}\n`);
    return readJsonlTrace(x, id);
  }

  update(_x: Context, _args: never): never {
    throw new UnsupportedStoreOperationError("Trace metadata cannot be updated");
  }

  delete(x: Context, args: DeleteTraceArgs): number {
    let deleted = 0;
    for (const id of args.ids) {
      if (!isTraceId(id)) continue;
      const path = getTracePath(x, id);
      if (!existsSync(path)) continue;
      unlinkSync(path);
      deleted++;
    }
    return deleted;
  }

  cmd(_x: Context, _command: never): never {
    throw new UnsupportedStoreOperationError("TraceStore has no commands");
  }
}
