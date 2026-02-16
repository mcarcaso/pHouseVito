import type Database from "better-sqlite3";
import type { MessageRow, SessionRow, TraceRow, MsgType } from "../types.js";

export class Queries {
  constructor(private db: Database.Database) {}

  // ── Sessions ──

  getSession(id: string): SessionRow | undefined {
    return this.db
      .prepare("SELECT * FROM sessions WHERE id = ?")
      .get(id) as SessionRow | undefined;
  }

  upsertSession(session: SessionRow): void {
    this.db
      .prepare(
        `INSERT INTO sessions (id, channel, channel_target, created_at, last_active_at, config)
         VALUES (@id, @channel, @channel_target, @created_at, @last_active_at, @config)
         ON CONFLICT(id) DO UPDATE SET last_active_at = @last_active_at`
      )
      .run(session);
  }

  getAllSessions(): SessionRow[] {
    return this.db
      .prepare("SELECT * FROM sessions ORDER BY last_active_at DESC")
      .all() as SessionRow[];
  }

  touchSession(id: string, timestamp: number): void {
    this.db
      .prepare("UPDATE sessions SET last_active_at = ? WHERE id = ?")
      .run(timestamp, id);
  }

  updateSessionConfig(id: string, config: string): void {
    this.db
      .prepare("UPDATE sessions SET config = ? WHERE id = ?")
      .run(config, id);
  }

  updateSessionAlias(id: string, alias: string | null): void {
    this.db
      .prepare("UPDATE sessions SET alias = ? WHERE id = ?")
      .run(alias, id);
  }

  /** Get a map of session ID → alias for all sessions that have aliases */
  getSessionAliases(): Record<string, string> {
    const rows = this.db
      .prepare("SELECT id, alias FROM sessions WHERE alias IS NOT NULL AND alias != ''")
      .all() as Array<{ id: string; alias: string }>;
    const map: Record<string, string> = {};
    for (const row of rows) {
      map[row.id] = row.alias;
    }
    return map;
  }

  // ── Messages ──

  insertMessage(msg: Omit<MessageRow, "id">): number {
    const result = this.db
      .prepare(
        `INSERT INTO messages (session_id, channel, channel_target, timestamp, type, content, compacted, archived)
         VALUES (@session_id, @channel, @channel_target, @timestamp, @type, @content, @compacted, @archived)`
      )
      .run(msg);
    return result.lastInsertRowid as number;
  }
  
  /** Update message type (for marking assistant vs thought) */
  updateMessageType(id: number, type: MsgType): void {
    this.db
      .prepare("UPDATE messages SET type = ? WHERE id = ?")
      .run(type, id);
  }

  /**
   * Get recent messages for the CURRENT session context.
   * Shows everything that's not archived (compacted or not).
   */
  getRecentMessages(sessionId: string, limit: number, includeTools = true): MessageRow[] {
    const toolFilter = includeTools ? "" : " AND type NOT IN ('tool_start', 'tool_end')";
    return this.db
      .prepare(
        `SELECT * FROM (
           SELECT * FROM messages
           WHERE session_id = ? AND archived = 0${toolFilter}
           ORDER BY timestamp DESC
           LIMIT ?
         ) ORDER BY timestamp ASC`
      )
      .all(sessionId, limit) as MessageRow[];
  }

  /** Get all messages for a session (including compacted/archived) for dashboard */
  getAllMessagesForSession(sessionId: string, limit?: number, beforeId?: number, hideThoughts?: boolean, hideTools?: boolean): MessageRow[] {
    // Build filter clause based on filter options
    let filterClause = "";
    if (hideThoughts) {
      filterClause += " AND type != 'thought'";
    }
    if (hideTools) {
      filterClause += " AND type NOT IN ('tool_start', 'tool_end')";
    }
    
    if (limit && beforeId) {
      // Paginated: get N messages before a specific ID
      return this.db
        .prepare(
          `SELECT * FROM (
             SELECT * FROM messages
             WHERE session_id = ? AND id < ?${filterClause}
             ORDER BY id DESC
             LIMIT ?
           ) ORDER BY id ASC`
        )
        .all(sessionId, beforeId, limit) as MessageRow[];
    } else if (limit) {
      // Just limit: get most recent N messages
      return this.db
        .prepare(
          `SELECT * FROM (
             SELECT * FROM messages
             WHERE session_id = ?${filterClause}
             ORDER BY id DESC
             LIMIT ?
           ) ORDER BY id ASC`
        )
        .all(sessionId, limit) as MessageRow[];
    } else {
      return this.db
        .prepare(
          `SELECT * FROM messages
           WHERE session_id = ?${filterClause}
           ORDER BY id ASC`
        )
        .all(sessionId) as MessageRow[];
    }
  }

