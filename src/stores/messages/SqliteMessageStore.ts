import { z } from "zod";
import type { Context } from "../../context/Context.js";
import { xDb } from "../../lib/x.js";
import type { MessageRow } from "../../types.js";
import { StoreRecordNotFoundError } from "../Store.js";
import type {
  CreateMessageArgs,
  DeleteMessageArgs,
  MessageFilter,
  MessageListArgs,
  MessageStore,
  UpdateMessageArgs,
} from "./MessageStore.js";

const messageCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("archive-sessions"),
    sessionIds: z.array(z.string().min(1)).min(1),
  }).strict(),
]);

interface SqlFilter {
  clause: string;
  params: Array<string | number>;
}

function appendArrayFilter(
  clauses: string[],
  params: Array<string | number>,
  column: string,
  values: Array<string | number> | undefined,
  exclude = false
): void {
  if (values === undefined) return;
  if (values.length === 0) {
    if (!exclude) clauses.push("0 = 1");
    return;
  }
  const placeholders = values.map(() => "?").join(", ");
  clauses.push(`${column} ${exclude ? "NOT IN" : "IN"} (${placeholders})`);
  params.push(...values);
}

function buildFilter(args: MessageFilter): SqlFilter {
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  appendArrayFilter(clauses, params, "id", args.ids);
  appendArrayFilter(clauses, params, "session_id", args.sessionIds);
  appendArrayFilter(clauses, params, "session_id", args.excludeSessionIds, true);
  appendArrayFilter(clauses, params, "type", args.types);
  appendArrayFilter(clauses, params, "type", args.excludeTypes, true);

  if (args.archived !== undefined) {
    clauses.push("archived = ?");
    params.push(args.archived ? 1 : 0);
  }
  if (args.afterId !== undefined) {
    clauses.push("id > ?");
    params.push(args.afterId);
  }
  if (args.beforeId !== undefined) {
    clauses.push("id < ?");
    params.push(args.beforeId);
  }
  if (args.throughId !== undefined) {
    clauses.push("id <= ?");
    params.push(args.throughId);
  }

  return {
    clause: clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

export class SqliteMessageStore implements MessageStore {
  list(x: Context, args: MessageListArgs = {}): MessageRow[] {
    if (args.limit !== undefined && args.limit <= 0) return [];
    const filter = buildFilter(args);
    const order = args.order === "newest" ? "DESC" : "ASC";
    const orderBy = args.orderBy === "timestamp" ? "timestamp" : "id";
    const limitClause = args.limit === undefined ? "" : " LIMIT ?";
    const params = args.limit === undefined
      ? filter.params
      : [...filter.params, args.limit];

    return xDb(x)
      .prepare(`SELECT * FROM messages${filter.clause} ORDER BY ${orderBy} ${order}${limitClause}`)
      .all(...params) as MessageRow[];
  }

  count(x: Context, args: MessageFilter = {}): number {
    const filter = buildFilter(args);
    const row = xDb(x)
      .prepare(`SELECT COUNT(*) AS count FROM messages${filter.clause}`)
      .get(...filter.params) as { count: number };
    return row.count;
  }

  create(x: Context, args: CreateMessageArgs): MessageRow {
    const result = xDb(x)
      .prepare(
        `INSERT INTO messages
           (session_id, channel, channel_target, timestamp, type, content, archived, author)
         VALUES
           (@session_id, @channel, @channel_target, @timestamp, @type, @content, @archived, @author)`
      )
      .run(args);
    return { id: Number(result.lastInsertRowid), ...args };
  }

  update(x: Context, args: UpdateMessageArgs): MessageRow {
    const assignments: string[] = [];
    const params: Array<string | number> = [];
    if (args.changes.type !== undefined) {
      assignments.push("type = ?");
      params.push(args.changes.type);
    }
    if (args.changes.archived !== undefined) {
      assignments.push("archived = ?");
      params.push(args.changes.archived ? 1 : 0);
    }

    if (assignments.length > 0) {
      xDb(x)
        .prepare(`UPDATE messages SET ${assignments.join(", ")} WHERE id = ?`)
        .run(...params, args.id);
    }

    const updated = this.list(x, { ids: [args.id] })[0];
    if (!updated) throw new StoreRecordNotFoundError(`Message not found: ${args.id}`);
    return updated;
  }

  delete(x: Context, args: DeleteMessageArgs): number {
    const filter = buildFilter({ ids: args.ids, sessionIds: args.sessionIds });
    if (!filter.clause) return 0;
    const result = xDb(x)
      .prepare(`DELETE FROM messages${filter.clause}`)
      .run(...filter.params);
    return result.changes;
  }

  cmd(x: Context, input: unknown): unknown {
    const parsed = messageCommandSchema.safeParse(input);
    if (!parsed.success) return undefined;

    const filter = buildFilter({ sessionIds: parsed.data.sessionIds });
    const result = xDb(x)
      .prepare(`UPDATE messages SET archived = 1${filter.clause}`)
      .run(...filter.params);
    return result.changes;
  }
}
