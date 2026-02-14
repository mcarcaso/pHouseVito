import type Database from "better-sqlite3";
import type { MessageRow, MemoryRow, SessionRow, TraceRow } from "../types.js";

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

  // ── Messages ──

  insertMessage(msg: Omit<MessageRow, "id">): number {
    const result = this.db
      .prepare(
        `INSERT INTO messages (session_id, channel, channel_target, timestamp, role, content, compacted, archived)
         VALUES (@session_id, @channel, @channel_target, @timestamp, @role, @content, @compacted, @archived)`
      )
      .run(msg);
    return result.lastInsertRowid as number;
  }

  /**
   * Get recent messages for the CURRENT session context.
   * Shows everything that's not archived (compacted or not).
   */
  getRecentMessages(sessionId: string, limit: number, includeTools = true): MessageRow[] {
    const toolFilter = includeTools ? "" : " AND role != 'tool'";
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
  getAllMessagesForSession(sessionId: string, limit?: number): MessageRow[] {
    if (limit) {
      return this.db
        .prepare(
          `SELECT * FROM (
             SELECT * FROM messages
             WHERE session_id = ?
             ORDER BY timestamp DESC
             LIMIT ?
           ) ORDER BY timestamp ASC`
        )
        .all(sessionId, limit) as MessageRow[];
    } else {
      return this.db
        .prepare(
          `SELECT * FROM messages
           WHERE session_id = ?
           ORDER BY timestamp ASC`
        )
        .all(sessionId) as MessageRow[];
    }
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
    const toolFilter = includeTools ? "" : " AND role != 'tool'";
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

  // ── Memories ──

  getAllMemories(): MemoryRow[] {
    return this.db
      .prepare("SELECT * FROM memories ORDER BY timestamp ASC")
      .all() as MemoryRow[];
  }

  replaceAllMemories(
    memories: Array<{ title: string; content: string; embedding: Buffer | null }>
  ): void {
    const tx = this.db.transaction(
      (mems: Array<{ title: string; content: string; embedding: Buffer | null }>) => {
        this.db.prepare("DELETE FROM memories").run();
        const insert = this.db.prepare(
          "INSERT INTO memories (timestamp, title, content, embedding) VALUES (?, ?, ?, ?)"
        );
        const now = Date.now();
        for (const mem of mems) {
          insert.run(now, mem.title, mem.content, mem.embedding);
        }
      }
    );
    tx(memories);
  }

  /** Search memories by keyword (LIKE match), return top N */
  searchMemoriesByKeyword(keywords: string[], limit: number): MemoryRow[] {
    if (keywords.length === 0) {
      return this.db
        .prepare("SELECT * FROM memories ORDER BY timestamp DESC LIMIT ?")
        .all(limit) as MemoryRow[];
    }
    const titleClauses = keywords.map(() => "title LIKE ?");
    const contentClauses = keywords.map(() => "content LIKE ?");
    const allClauses = [...titleClauses, ...contentClauses];
    const params = keywords.map((k) => `%${k}%`);
    const allParams = [...params, ...params]; // title params + content params
    return this.db
      .prepare(
        `SELECT *, (${allClauses.join(" + ")}) as matches FROM memories
         WHERE ${allClauses.join(" OR ")}
         ORDER BY matches DESC, timestamp DESC
         LIMIT ?`
      )
      .all(...allParams, ...allParams, limit) as MemoryRow[];
  }

  insertMemory(title: string, content: string, embedding: Buffer | null): number {
    const result = this.db
      .prepare(
        "INSERT INTO memories (timestamp, title, content, embedding) VALUES (?, ?, ?, ?)"
      )
      .run(Date.now(), title, content, embedding);
    return result.lastInsertRowid as number;
  }

  // ── Traces ──

  insertTrace(trace: Omit<TraceRow, "id">): void {
    this.db
      .prepare(
        `INSERT INTO traces (session_id, channel, timestamp, user_message, system_prompt)
         VALUES (@session_id, @channel, @timestamp, @user_message, @system_prompt)`
      )
      .run(trace);
  }

  getRecentTraces(limit: number = 50): Omit<TraceRow, "system_prompt">[] {
    return this.db
      .prepare("SELECT id, session_id, channel, timestamp, user_message FROM traces ORDER BY timestamp DESC LIMIT ?")
      .all(limit) as Omit<TraceRow, "system_prompt">[];
  }

  getTrace(id: number): TraceRow | undefined {
    return this.db
      .prepare("SELECT * FROM traces WHERE id = ?")
      .get(id) as TraceRow | undefined;
  }
}
