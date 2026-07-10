import type { Context } from "../../context/Context.js";
import type { SessionRow } from "../../types.js";

export interface SessionUpsertArgs {
  session: SessionRow;
}

export interface SessionUpdateConfigArgs {
  id: string;
  config: string;
}

export interface SessionUpdateAliasArgs {
  id: string;
  alias: string | null;
}

export interface SessionStore {
  get(x: Context, id: string): SessionRow | undefined;
  upsert(x: Context, args: SessionUpsertArgs): void;
  list(x: Context): SessionRow[];
  touch(x: Context, args: { id: string; timestamp: number }): void;
  updateConfig(x: Context, args: SessionUpdateConfigArgs): void;
  updateAlias(x: Context, args: SessionUpdateAliasArgs): void;
  getAliases(x: Context): Record<string, string>;
}
