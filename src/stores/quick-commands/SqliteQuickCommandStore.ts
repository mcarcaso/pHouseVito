import type { Context } from "../../context/Context.js";
import { xDb } from "../../lib/x.js";
import type { QuickCommandRow, QuickCommandStore } from "./QuickCommandStore.js";

export class SqliteQuickCommandStore implements QuickCommandStore {
  create(x: Context, row: QuickCommandRow): QuickCommandRow {
    xDb(x)
      .prepare(
        `INSERT INTO quick_commands (id,status,transcript,result,error,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`,
      )
      .run(
        row.id,
        row.status,
        row.transcript,
        row.result,
        row.error,
        row.created_at,
        row.updated_at,
      );
    return row;
  }
  get(x: Context, id: string): QuickCommandRow | null {
    return (
      (xDb(x).prepare("SELECT * FROM quick_commands WHERE id = ?").get(id) as
        QuickCommandRow | undefined) ?? null
    );
  }
  update(
    x: Context,
    id: string,
    changes: Partial<
      Pick<QuickCommandRow, "status" | "transcript" | "result" | "error" | "updated_at">
    >,
  ): QuickCommandRow {
    const current = this.get(x, id);
    if (!current) throw new Error(`Quick command not found: ${id}`);
    const next = { ...current, ...changes };
    xDb(x)
      .prepare(
        "UPDATE quick_commands SET status=?, transcript=?, result=?, error=?, updated_at=? WHERE id=?",
      )
      .run(next.status, next.transcript, next.result, next.error, next.updated_at, id);
    return next;
  }
}
