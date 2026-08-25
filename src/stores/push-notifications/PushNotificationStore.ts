import type { Context } from "../../context/Context.js";

export interface PushDeviceRow {
  token: string;
  platform: string;
  updated_at: number;
}

export interface PushNotificationRow {
  id: number;
  message_id: number;
  device_token: string;
  title: string;
  body: string;
  data: string;
  status: "queued" | "sending" | "sent" | "failed";
  attempts: number;
  receipt_id: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

export interface PushNotificationStore {
  upsertDevice(x: Context, row: PushDeviceRow): void;
  listDevices(x: Context): PushDeviceRow[];
  deleteDevice(x: Context, token: string): void;
  enqueue(x: Context, input: Omit<PushNotificationRow, "id">): PushNotificationRow | null;
  listPending(x: Context, limit: number): PushNotificationRow[];
  update(
    x: Context,
    id: number,
    changes: Partial<
      Pick<PushNotificationRow, "status" | "attempts" | "receipt_id" | "error" | "updated_at">
    >,
  ): void;
  recoverSending(x: Context): void;
}
