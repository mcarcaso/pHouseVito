import type { Context } from "../../context/Context.js";
import { xDb } from "../../lib/x.js";
import type { MessageRow, MsgType } from "../../types.js";
import type {
  CrossSessionMessagesArgs,
  CrossSessionMessagesPerSessionArgs,
  MessageStore,
  RecentMessagesArgs,
  RecentTurnsAfterIdArgs,
  RecentTurnsArgs,
  SessionMessagesArgs,
} from "./MessageStore.js";

export class SqliteMessageStore implements MessageStore {
  create(x: Context, args: Omit<MessageRow, "id">): number {
    const result = xDb(x)
      .prepare(
        `INSERT INTO messages (session_id, channel, channel_target, timestamp, type, content, archived, author)
         VALUES (@session_id, @channel, @channel_target, @timestamp, @type, @content, @archived, @author)`
      )
      .run(args);
    return result.lastInsertRowid as number;
  }

  updateType(x: Context, args: { id: number; type: MsgType }): void {
    xDb(x)
      .prepare("UPDATE messages SET type = ? WHERE id = ?")
      .run(args.type, args.id);
  }

  listRecent(x: Context, args: RecentMessagesArgs): MessageRow[] {
    const includeTools = args.includeTools ?? true;
    const includeThoughts = args.includeThoughts ?? true;
    const includeArchived = args.includeArchived ?? false;
    const filters: string[] = ["session_id = ?"];

    if (!includeTools) filters.push("type NOT IN ('tool_start', 'tool_end')");
    if (!includeThoughts) filters.push("type != 'thought'");
    if (!includeArchived) filters.push("archived = 0");

    return xDb(x)
      .prepare(
        `SELECT * FROM (
           SELECT * FROM messages
           WHERE ${filters.join(" AND ")}
           ORDER BY timestamp DESC
           LIMIT ?
         ) ORDER BY timestamp ASC`
      )
      .all(args.sessionId, args.limit) as MessageRow[];
  }

  listRecentTurns(x: Context, args: RecentTurnsArgs): MessageRow[] {
    if (args.turnLimit <= 0) return [];
    const includeThoughts = args.includeThoughts ?? true;
    const includeTools = args.includeTools ?? true;
    const includeArchived = args.includeArchived ?? false;
    const archivedClause = includeArchived ? "" : " AND archived = 0";

    const typeFilters: string[] = [];
    if (!includeThoughts) typeFilters.push("type != 'thought'");
    if (!includeTools) typeFilters.push("type NOT IN ('tool_start', 'tool_end')");
    const typeFilterClause = typeFilters.length > 0 ? ` AND ${typeFilters.join(" AND ")}` : "";

    return xDb(x)
      .prepare(
        `SELECT * FROM messages
         WHERE session_id = ?
           AND timestamp >= COALESCE(
             (SELECT MIN(timestamp) FROM (
                SELECT timestamp FROM messages
                WHERE session_id = ?
                  AND type IN ('user', 'assistant')${archivedClause}
                ORDER BY timestamp DESC
                LIMIT ?
              )),
             9.2233720368548e+18
           )
           ${archivedClause}
           ${typeFilterClause}
         ORDER BY timestamp ASC`
      )
      .all(args.sessionId, args.sessionId, args.turnLimit) as MessageRow[];
  }

