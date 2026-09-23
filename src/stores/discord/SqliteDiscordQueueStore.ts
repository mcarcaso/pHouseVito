import type { Context } from "../../context/Context.js";
import { xDb } from "../../lib/x.js";
import type {
  DiscordDeliveryReceipt,
  DiscordQueueCounts,
  DiscordQueueStore,
  DurableDiscordEvent,
} from "./DiscordQueueStore.js";

interface EventRow {
  data: string;
}

interface DeliveryRow {
  id: string;
  fingerprint: string;
  status: DiscordDeliveryReceipt["status"];
  next_piece: number;
}

function parseEvent(row: EventRow): DurableDiscordEvent {
  return JSON.parse(row.data) as DurableDiscordEvent;
}

function receipt(row: DeliveryRow): DiscordDeliveryReceipt {
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    status: row.status,
    nextPiece: row.next_piece,
  };
}

export class SqliteDiscordQueueStore implements DiscordQueueStore {
  recover(x: Context): number {
    const db = xDb(x);
    const now = Date.now();
    const transaction = db.transaction(() => {
      const inbox = db
        .prepare(
          `UPDATE discord_inbox
           SET status = 'interrupted', error = ?, completed_at = ?
           WHERE status = 'active'`,
        )
        .run("Vito stopped during this turn; it was not replayed", now).changes;
      // Discord nonces with enforce_nonce make every piece idempotent, so an
      // interrupted delivery can safely resume at its persisted piece index.
      const deliveries = db
        .prepare(
          `UPDATE discord_deliveries
           SET status = 'pending', updated_at = ?
           WHERE status = 'delivering'`,
        )
        .run(now).changes;
      db.prepare(
        `DELETE FROM discord_inbox
         WHERE status = 'completed' AND completed_at < ?`,
      ).run(now - 30 * 24 * 60 * 60 * 1_000);
      return inbox + deliveries;
    });
    return transaction();
  }

  record(x: Context, event: DurableDiscordEvent): boolean {
    return (
      xDb(x)
        .prepare(
          `INSERT OR IGNORE INTO discord_inbox
           (id, channel, status, data, created_at)
           SELECT ?, ?, 'pending', ?, ?
           WHERE NOT EXISTS (
             SELECT 1 FROM discord_cursors WHERE channel = ? AND
               (length(completed_through) > length(?) OR
                (length(completed_through) = length(?) AND completed_through >= ?))
           )`,
        )
        .run(
          event.id,
          event.channel,
          JSON.stringify(event),
          Date.now(),
          event.channel,
          event.id,
          event.id,
          event.id,
        ).changes > 0
    );
  }

  pendingChannels(x: Context): string[] {
    return (
      xDb(x)
        .prepare(
          `SELECT DISTINCT channel FROM discord_inbox
           WHERE status = 'pending'
           ORDER BY channel`,
        )
        .all() as Array<{ channel: string }>
    ).map((row) => row.channel);
  }

  claim(x: Context, channel: string): DurableDiscordEvent | undefined {
    const db = xDb(x);
    const transaction = db.transaction(() => {
      if (
        db
          .prepare("SELECT 1 FROM discord_inbox WHERE channel = ? AND status = 'active'")
          .get(channel)
      )
        return undefined;
      const row = db
        .prepare(
          `SELECT id, data FROM discord_inbox
           WHERE channel = ? AND status = 'pending'
           ORDER BY length(id), id LIMIT 1`,
        )
        .get(channel) as (EventRow & { id: string }) | undefined;
      if (!row) return undefined;
      const changed = db
        .prepare(
          `UPDATE discord_inbox SET status = 'active', error = NULL
           WHERE id = ? AND status = 'pending'`,
        )
        .run(row.id).changes;
      return changed ? parseEvent(row) : undefined;
    });
    return transaction();
  }

