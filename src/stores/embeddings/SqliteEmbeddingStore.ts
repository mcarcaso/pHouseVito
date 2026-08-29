import type { Context } from "../../context/Context.js";
import { xEmbeddingDb } from "../../lib/x.js";
import type {
  CreateEmbeddingChunkArgs,
  EmbeddingChunk,
  EmbeddingChunkWithVector,
  EmbeddingStats,
  EmbeddingStore,
} from "./EmbeddingStore.js";

interface ChunkVectorRow {
  id: number;
  session_id: string;
  day: string;
  chunk_index: number;
  text: string;
  context: string | null;
  msg_count: number;
  vector: Buffer;
}

export class SqliteEmbeddingStore implements EmbeddingStore {
  getLastEmbeddedMessageId(x: Context, sessionId: string): number {
    const row = xEmbeddingDb(x)
      .prepare("SELECT MAX(msg_id_end) as last_id FROM chunks WHERE session_id = ?")
      .get(sessionId) as { last_id: number | null } | undefined;
    return row?.last_id ?? 0;
  }

  getNextChunkIndices(x: Context, sessionId: string): Map<string, number> {
    const rows = xEmbeddingDb(x)
      .prepare(
        "SELECT day, MAX(chunk_index) + 1 as next_idx FROM chunks WHERE session_id = ? GROUP BY day",
      )
      .all(sessionId) as Array<{ day: string; next_idx: number }>;
    return new Map(rows.map((row) => [row.day, row.next_idx]));
  }

  getPreviousChunkText(x: Context, sessionId: string): string | null {
    const row = xEmbeddingDb(x)
      .prepare(
        `SELECT text FROM chunks
         WHERE session_id = ?
         ORDER BY id DESC
         LIMIT 1`,
      )
      .get(sessionId) as { text: string } | undefined;
    return row?.text ?? null;
  }

  createChunk(x: Context, args: CreateEmbeddingChunkArgs): number {
    const db = xEmbeddingDb(x);
    const create = db.transaction(() => {
      const result = db
        .prepare(
          `INSERT INTO chunks
           (session_id, day, chunk_index, text, context, embedded_text,
            msg_id_start, msg_id_end, msg_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id, day, chunk_index) DO UPDATE SET
           text = excluded.text,
           context = excluded.context,
           embedded_text = excluded.embedded_text,
           msg_id_start = excluded.msg_id_start,
           msg_id_end = excluded.msg_id_end,
           msg_count = excluded.msg_count
         RETURNING id`,
        )
        .get(
          args.sessionId,
          args.day,
          args.chunkIndex,
          args.text,
          args.context,
          args.embeddedText,
          args.messageIdStart,
          args.messageIdEnd,
          args.messageCount,
        ) as { id: number };
      const chunkId = result.id;
      const vector = Buffer.from(
        args.vector.buffer,
        args.vector.byteOffset,
        args.vector.byteLength,
      );
      db.prepare("INSERT OR REPLACE INTO embeddings (chunk_id, vector) VALUES (?, ?)").run(
        chunkId,
        vector,
      );
      return chunkId;
    });
    return create();
  }

  listChunksWithVectors(x: Context, sessionId?: string): EmbeddingChunkWithVector[] {
    let sql = `
      SELECT c.id, c.session_id, c.day, c.chunk_index, c.text, c.context,
             c.msg_count, e.vector
      FROM chunks c
      JOIN embeddings e ON e.chunk_id = c.id
    `;
    const rows = sessionId
      ? xEmbeddingDb(x).prepare(`${sql} WHERE c.session_id = ? ORDER BY c.id`).all(sessionId)
      : xEmbeddingDb(x).prepare(`${sql} ORDER BY c.id`).all();

    return (rows as ChunkVectorRow[]).map((row) => {
      const bytes = Uint8Array.from(row.vector);
      return {
        id: row.id,
        sessionId: row.session_id,
        day: row.day,
        chunkIndex: row.chunk_index,
        text: row.text,
        context: row.context,
        messageCount: row.msg_count,
        vector: new Float32Array(bytes.buffer),
      };
    });
  }

  listRecentChunks(x: Context, limit: number): EmbeddingChunk[] {
    const rows = xEmbeddingDb(x)
      .prepare(
        `SELECT id, session_id, day, chunk_index, text, context, msg_count
         FROM chunks
         ORDER BY msg_id_end DESC, id DESC
         LIMIT ?`,
      )
      .all(limit) as Array<Omit<ChunkVectorRow, "vector">>;
    return rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      day: row.day,
      chunkIndex: row.chunk_index,
      text: row.text,
      context: row.context,
      messageCount: row.msg_count,
    }));
  }

  searchFts(
    x: Context,
    args: { query: string; limit: number; sessionId?: string },
  ): Array<{ id: number; score: number }> {
    const sessionClause = args.sessionId ? " AND c.session_id = ?" : "";
    const sql = `
      SELECT chunks_fts.rowid as id, chunks_fts.rank * -1 as score
      FROM chunks_fts
      JOIN chunks c ON c.id = chunks_fts.rowid
      WHERE chunks_fts MATCH ?${sessionClause}
      ORDER BY chunks_fts.rank
      LIMIT ?
    `;
    const params = args.sessionId
      ? [args.query, args.sessionId, args.limit]
      : [args.query, args.limit];
    return xEmbeddingDb(x)
      .prepare(sql)
      .all(...params) as Array<{
      id: number;
      score: number;
    }>;
  }

  getStats(x: Context): EmbeddingStats {
    const db = xEmbeddingDb(x);
    const totals = db
      .prepare(
        `SELECT COUNT(*) as totalChunks,
              COUNT(DISTINCT session_id) as totalSessions,
              COUNT(DISTINCT day) as totalDays,
              MIN(day) as oldestDay,
              MAX(day) as newestDay
       FROM chunks`,
      )
      .get() as Omit<EmbeddingStats, "sessions">;
    const sessions = db
      .prepare(
        `SELECT session_id, COUNT(*) as count, MIN(day) as first_day, MAX(day) as last_day
       FROM chunks
       GROUP BY session_id
       ORDER BY count DESC`,
      )
      .all() as Array<{
      session_id: string;
      count: number;
      first_day: string;
      last_day: string;
    }>;

    return {
      ...totals,
      sessions: sessions.map((row) => ({
        sessionId: row.session_id,
        count: row.count,
        firstDay: row.first_day,
        lastDay: row.last_day,
      })),
    };
  }
}