  listRecentTurnsAfterId(x: Context, args: RecentTurnsAfterIdArgs): MessageRow[] {
    if (args.turnLimit <= 0) return [];

    const includeThoughts = args.includeThoughts ?? true;
    const includeTools = args.includeTools ?? true;
    const includeArchived = args.includeArchived ?? false;
    const afterId = args.afterId ?? 0;
    const archivedClause = includeArchived ? "" : " AND archived = 0";

    const typeFilters: string[] = [];
    if (!includeThoughts) typeFilters.push("type != 'thought'");
    if (!includeTools) typeFilters.push("type NOT IN ('tool_start', 'tool_end')");
    const typeFilterClause = typeFilters.length > 0 ? ` AND ${typeFilters.join(" AND ")}` : "";

    const keepTail = Math.max(0, Math.floor(args.keepRecentEmbeddedMessages ?? 0));
    const scopeClause = keepTail > 0
      ? `AND (id > ? OR id >= COALESCE(
           (SELECT MIN(id) FROM (
              SELECT id FROM messages
              WHERE session_id = ?
                AND type IN ('user', 'assistant')${archivedClause}
              ORDER BY id DESC
              LIMIT ?
            )),
           9223372036854775807
         ))`
      : `AND id > ?`;

    const sql = `SELECT * FROM messages
      WHERE session_id = ?
        AND id >= COALESCE(
          (SELECT MIN(id) FROM (
             SELECT id FROM messages
             WHERE session_id = ?
               AND type IN ('user', 'assistant')${archivedClause}
               ${scopeClause}
             ORDER BY id DESC
             LIMIT ?
           )),
          9223372036854775807
        )
        ${scopeClause}
        ${archivedClause}
        ${typeFilterClause}
      ORDER BY id ASC`;

    const params = keepTail > 0
      ? [
          args.sessionId,
          args.sessionId,
          afterId,
          args.sessionId,
          keepTail,
          args.turnLimit,
          afterId,
          args.sessionId,
          keepTail,
        ]
      : [args.sessionId, args.sessionId, afterId, args.turnLimit, afterId];

    return xDb(x).prepare(sql).all(...params) as MessageRow[];
  }

  countThroughId(x: Context, args: RecentMessagesArgs & { throughId: number }): number {
    if (args.throughId <= 0) return 0;
    const includeTools = args.includeTools ?? true;
    const includeThoughts = args.includeThoughts ?? true;
    const includeArchived = args.includeArchived ?? false;
    const filters: string[] = ["session_id = ?", "id <= ?"];
    if (!includeTools) filters.push("type NOT IN ('tool_start', 'tool_end')");
    if (!includeThoughts) filters.push("type != 'thought'");
    if (!includeArchived) filters.push("archived = 0");
    const row = xDb(x)
      .prepare(`SELECT COUNT(*) as count FROM messages WHERE ${filters.join(" AND ")}`)
      .get(args.sessionId, args.throughId) as { count: number };
    return row.count;
  }

  listForSession(x: Context, args: SessionMessagesArgs): MessageRow[] {
    let filterClause = "";
    if (args.hideThoughts) filterClause += " AND type != 'thought'";
    if (args.hideTools) filterClause += " AND type NOT IN ('tool_start', 'tool_end')";

    if (args.afterId) {
      return xDb(x)
        .prepare(
          `SELECT * FROM messages
           WHERE session_id = ? AND id > ?${filterClause}
           ORDER BY id ASC`
        )
        .all(args.sessionId, args.afterId) as MessageRow[];
    }

    if (args.limit && args.beforeId) {
      return xDb(x)
        .prepare(
          `SELECT * FROM (
             SELECT * FROM messages
             WHERE session_id = ? AND id < ?${filterClause}
             ORDER BY id DESC
             LIMIT ?
           ) ORDER BY id ASC`
        )
        .all(args.sessionId, args.beforeId, args.limit) as MessageRow[];
    }

    if (args.limit) {
      return xDb(x)
        .prepare(
          `SELECT * FROM (
             SELECT * FROM messages
             WHERE session_id = ?${filterClause}
             ORDER BY id DESC
             LIMIT ?
           ) ORDER BY id ASC`
        )
        .all(args.sessionId, args.limit) as MessageRow[];
    }

    return xDb(x)
      .prepare(
        `SELECT * FROM messages
         WHERE session_id = ?${filterClause}
         ORDER BY id ASC`
      )
      .all(args.sessionId) as MessageRow[];
  }

  deleteForSession(x: Context, args: { sessionId: string }): number {
    const result = xDb(x)
      .prepare("DELETE FROM messages WHERE session_id = ?")
      .run(args.sessionId);
    return result.changes;
  }

  countForSession(x: Context, args: { sessionId: string; hideThoughts?: boolean; hideTools?: boolean }): number {
    let sql = "SELECT COUNT(*) as count FROM messages WHERE session_id = ?";
    if (args.hideThoughts) sql += " AND type != 'thought'";
    if (args.hideTools) sql += " AND type NOT IN ('tool_start', 'tool_end')";

    const row = xDb(x).prepare(sql).get(args.sessionId) as { count: number };
    return row.count;
  }

