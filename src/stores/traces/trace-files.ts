import { basename, join } from "node:path";
import type { Context } from "../../context/Context.js";
import { xLogsDir } from "../../lib/x.js";

export function isTraceId(id: string): boolean {
  if (!id || basename(id) !== id || id.includes("..")) return false;
  return id.startsWith("trace-") && id.endsWith(".jsonl");
}

export function getTracePath(x: Context, id: string): string {
  if (!isTraceId(id)) throw new Error(`Invalid trace ID: ${id}`);
  return join(xLogsDir(x), id);
}
