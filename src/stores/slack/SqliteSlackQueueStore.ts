import type { Context } from "../../context/Context.js";
import { xDb } from "../../lib/x.js";
import type { DurableSlackEvent, SlackQueueStore } from "./SlackQueueStore.js";

export class SqliteSlackQueueStore implements SlackQueueStore {
  recover(x: Context): number {
    return xDb(x)
      .prepare(
        `UPDATE slack_inbox SET status = 'interrupted', error = ?
      WHERE status IN ('active', 'steering')`,
      )
      .run("Vito stopped during this turn; it was not replayed").changes;
  }

  record(x: Context, item: DurableSlackEvent, immediate = false): boolean {
    return (
      xDb(x)
        .prepare(
          `INSERT OR IGNORE INTO slack_inbox(id, target, status, data, created_at)
      VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          item.id,
          item.event.target,
          immediate ? "completed" : "pending",
          JSON.stringify(item),
          Date.now(),
        ).changes > 0
    );
  }

  pending(x: Context, id: string): DurableSlackEvent | undefined {
    const row = xDb(x)
      .prepare("SELECT data FROM slack_inbox WHERE id = ? AND status = 'pending'")
      .get(id) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as DurableSlackEvent) : undefined;
  }

  pendingTargets(x: Context): string[] {
    return (
      xDb(x)
        .prepare("SELECT DISTINCT target FROM slack_inbox WHERE status = 'pending'")
        .all() as Array<{ target: string }>
    ).map((row) => row.target);
  }

  claim(x: Context, target: string): DurableSlackEvent | undefined {
    const db = xDb(x);
    return db.transaction(() => {
      if (
        db
          .prepare("SELECT 1 FROM slack_inbox WHERE target = ? AND status IN ('active','steering')")
          .get(target)
      )
        return;
      const row = db
        .prepare(
          "SELECT id, data FROM slack_inbox WHERE target = ? AND status = 'pending' ORDER BY rowid LIMIT 1",
        )
        .get(target) as { id: string; data: string } | undefined;
      if (!row) return;
      db.prepare(
        "UPDATE slack_inbox SET status = 'active' WHERE id = ? AND status = 'pending'",
      ).run(row.id);
      return JSON.parse(row.data) as DurableSlackEvent;
    })();
  }

  reserveSteering(x: Context, id: string): boolean {
    return (
      xDb(x)
        .prepare("UPDATE slack_inbox SET status = 'steering' WHERE id = ? AND status = 'pending'")
        .run(id).changes > 0
    );
  }

  finishSteering(x: Context, id: string, accepted: boolean): boolean {
    return (
      xDb(x)
        .prepare("UPDATE slack_inbox SET status = ? WHERE id = ? AND status = 'steering'")
        .run(accepted ? "completed" : "pending", id).changes > 0
    );
  }

  discardPending(x: Context, target: string): number {
    return xDb(x)
      .prepare(
        "UPDATE slack_inbox SET status = 'interrupted', error = ? WHERE target = ? AND status IN ('pending','steering')",
      )
      .run("Cleared by /stop before execution", target).changes;
  }

  finish(x: Context, id: string, error?: string): void {
    xDb(x)
      .prepare("UPDATE slack_inbox SET status = ?, error = ? WHERE id = ? AND status = 'active'")
      .run(error ? "interrupted" : "completed", error ?? null, id);
  }

  counts(x: Context): { pending: number; active: number; interrupted: number } {
    const rows = xDb(x)
      .prepare("SELECT status, count(*) AS count FROM slack_inbox GROUP BY status")
      .all() as Array<{ status: string; count: number }>;
    const count = (status: string) => rows.find((row) => row.status === status)?.count ?? 0;
    return {
      pending: count("pending") + count("steering"),
      active: count("active"),
      interrupted: count("interrupted"),
    };
  }
}
