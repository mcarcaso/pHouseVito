import type { Context } from "../../context/Context.js";
import { xDb } from "../../lib/x.js";
import type {
  PushDeviceRow,
  PushNotificationRow,
  PushNotificationStore,
} from "./PushNotificationStore.js";

export class SqlitePushNotificationStore implements PushNotificationStore {
  upsertDevice(x: Context, row: PushDeviceRow): void {
    xDb(x)
      .prepare(
        `INSERT INTO push_devices (token,platform,updated_at) VALUES (?,?,?) ON CONFLICT(token) DO UPDATE SET platform=excluded.platform, updated_at=excluded.updated_at`,
      )
      .run(row.token, row.platform, row.updated_at);
  }
  listDevices(x: Context): PushDeviceRow[] {
    return xDb(x)
      .prepare("SELECT * FROM push_devices ORDER BY updated_at DESC")
      .all() as PushDeviceRow[];
  }
  deleteDevice(x: Context, token: string): void {
    xDb(x).prepare("DELETE FROM push_devices WHERE token = ?").run(token);
  }
  enqueue(x: Context, input: Omit<PushNotificationRow, "id">): PushNotificationRow | null {
    const result = xDb(x)
      .prepare(
        `INSERT OR IGNORE INTO push_notification_outbox (message_id,device_token,title,body,data,status,attempts,receipt_id,error,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        input.message_id,
        input.device_token,
        input.title,
        input.body,
        input.data,
        input.status,
        input.attempts,
        input.receipt_id,
        input.error,
        input.created_at,
        input.updated_at,
      );
    if (!result.changes) return null;
    return { id: Number(result.lastInsertRowid), ...input };
  }
  listPending(x: Context, limit: number): PushNotificationRow[] {
    return xDb(x)
      .prepare(
        "SELECT * FROM push_notification_outbox WHERE status IN ('queued','failed') AND attempts < 5 ORDER BY created_at ASC LIMIT ?",
      )
      .all(limit) as PushNotificationRow[];
  }
  update(
    x: Context,
    id: number,
    changes: Partial<
      Pick<PushNotificationRow, "status" | "attempts" | "receipt_id" | "error" | "updated_at">
    >,
  ): void {
    const current = xDb(x)
      .prepare("SELECT * FROM push_notification_outbox WHERE id = ?")
      .get(id) as PushNotificationRow | undefined;
    if (!current) return;
    const next = { ...current, ...changes };
    xDb(x)
      .prepare(
        "UPDATE push_notification_outbox SET status=?,attempts=?,receipt_id=?,error=?,updated_at=? WHERE id=?",
      )
      .run(next.status, next.attempts, next.receipt_id, next.error, next.updated_at, id);
  }
  recoverSending(x: Context): void {
    xDb(x)
      .prepare(
        "UPDATE push_notification_outbox SET status='queued', updated_at=? WHERE status='sending'",
      )
      .run(Date.now());
  }
}
