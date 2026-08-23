import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import { resolve, sep } from "node:path";
import type { Context } from "../../context/Context.js";
import {
  piSessionParseErrorSchema,
  piSessionPersistedLineSchema,
  piSessionRecordIdSchema,
  type JsonValue,
  type PiSessionLine,
} from "../../shared/schemas/pi-session.js";
import { xPiSessionsDir } from "../../lib/x.js";
import { UnsupportedStoreOperationError } from "../Store.js";
import type {
  DeletePiSessionArgs,
  PiSession,
  PiSessionFilter,
  PiSessionListArgs,
  PiSessionStore,
} from "./PiSessionStore.js";

interface SessionFile {
  id: string;
  path: string;
  size: number;
  updatedAt: number;
}

function decodeVitoSessionId(directory: string): string {
  try {
    return decodeURIComponent(directory);
  } catch {
    return directory;
  }
}

function objectValue(value: JsonValue | undefined): Record<string, JsonValue> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value;
}

function stringValue(value: JsonValue | undefined): string {
  return typeof value === "string" ? value : "";
}

function extractMessageText(value: JsonValue | undefined): string {
  if (typeof value === "string") return value.slice(0, 200);
  if (!Array.isArray(value)) return "";
  for (const item of value) {
    const block = objectValue(item);
    if (block?.type === "text" && typeof block.text === "string") {
      return block.text.slice(0, 200);
    }
  }
  return "";
}

const SUMMARY_HEAD_BYTES = 64 * 1024;
const SUMMARY_TAIL_BYTES = 256 * 1024;

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

function parseLines(content: string): PiSessionLine[] {
  return content
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((raw): PiSessionLine => {
      try {
        return piSessionPersistedLineSchema.parse(JSON.parse(raw));
      } catch {
        return { type: "parse_error", raw };
      }
    });
}

