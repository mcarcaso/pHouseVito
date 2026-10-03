import assert from "node:assert/strict";
import test from "node:test";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import { DefaultPushNotificationService } from "../../src/services/push-notifications/DefaultPushNotificationService.js";

test("server-start notifications are sent through the configured push gateway", async () => {
  let request: { url: string; init?: RequestInit } | undefined;
  const service = new DefaultPushNotificationService({
    fetch: async (input, init) => {
      request = { url: String(input), init };
      return new Response(JSON.stringify({ notificationId: "notification-test" }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  const x = new ObjectContext({
    secretService: () => ({
      get: (_x: unknown, key: string) =>
        key === "PHOUSE_VITO_PUSH_KEY"
          ? "test-key"
          : key === "PHOUSE_VITO_PUSH_API_KEY"
            ? "test-service-key"
            : key === "PHOUSE_VITO_PUSH_API_URL"
              ? "https://push.example.com"
              : undefined,
    }),
  });

  await service.notifyServerStarted(x);

  assert.equal(request?.url, "https://push.example.com/v1/notifications");
  assert.equal(new Headers(request?.init?.headers).get("Authorization"), "Bearer test-key");
  assert.equal(new Headers(request?.init?.headers).get("x-api-key"), "test-service-key");
  assert.match(new Headers(request?.init?.headers).get("Idempotency-Key") ?? "", /^server-start-/);
  const body = JSON.parse(String(request?.init?.body)) as {
    sessionId: string;
    messageId: string;
    title: string;
    data: { type: string };
  };
  assert.equal(body.sessionId, "system:server");
  assert.match(body.messageId, /^server-start-/);
  assert.equal(body.title, "Vito is back online");
  assert.equal(body.data.type, "server-started");
});

test("missing service API key blocks startup and queued legacy sends without any fetch", async () => {
  let calls = 0;
  const updates: Array<{ status: string; error?: string }> = [];
  const service = new DefaultPushNotificationService({
    fetch: async () => {
      calls++;
      throw new Error("Must not send");
    },
  });
  const x = new ObjectContext({
    secretService: () => ({
      get: (_x: unknown, key: string) =>
        key === "PHOUSE_VITO_PUSH_KEY" ? "test-account-key" : undefined,
    }),
    pushNotificationStore: () => ({
      listPending: () => [
        {
          id: 1,
          message_id: 2,
          device_token: "ExponentPushToken[legacy]",
          title: "Test",
          body: "Test",
          data: "{}",
          attempts: 0,
        },
      ],
      update: (_x: unknown, _id: unknown, patch: { status: string; error?: string }) =>
        updates.push(patch),
    }),
  });
  await assert.rejects(service.notifyServerStarted(x), /PHOUSE_VITO_PUSH_API_KEY is required/);
  await service.deliverPending(x);
  assert.equal(calls, 0);
  assert.equal(
    updates.length,
    0,
    "Missing configuration must preserve queued messages and retries",
  );
});

test("missing account key cannot fall back to direct Expo startup delivery", async () => {
  let calls = 0;
  const service = new DefaultPushNotificationService({
    fetch: async () => {
      calls++;
      throw new Error("Must not send");
    },
  });
  const x = new ObjectContext({ secretService: () => ({ get: () => undefined }) });
  await assert.rejects(service.notifyServerStarted(x), /account key is required/);
  assert.equal(calls, 0);
});

test("queued legacy device rows also use authenticated gateway, never direct Expo", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const updates: Array<{ status: string }> = [];
  const service = new DefaultPushNotificationService({
    fetch: async (input, init) => {
      requests.push({ url: String(input), init });
      return new Response(JSON.stringify({ notificationId: "test-notification" }), { status: 202 });
    },
  });
  const keys: Record<string, string> = {
    PHOUSE_VITO_PUSH_KEY: "test-account",
    PHOUSE_VITO_PUSH_API_KEY: "test-api",
    PHOUSE_VITO_PUSH_API_URL: "https://push.example.com",
  };
  const x = new ObjectContext({
    secretService: () => ({ get: (_x: unknown, key: string) => keys[key] }),
    pushNotificationStore: () => ({
      listPending: () => [
        {
          id: 1,
          message_id: 2,
          device_token: "ExponentPushToken[legacy]",
          title: "Test",
          body: "Test",
          data: "{}",
          attempts: 0,
        },
      ],
      update: (_x: unknown, _id: unknown, patch: { status: string }) => updates.push(patch),
    }),
  });
  await service.deliverPending(x);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://push.example.com/v1/notifications");
  assert.equal(new Headers(requests[0].init?.headers).get("x-api-key"), "test-api");
  assert.equal(new Headers(requests[0].init?.headers).get("Authorization"), "Bearer test-account");
  assert.equal(updates.at(-1)?.status, "sent");
});
