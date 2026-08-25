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
          : key === "PHOUSE_VITO_PUSH_API_URL"
            ? "https://push.example.com"
            : undefined,
    }),
  });

  await service.notifyServerStarted(x);

  assert.equal(request?.url, "https://push.example.com/v1/notifications");
  assert.equal(new Headers(request?.init?.headers).get("Authorization"), "Bearer test-key");
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
