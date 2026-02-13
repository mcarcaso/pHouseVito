import type Database from "better-sqlite3";
import type { MessageRow, MemoryRow, SessionRow } from "../types.js";

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
        `INSERT INTO sessions (id, channel, channel_target, created_at, last_active_at)
         VALUES (@id, @channel, @channel_target, @created_at, @last_active_at)
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

  // ── Messages ──

  insertMessage(msg: Omit<MessageRow, "id">): number {
    const result = this.db
      .prepare(
        `INSERT INTO messages (session_id, channel, channel_target, timestamp, role, content, compacted)
         VALUES (@session_id, @channel, @channel_target, @timestamp, @role, @content, @compacted)`
      )
      .run(msg);
    return result.lastInsertRowid as number;
  }

  /** Get N most recent un-compacted messages for a session */
  getRecentMessages(sessionId: string, limit: number): MessageRow[] {
    return this.db
      .prepare(
        `SELECT * FROM (
           SELECT * FROM messages
           WHERE session_id = ? AND compacted = 0
           ORDER BY timestamp DESC
           LIMIT ?
         ) ORDER BY timestamp ASC`
      )
      .all(sessionId, limit) as MessageRow[];
  }

  /** Get M most recent un-compacted messages from OTHER sessions */
  getCrossSessionMessages(
    excludeSessionId: string,
    limit: number
  ): MessageRow[] {
    return this.db
      .prepare(
        `SELECT * FROM (
           SELECT * FROM messages
           WHERE session_id != ? AND compacted = 0
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

  // ── Memories ──

  getAllMemories(): MemoryRow[] {
    return this.db
      .prepare("SELECT * FROM memories ORDER BY timestamp ASC")
      .all() as MemoryRow[];
  }

  replaceAllMemories(
    memories: Array<{ content: string; embedding: Buffer | null }>
  ): void {
    const tx = this.db.transaction(
      (mems: Array<{ content: string; embedding: Buffer | null }>) => {
        this.db.prepare("DELETE FROM memories").run();
        const insert = this.db.prepare(
          "INSERT INTO memories (timestamp, content, embedding) VALUES (?, ?, ?)"
        );
        const now = Date.now();
        for (const mem of mems) {
          insert.run(now, mem.content, mem.embedding);
        }
      }
    );
    tx(memories);
  }

  insertMemory(content: string, embedding: Buffer | null): number {
    const result = this.db
      .prepare(
        "INSERT INTO memories (timestamp, content, embedding) VALUES (?, ?, ?)"
      )
      .run(Date.now(), content, embedding);
    return result.lastInsertRowid as number;
  }
}
