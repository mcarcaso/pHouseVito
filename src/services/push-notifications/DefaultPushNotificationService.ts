import type { Context } from "../../context/Context.js";
import { xPushNotificationStore, xSecretService } from "../../lib/x.js";
import type { FinalAssistantMessage, PushNotificationService } from "./PushNotificationService.js";

const DEFAULT_GATEWAY_URL = "https://kdxjux37p8.execute-api.us-east-1.amazonaws.com";
const GATEWAY_DEVICE = "phouse-vito-push-gateway";

interface ExpoTicket {
  status?: string;
  id?: string;
  message?: string;
  details?: { error?: string };
}

function notificationBody(content: string): string {
  return content
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

export interface DefaultPushNotificationServiceOptions {
  fetch?: typeof fetch;
}

export class DefaultPushNotificationService implements PushNotificationService {
  private started = false;
  private delivering = false;
  private readonly fetcher: typeof fetch;

  constructor(options: DefaultPushNotificationServiceOptions = {}) {
    this.fetcher = options.fetch ?? fetch;
  }

  private gateway(x: Context): { url: string; key: string } | null {
    const secrets = xSecretService(x);
    const key = secrets.get(x, "PHOUSE_VITO_PUSH_KEY");
    if (!key) return null;
    return {
      key,
      url: secrets.get(x, "PHOUSE_VITO_PUSH_API_URL") || DEFAULT_GATEWAY_URL,
    };
  }

  start(x: Context): void {
    if (this.started) return;
    this.started = true;
    xPushNotificationStore(x).recoverSending(x);
    void this.deliverPending(x);
    const timer = setInterval(() => void this.deliverPending(x), 15_000);
    timer.unref();
  }

  async registerDevice(
    x: Context,
    input: {
      deviceId: string;
      token: string;
      platform: string;
      appId?: string;
      showPreview?: boolean;
    },
  ): Promise<void> {
    const gateway = this.gateway(x);
    if (!gateway) {
      xPushNotificationStore(x).upsertDevice(x, {
        token: input.token,
        platform: input.platform,
        updated_at: Date.now(),
      });
      return;
    }
    const response = await this.fetcher(
      `${gateway.url}/v1/devices/${encodeURIComponent(input.deviceId)}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${gateway.key}`,
        },
        body: JSON.stringify({
          expoPushToken: input.token,
          platform: input.platform,
          appId: input.appId || "phouse-vito-companion",
          showPreview: input.showPreview ?? true,
        }),
      },
    );
    if (!response.ok)
      throw new Error(`Push gateway device registration failed (${response.status})`);
  }

  enqueueForMessage(x: Context, message: FinalAssistantMessage): void {
    if (message.channel === "discord" || message.channel === "telegram") return;
    const body = notificationBody(message.content);
    if (!body || body.includes("NO_REPLY") || body === "*(interrupted)*") return;
    const store = xPushNotificationStore(x);
    const gateway = this.gateway(x);
    const devices = gateway
      ? [{ token: GATEWAY_DEVICE }]
      : store.listDevices(x).map((device) => ({ token: device.token }));
    const now = Date.now();
    for (const device of devices) {
      store.enqueue(x, {
        message_id: message.messageId,
        device_token: device.token,
        title: "Vito replied",
        body,
        data: JSON.stringify({
          type: "assistant-message",
          sessionId: message.sessionId,
          messageId: message.messageId,
        }),
        status: "queued",
        attempts: 0,
        receipt_id: null,
        error: null,
        created_at: now,
        updated_at: now,
      });
    }
    void this.deliverPending(x);
  }

  async notifyServerStarted(x: Context): Promise<void> {
    const startedAt = new Date().toISOString();
    const startupId = `server-start-${startedAt}`;
    const notification = {
      title: "Vito is back online",
      body: "The server finished starting and is ready, boss.",
      data: JSON.stringify({ type: "server-started", sessionId: "system:server", startedAt }),
    };
    const gateway = this.gateway(x);
    if (gateway) {
      await this.deliverThroughGateway(
        x,
        {
          message_id: startupId,
          ...notification,
        },
        startupId,
      );
      return;
    }

    const devices = xPushNotificationStore(x).listDevices(x);
    const results = await Promise.allSettled(
      devices.map((device) =>
        this.deliverThroughExpo(x, { device_token: device.token, ...notification }),
      ),
    );
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length > 0) {
      throw new Error(
        `Server-start push failed for ${failures.length} of ${devices.length} device(s)`,
      );
    }
  }

  async deliverPending(x: Context): Promise<void> {
    if (this.delivering) return;
    this.delivering = true;
    const store = xPushNotificationStore(x);
    try {
      for (const row of store.listPending(x, 50)) {
        store.update(x, row.id, {
          status: "sending",
          attempts: row.attempts + 1,
          updated_at: Date.now(),
        });
        try {
          const receiptId =
            row.device_token === GATEWAY_DEVICE
              ? await this.deliverThroughGateway(x, row)
              : await this.deliverThroughExpo(x, row);
          store.update(x, row.id, {
            status: "sent",
            receipt_id: receiptId,
            error: null,
            updated_at: Date.now(),
          });
        } catch (cause) {
          store.update(x, row.id, {
            status: "failed",
            error: cause instanceof Error ? cause.message : "Push delivery failed",
            updated_at: Date.now(),
          });
        }
      }
    } finally {
      this.delivering = false;
    }
  }

  private async deliverThroughGateway(
    x: Context,
    row: { message_id: string | number; title: string; body: string; data: string },
    idempotencyKey = `message-${row.message_id}`,
  ): Promise<string> {
    const gateway = this.gateway(x);
    if (!gateway) throw new Error("pHouseVitoPush is not configured");
    const data = JSON.parse(row.data) as Record<string, unknown>;
    const response = await this.fetcher(`${gateway.url}/v1/notifications`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${gateway.key}`,
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        sessionId: String(data.sessionId || ""),
        messageId: row.message_id,
        title: row.title,
        body: row.body,
        data,
      }),
    });
    if (!response.ok) throw new Error(`Push gateway delivery failed (${response.status})`);
    const result = (await response.json()) as { notificationId?: unknown };
    return typeof result.notificationId === "string" ? result.notificationId : idempotencyKey;
  }

  private async deliverThroughExpo(
    x: Context,
    row: { device_token: string; title: string; body: string; data: string },
  ): Promise<string> {
    const response = await this.fetcher("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: row.device_token,
        sound: "default",
        title: row.title,
        body: row.body,
        data: JSON.parse(row.data),
      }),
    });
    if (!response.ok) throw new Error(`Expo Push API failed (${response.status})`);
    const payload = (await response.json()) as { data?: ExpoTicket };
    const ticket = payload.data;
    if (ticket?.status !== "ok" || !ticket.id) {
      const error = ticket?.message || ticket?.details?.error || "Expo rejected notification";
      if (ticket?.details?.error === "DeviceNotRegistered")
        xPushNotificationStore(x).deleteDevice(x, row.device_token);
      throw new Error(error);
    }
    return ticket.id;
  }
}