function readLineWindow(
  path: string,
  offset: number,
  limit: number,
  order: "oldest" | "newest",
): PiSessionLine[] {
  if (limit <= 0) return [];
  const descriptor = openSync(path, "r");
  const retained: string[] = [];
  const retainCount = offset + limit;
  let pending = "";
  let lineIndex = 0;
  let position = 0;
  try {
    const buffer = Buffer.alloc(64 * 1024);
    while (true) {
      const bytesRead = readSync(descriptor, buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      position += bytesRead;
      const parts = (pending + buffer.subarray(0, bytesRead).toString("utf-8")).split("\n");
      pending = parts.pop() ?? "";
      for (const line of parts) {
        if (!line.trim()) continue;
        if (order === "oldest") {
          if (lineIndex >= offset && retained.length < limit) retained.push(line);
          lineIndex++;
          if (retained.length === limit) return parseLines(retained.join("\n"));
        } else {
          retained.push(line);
          if (retained.length > retainCount) retained.shift();
        }
      }
    }
    if (pending.trim()) {
      if (order === "oldest") {
        if (lineIndex >= offset && retained.length < limit) retained.push(pending);
      } else {
        retained.push(pending);
        if (retained.length > retainCount) retained.shift();
      }
    }
    const selected =
      order === "newest"
        ? retained.slice(0, Math.max(0, retained.length - offset)).slice(-limit)
        : retained;
    return parseLines(selected.join("\n"));
  } finally {
    closeSync(descriptor);
  }
}

function readSummaryLines(file: SessionFile): { lines: PiSessionLine[]; complete: boolean } {
  if (file.size <= SUMMARY_TAIL_BYTES) {
    return { lines: parseLines(readRange(file.path, 0, file.size)), complete: true };
  }

  const head = readRange(file.path, 0, Math.min(file.size, SUMMARY_HEAD_BYTES));
  const firstLine = head.split("\n", 1)[0] ?? "";
  const tailPosition = Math.max(0, file.size - SUMMARY_TAIL_BYTES);
  const tailParts = readRange(file.path, tailPosition, SUMMARY_TAIL_BYTES).split("\n");
  // The first tail fragment usually starts in the middle of a JSON line.
  if (tailPosition > 0) tailParts.shift();
  return { lines: parseLines([firstLine, ...tailParts].join("\n")), complete: false };
}

function buildSession(file: SessionFile, args: PiSessionListArgs): PiSession {
  const includeLines = args.includeLines ?? false;
  let lines: PiSessionLine[] = [];
  let selectedLines: PiSessionLine[] = [];
  let complete = false;
  try {
    const summary = readSummaryLines(file);
    lines = summary.lines;
    complete = summary.complete;
    if (includeLines) {
      selectedLines = readLineWindow(
        file.path,
        Math.max(0, args.lineOffset ?? 0),
        Math.max(0, args.lineLimit ?? 100),
        args.lineOrder ?? "newest",
      );
    }
  } catch {
    // Preserve discoverable file metadata even if a file becomes unreadable.
  }

  let piSessionId = "";
  let piTimestamp = "";
  let cwd = "";
  let messageCount = 0;
  let lastModel = "";
  let lastUserMessage = "";

  for (const line of lines) {
    if (piSessionParseErrorSchema.safeParse(line).success) continue;
    const persisted = piSessionPersistedLineSchema.parse(line);
    if (persisted.type === "session") {
      piSessionId = stringValue(persisted.id);
      piTimestamp = stringValue(persisted.timestamp);
      cwd = stringValue(persisted.cwd);
      continue;
    }
    if (persisted.type === "model_change") {
      const provider = stringValue(persisted.provider);
      const model = stringValue(persisted.modelId);
      lastModel = provider && model ? `${provider}/${model}` : provider || model;
      continue;
    }
    if (persisted.type !== "message") continue;
    messageCount++;
    const message = objectValue(persisted.message);
    if (message?.role === "user") {
      lastUserMessage = extractMessageText(message.content);
    }
    if (message?.role === "assistant") {
      const provider = stringValue(message.provider);
      const model = stringValue(message.model);
      if (provider || model)
        lastModel = provider && model ? `${provider}/${model}` : provider || model;
    }
  }

  return {
    id: file.id,
    vitoSessionId: decodeVitoSessionId(file.id.split("/")[0]),
    piSessionId,
    piTimestamp,
    cwd,
    size: file.size,
    updatedAt: file.updatedAt,
    messageCount: complete ? messageCount : null,
    lastModel,
    lastUserMessage,
    ...(includeLines ? { lines: selectedLines } : {}),
  };
}

function matchesFile(file: SessionFile, filter: PiSessionFilter): boolean {
  if (filter.ids && !filter.ids.includes(file.id)) return false;
  if (filter.vitoSessionIds) {
    const vitoSessionId = decodeVitoSessionId(file.id.split("/")[0]);
    if (!filter.vitoSessionIds.includes(vitoSessionId)) return false;
  }
  return true;
}

export class FilePiSessionStore implements PiSessionStore {
  private listFiles(x: Context): SessionFile[] {
    const root = xPiSessionsDir(x);
    if (!existsSync(root)) return [];

    const files: SessionFile[] = [];
    for (const directory of readdirSync(root, { withFileTypes: true })) {
      if (!directory.isDirectory()) continue;
      const directoryPath = resolve(root, directory.name);
      for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
        const id = `${directory.name}/${entry.name}`;
        if (!piSessionRecordIdSchema.safeParse(id).success) continue;
        const path = resolve(directoryPath, entry.name);
        const stats = lstatSync(path);
        files.push({ id, path, size: stats.size, updatedAt: stats.mtimeMs });
      }
    }
    return files;
  }

  private resolveFile(x: Context, id: string): string | undefined {
    const parsed = piSessionRecordIdSchema.safeParse(id);
    if (!parsed.success) return undefined;
    const root = resolve(xPiSessionsDir(x));
    const path = resolve(root, parsed.data);
    if (!path.startsWith(`${root}${sep}`) || !existsSync(path)) return undefined;
    const stats = lstatSync(path);
    return stats.isFile() ? path : undefined;
  }

  list(x: Context, args: PiSessionListArgs): PiSession[] {
    const order = args.order ?? "recent";
    const offset = Math.max(0, args.offset ?? 0);
    const limit = Math.max(0, args.limit ?? Number.MAX_SAFE_INTEGER);
    return this.listFiles(x)
      .filter((file) => matchesFile(file, args))
      .sort((a, b) =>
        order === "recent"
          ? b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)
          : a.updatedAt - b.updatedAt || a.id.localeCompare(b.id),
      )
      .slice(offset, offset + limit)
      .map((file) => buildSession(file, args));
  }

  count(x: Context, args: PiSessionFilter): number {
    return this.listFiles(x).filter((file) => matchesFile(file, args)).length;
  }

  create(_x: Context, _args: never): never {
    throw new UnsupportedStoreOperationError("Pi sessions are created by the Pi runtime");
  }

  update(_x: Context, _args: never): never {
    throw new UnsupportedStoreOperationError("Pi sessions cannot be updated through the store");
  }

  delete(x: Context, args: DeletePiSessionArgs): number {
    let deleted = 0;
    for (const id of new Set(args.ids)) {
      const path = this.resolveFile(x, id);
      if (!path) continue;
      unlinkSync(path);
      deleted++;
    }
    return deleted;
  }

  cmd(_x: Context, _command: never): never {
    throw new UnsupportedStoreOperationError();
  }
}
