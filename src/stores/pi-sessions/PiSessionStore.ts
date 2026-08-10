import type { Context } from "../../context/Context.js";
import type { PiSessionLine } from "../../shared/schemas/pi-session.js";
import type { Store } from "../Store.js";

export interface PiSession {
  id: string;
  vitoSessionId: string;
  piSessionId: string;
  piTimestamp: string;
  cwd: string;
  size: number;
  updatedAt: number;
  messageCount: number;
  lastModel: string;
  lastUserMessage: string;
  lines?: PiSessionLine[];
}

export interface PiSessionFilter {
  ids?: string[];
  vitoSessionIds?: string[];
}

export interface PiSessionListArgs extends PiSessionFilter {
  includeLines?: boolean;
  order?: "recent" | "oldest";
  limit?: number;
  offset?: number;
}

export interface DeletePiSessionArgs {
  ids: string[];
}

export interface PiSessionStore extends Store<
  PiSession,
  PiSessionListArgs,
  never,
  never,
  DeletePiSessionArgs,
  never
> {
  list(x: Context, args: PiSessionListArgs): PiSession[];
  count(x: Context, args: PiSessionFilter): number;
  create(x: Context, args: never): never;
  update(x: Context, args: never): never;
  delete(x: Context, args: DeletePiSessionArgs): number;
  cmd(x: Context, command: never): never;
}
