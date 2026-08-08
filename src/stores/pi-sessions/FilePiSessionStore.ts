import {
  existsSync,
  lstatSync,
  readFileSync,
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
} from "../../contracts/pi-session.js";
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

function buildSession(file: SessionFile, includeLines: boolean): PiSession {
  let lines: PiSessionLine[] = [];
  try {
    lines = parseLines(readFileSync(file.path, "utf-8"));
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
  }

  return {
    id: file.id,
    vitoSessionId: decodeVitoSessionId(file.id.split("/")[0]),
    piSessionId,
    piTimestamp,
    cwd,
    size: file.size,
    updatedAt: file.updatedAt,
    messageCount,
    lastModel,
    lastUserMessage,
    ...(includeLines ? { lines } : {}),
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
      .map((file) => buildSession(file, args.includeLines ?? false))
      .sort((a, b) => order === "recent"
        ? b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)
        : a.updatedAt - b.updatedAt || a.id.localeCompare(b.id))
      .slice(offset, offset + limit);
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