  discardPending(x: Context, channel: string): number {
    return xDb(x)
      .prepare(
        `UPDATE discord_inbox
         SET status = 'interrupted', error = ?, completed_at = ?
         WHERE channel = ? AND status = 'pending'`,
      )
      .run("Cleared by /stop before execution", Date.now(), channel).changes;
  }

  complete(x: Context, id: string): void {
    const db = xDb(x);
    db.transaction(() => {
      const row = db
        .prepare("SELECT channel FROM discord_inbox WHERE id = ? AND status = 'active'")
        .get(id) as { channel: string } | undefined;
      if (!row) return;
      db.prepare(
        `UPDATE discord_inbox
         SET status = 'completed', error = NULL, completed_at = ?
         WHERE id = ? AND status = 'active'`,
      ).run(Date.now(), id);
      db.prepare(
        `INSERT INTO discord_cursors(channel, completed_through) VALUES (?, ?)
         ON CONFLICT(channel) DO UPDATE SET completed_through = excluded.completed_through
         WHERE length(discord_cursors.completed_through) < length(excluded.completed_through)
            OR (length(discord_cursors.completed_through) = length(excluded.completed_through)
                AND discord_cursors.completed_through < excluded.completed_through)`,
      ).run(row.channel, id);
    })();
  }

  interrupt(x: Context, id: string, error: string): void {
    xDb(x)
      .prepare(
        `UPDATE discord_inbox
         SET status = 'interrupted', error = ?, completed_at = ?
         WHERE id = ? AND status = 'active'`,
      )
      .run(error.slice(0, 2_000), Date.now(), id);
  }

  counts(x: Context): DiscordQueueCounts {
    const rows = xDb(x)
      .prepare(
        `SELECT status, COUNT(*) AS count FROM discord_inbox
         WHERE status IN ('pending','active','interrupted') GROUP BY status`,
      )
      .all() as Array<{ status: keyof DiscordQueueCounts; count: number }>;
    const counts: DiscordQueueCounts = { pending: 0, active: 0, interrupted: 0 };
    for (const row of rows) counts[row.status] = row.count;
    return counts;
  }

  delivery(x: Context, id: string): DiscordDeliveryReceipt | undefined {
    const row = xDb(x)
      .prepare("SELECT id, fingerprint, status, next_piece FROM discord_deliveries WHERE id = ?")
      .get(id) as DeliveryRow | undefined;
    return row ? receipt(row) : undefined;
  }

  createDelivery(x: Context, id: string, fingerprint: string): DiscordDeliveryReceipt {
    const db = xDb(x);
    const now = Date.now();
    db.prepare(
      `INSERT OR IGNORE INTO discord_deliveries
       (id, fingerprint, status, next_piece, created_at, updated_at)
       VALUES (?, ?, 'pending', 0, ?, ?)`,
    ).run(id, fingerprint, now, now);
    const current = this.delivery(x, id);
    if (!current) throw new Error("Failed to create Discord delivery receipt");
    if (current.fingerprint !== fingerprint) {
      throw new Error(`Discord delivery key collision: ${id}`);
    }
    return current;
  }

  advanceDelivery(x: Context, id: string, nextPiece: number): void {
    xDb(x)
      .prepare(
        `UPDATE discord_deliveries
         SET status = 'delivering', next_piece = ?, updated_at = ?
         WHERE id = ? AND status NOT IN ('completed','unknown')`,
      )
      .run(nextPiece, Date.now(), id);
  }

  finishDelivery(x: Context, id: string): void {
    xDb(x)
      .prepare(
        `UPDATE discord_deliveries
         SET status = 'completed', updated_at = ? WHERE id = ?`,
      )
      .run(Date.now(), id);
  }

  failDelivery(x: Context, id: string, errorKnownNoEffect: boolean): void {
    xDb(x)
      .prepare(
        `UPDATE discord_deliveries
         SET status = ?, updated_at = ? WHERE id = ? AND status != 'completed'`,
      )
      .run(errorKnownNoEffect ? "failed" : "unknown", Date.now(), id);
  }
}