  listCrossSession(x: Context, args: CrossSessionMessagesArgs): MessageRow[] {
    const includeTools = args.includeTools ?? false;
    const showArchived = args.showArchived ?? false;
    const toolFilter = includeTools ? "" : " AND type NOT IN ('tool_start', 'tool_end')";
    const archiveFilter = showArchived ? "" : " AND archived = 0";
    return xDb(x)
      .prepare(
        `SELECT * FROM (
           SELECT * FROM messages
           WHERE session_id != ?${archiveFilter}${toolFilter}
           ORDER BY timestamp DESC
           LIMIT ?
         ) ORDER BY timestamp ASC`
      )
      .all(args.excludeSessionId, args.limit) as MessageRow[];
  }

  listCrossSessionPerSession(x: Context, args: CrossSessionMessagesPerSessionArgs): MessageRow[] {
    const includeTools = args.includeTools ?? false;
    const includeThoughts = args.includeThoughts ?? false;
    const includeArchived = args.includeArchived ?? false;
    const maxSessions = args.maxSessions ?? 0;
    const buildFilters = (prefix = "") => {
      const filters: string[] = [];
      if (!includeTools) filters.push(`${prefix}type NOT IN ('tool_start', 'tool_end')`);
      if (!includeThoughts) filters.push(`${prefix}type != 'thought'`);
      if (!includeArchived) filters.push(`${prefix}archived = 0`);
      return filters.length > 0 ? " AND " + filters.join(" AND ") : "";
    };

    const filterClause = buildFilters();
    const sessionLimitClause = maxSessions > 0 ? ` LIMIT ${maxSessions}` : "";
    const sessions = xDb(x)
      .prepare(
        `SELECT DISTINCT session_id FROM messages
         WHERE session_id != ?${filterClause}
         ORDER BY (SELECT MAX(timestamp) FROM messages m2 WHERE m2.session_id = messages.session_id) DESC${sessionLimitClause}`
      )
      .all(args.excludeSessionId) as Array<{ session_id: string }>;

    const allMessages: MessageRow[] = [];
    for (const session of sessions) {
      const msgs = xDb(x)
        .prepare(
          `SELECT * FROM (
             SELECT * FROM messages
             WHERE session_id = ?${filterClause}
             ORDER BY timestamp DESC
             LIMIT ?
           ) ORDER BY timestamp ASC`
        )
        .all(session.session_id, args.perSessionLimit) as MessageRow[];
      allMessages.push(...msgs);
    }
    return allMessages;
  }

  archiveSession(x: Context, args: { sessionId: string }): void {
    xDb(x)
      .prepare("UPDATE messages SET archived = 1 WHERE session_id = ?")
      .run(args.sessionId);
  }

  getLastAssistantMessage(x: Context, args: { sessionId: string }): string | null {
    const row = xDb(x)
      .prepare(
        `SELECT content FROM messages
         WHERE session_id = ? AND type = 'assistant' AND archived = 0
         ORDER BY timestamp DESC
         LIMIT 1`
      )
      .get(args.sessionId) as { content: string } | undefined;

    if (!row) return null;
    try {
      return JSON.parse(row.content);
    } catch {
      return row.content;
    }
  }

  getLastNMessages(x: Context, args: { sessionId: string; limit: number }): Array<{ type: string; content: string }> {
    const rows = xDb(x)
      .prepare(
        `SELECT type, content FROM (
           SELECT type, content, timestamp FROM messages
           WHERE session_id = ? AND type IN ('user', 'assistant') AND archived = 0
           ORDER BY timestamp DESC
           LIMIT ?
         ) ORDER BY timestamp ASC`
      )
      .all(args.sessionId, args.limit) as Array<{ type: string; content: string }>;

    return rows.map((row) => {
      let content: string;
      try {
        content = JSON.parse(row.content);
      } catch {
        content = row.content;
      }
      if (typeof content === "object" && content !== null) {
        content = (content as any).text || JSON.stringify(content);
      }
      return { type: row.type, content };
    });
  }
}
