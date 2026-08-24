import type { Context } from "../../context/Context.js";
import { xDb } from "../../lib/x.js";
import type { VoiceTaskRow, VoiceTaskStore } from "./VoiceTaskStore.js";

export class SqliteVoiceTaskStore implements VoiceTaskStore {
  create(x: Context, row: VoiceTaskRow): VoiceTaskRow {
    xDb(x)
      .prepare(
        `INSERT INTO voice_tasks
          (id, voice_session_id, question, status, result, error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.voice_session_id,
        row.question,
        row.status,
        row.result,
        row.error,
        row.created_at,
        row.updated_at,
      );
    return row;
  }

  get(x: Context, id: string): VoiceTaskRow | null {
    return (
      (xDb(x).prepare("SELECT * FROM voice_tasks WHERE id = ?").get(id) as
        VoiceTaskRow | undefined) ?? null
    );
  }

  listBySession(x: Context, sessionId: string): VoiceTaskRow[] {
    return xDb(x)
      .prepare("SELECT * FROM voice_tasks WHERE voice_session_id = ? ORDER BY created_at ASC")
      .all(sessionId) as VoiceTaskRow[];
  }

  update(
    x: Context,
    id: string,
    changes: Partial<Pick<VoiceTaskRow, "status" | "result" | "error" | "updated_at">>,
  ): VoiceTaskRow {
    const current = this.get(x, id);
    if (!current) throw new Error(`Voice task not found: ${id}`);
    const next = { ...current, ...changes };
    xDb(x)
      .prepare(
        "UPDATE voice_tasks SET status = ?, result = ?, error = ?, updated_at = ? WHERE id = ?",
      )
      .run(next.status, next.result, next.error, next.updated_at, id);
    return next;
  }
}
