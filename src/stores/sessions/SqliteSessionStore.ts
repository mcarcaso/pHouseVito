import type { Context } from "../../context/Context.js";
import { xDb } from "../../lib/x.js";
import type { SessionRow } from "../../types.js";
import type { SessionStore, SessionUpdateAliasArgs, SessionUpdateConfigArgs, SessionUpsertArgs } from "./SessionStore.js";

export class SqliteSessionStore implements SessionStore {
  get(x: Context, id: string): SessionRow | undefined {
    return xDb(x)
      .prepare("SELECT * FROM sessions WHERE id = ?")
      .get(id) as SessionRow | undefined;
  }

  upsert(x: Context, args: SessionUpsertArgs): void {
    xDb(x)
      .prepare(
        `INSERT INTO sessions (id, channel, channel_target, created_at, last_active_at, config)
         VALUES (@id, @channel, @channel_target, @created_at, @last_active_at, @config)
         ON CONFLICT(id) DO UPDATE SET last_active_at = @last_active_at`
      )
      .run(args.session);
  }

  list(x: Context): SessionRow[] {
    return xDb(x)
      .prepare("SELECT * FROM sessions ORDER BY last_active_at DESC")
      .all() as SessionRow[];
  }

  touch(x: Context, args: { id: string; timestamp: number }): void {
    xDb(x)
      .prepare("UPDATE sessions SET last_active_at = ? WHERE id = ?")
      .run(args.timestamp, args.id);
  }

  updateConfig(x: Context, args: SessionUpdateConfigArgs): void {
    xDb(x)
      .prepare("UPDATE sessions SET config = ? WHERE id = ?")
      .run(args.config, args.id);
  }

  updateAlias(x: Context, args: SessionUpdateAliasArgs): void {
    xDb(x)
      .prepare("UPDATE sessions SET alias = ? WHERE id = ?")
      .run(args.alias, args.id);
  }

  getAliases(x: Context): Record<string, string> {
    const rows = xDb(x)
      .prepare("SELECT id, alias FROM sessions WHERE alias IS NOT NULL AND alias != ''")
      .all() as Array<{ id: string; alias: string }>;
    const map: Record<string, string> = {};
    for (const row of rows) {
      map[row.id] = row.alias;
    }
    return map;
  }
}