  /** Count total messages for a session */
  countMessagesForSession(sessionId: string, hideThoughts?: boolean, hideTools?: boolean): number {
    let sql = "SELECT COUNT(*) as count FROM messages WHERE session_id = ?";
    
    if (hideThoughts) {
      sql += " AND type != 'thought'";
    }
    if (hideTools) {
      sql += " AND type NOT IN ('tool_start', 'tool_end')";
    }
    
    const row = this.db
      .prepare(sql)
      .get(sessionId) as { count: number };
    return row.count;
  }

  /**
   * Get recent messages from OTHER sessions for cross-session context.
   * Only shows un-compacted, un-archived messages by default.
   * Optionally includes archived messages (configurable).
   */
  getCrossSessionMessages(
    excludeSessionId: string,
    limit: number,
    includeTools = false,
    showArchived = false
  ): MessageRow[] {
    const toolFilter = includeTools ? "" : " AND type NOT IN ('tool_start', 'tool_end')";
    // Never show compacted from other sessions. Optionally show archived.
    const archiveFilter = showArchived ? "" : " AND archived = 0";
    return this.db
      .prepare(
        `SELECT * FROM (
           SELECT * FROM messages
           WHERE session_id != ? AND compacted = 0${archiveFilter}${toolFilter}
           ORDER BY timestamp DESC
           LIMIT ?
         ) ORDER BY timestamp ASC`
      )
      .all(excludeSessionId, limit) as MessageRow[];
  }

  /**
   * Get last N messages per OTHER session for cross-session context.
   * Ignores compaction status, but excludes archived.
   */
  getCrossSessionMessagesPerSession(
    excludeSessionId: string,
    perSessionLimit: number,
    includeTools = false
  ): MessageRow[] {
    const toolFilter = includeTools ? "" : " AND type NOT IN ('tool_start', 'tool_end')";
    // Get distinct other sessions that have non-archived messages
    const sessions = this.db
      .prepare(
        `SELECT DISTINCT session_id FROM messages
         WHERE session_id != ? AND archived = 0${toolFilter}
         ORDER BY (SELECT MAX(timestamp) FROM messages m2 WHERE m2.session_id = messages.session_id) DESC`
      )
      .all(excludeSessionId) as Array<{ session_id: string }>;

    const allMessages: MessageRow[] = [];
    for (const session of sessions) {
      const msgs = this.db
        .prepare(
          `SELECT * FROM (
             SELECT * FROM messages
             WHERE session_id = ? AND archived = 0${toolFilter}
             ORDER BY timestamp DESC
             LIMIT ?
           ) ORDER BY timestamp ASC`
        )
        .all(session.session_id, perSessionLimit) as MessageRow[];
      allMessages.push(...msgs);
    }
    return allMessages;
  }

  /** Get all un-compacted messages across all sessions */
  getAllUncompactedMessages(): MessageRow[] {
    return this.db
      .prepare(
        "SELECT * FROM messages WHERE compacted = 0 ORDER BY timestamp ASC"
      )
      .all() as MessageRow[];
  }

  /** Get un-compacted messages for a specific session */
  getUncompactedMessagesForSession(sessionId: string): MessageRow[] {
    return this.db
      .prepare(
        "SELECT * FROM messages WHERE session_id = ? AND compacted = 0 ORDER BY timestamp ASC"
      )
      .all(sessionId) as MessageRow[];
  }

  /** Count un-compacted messages */
  countUncompacted(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) as count FROM messages WHERE compacted = 0")
      .get() as { count: number };
    return row.count;
  }

  /** Mark messages as compacted */
  markCompacted(ids: number[]): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => "?").join(",");
    this.db
      .prepare(
        `UPDATE messages SET compacted = 1 WHERE id IN (${placeholders})`
      )
      .run(...ids);
  }

  /** Mark all messages in a session as archived */
  markSessionArchived(sessionId: string): void {
    this.db
      .prepare(
        "UPDATE messages SET archived = 1 WHERE session_id = ?"
      )
      .run(sessionId);
  }

  /** Mark all messages in a session as compacted */
  markSessionCompacted(sessionId: string): void {
    this.db
      .prepare(
        "UPDATE messages SET compacted = 1 WHERE session_id = ?"
      )
      .run(sessionId);
  }

  // ── Traces ──

  insertTrace(trace: Omit<TraceRow, "id">): void {
    this.db
      .prepare(
        `INSERT INTO traces (session_id, channel, timestamp, user_message, system_prompt, model)
         VALUES (@session_id, @channel, @timestamp, @user_message, @system_prompt, @model)`
      )
      .run(trace);
  }

  getRecentTraces(limit: number = 50): Omit<TraceRow, "system_prompt">[] {
    return this.db
      .prepare("SELECT id, session_id, channel, timestamp, user_message, model FROM traces ORDER BY timestamp DESC LIMIT ?")
      .all(limit) as Omit<TraceRow, "system_prompt">[];
  }

  getTrace(id: number): TraceRow | undefined {
    return this.db
      .prepare("SELECT * FROM traces WHERE id = ?")
      .get(id) as TraceRow | undefined;
  }
}
