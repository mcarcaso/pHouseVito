import type { Context } from "../../context/Context.js";
import { xDb } from "../../lib/x.js";
import type { SessionRow } from "./SessionStore.js";
import { StoreRecordNotFoundError } from "../Store.js";
import type {
  CreateSessionArgs,
  DeleteSessionArgs,
  SessionFilter,
  SessionListArgs,
  SessionStore,
  UpdateSessionArgs,
} from "./SessionStore.js";

interface SqlFilter {
  clause: string;
  params: string[];
}

function appendArrayFilter(
  clauses: string[],
  params: string[],
  column: string,
  values: string[] | undefined,
): void {
  if (values === undefined) return;
  if (values.length === 0) {
    clauses.push("0 = 1");
    return;
  }
  clauses.push(`${column} IN (${values.map(() => "?").join(", ")})`);
  params.push(...values);
}

function buildFilter(args: SessionFilter): SqlFilter {
  const clauses: string[] = [];
  const params: string[] = [];
  appendArrayFilter(clauses, params, "id", args.ids);
  appendArrayFilter(clauses, params, "channel", args.channels);
  appendArrayFilter(clauses, params, "channel_target", args.channelTargets);

  if (args.hasAlias === true) {
    clauses.push("alias IS NOT NULL", "alias != ''");
  } else if (args.hasAlias === false) {
    clauses.push("(alias IS NULL OR alias = '')");
  }

  return {
    clause: clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

export class SqliteSessionStore implements SessionStore {
  list(x: Context, args: SessionListArgs): SessionRow[] {
    if (args.limit !== undefined && args.limit <= 0) return [];
    const filter = buildFilter(args);
    const order = args.order === "oldest" ? "ASC" : "DESC";
    const limitClause = args.limit === undefined ? "" : " LIMIT ?";
    const params: Array<string | number> =
      args.limit === undefined ? filter.params : [...filter.params, args.limit];

    return xDb(x)
      .prepare(
        `SELECT * FROM sessions${filter.clause} ORDER BY last_active_at ${order}${limitClause}`,
      )
      .all(...params) as SessionRow[];
  }

  count(x: Context, args: SessionFilter): number {
    const filter = buildFilter(args);
    const row = xDb(x)
      .prepare(`SELECT COUNT(*) AS count FROM sessions${filter.clause}`)
      .get(...filter.params) as { count: number };
    return row.count;
  }

  create(x: Context, args: CreateSessionArgs): SessionRow {
    xDb(x)
      .prepare(
        `INSERT INTO sessions
           (id, channel, channel_target, created_at, last_active_at, config, alias)
         VALUES
           (@id, @channel, @channel_target, @created_at, @last_active_at, @config, @alias)`,
      )
      .run(args);
    return args;
  }

  update(x: Context, args: UpdateSessionArgs): SessionRow {
    const assignments: string[] = [];
    const params: Array<string | number | null> = [];
    if (args.changes.last_active_at !== undefined) {
      assignments.push("last_active_at = ?");
      params.push(args.changes.last_active_at);
    }
    if (args.changes.config !== undefined) {
      assignments.push("config = ?");
      params.push(args.changes.config);
    }
    if (args.changes.alias !== undefined) {
      assignments.push("alias = ?");
      params.push(args.changes.alias);
    }

    if (assignments.length > 0) {
      xDb(x)
        .prepare(`UPDATE sessions SET ${assignments.join(", ")} WHERE id = ?`)
        .run(...params, args.id);
    }

    const updated = this.list(x, { ids: [args.id], limit: 1 })[0];
    if (!updated) throw new StoreRecordNotFoundError(`Session not found: ${args.id}`);
    return updated;
  }

  delete(x: Context, args: DeleteSessionArgs): number {
    if (args.ids.length === 0) return 0;
    const filter = buildFilter({ ids: args.ids });
    const result = xDb(x)
      .prepare(`DELETE FROM sessions${filter.clause}`)
      .run(...filter.params);
    return result.changes;
  }
}
