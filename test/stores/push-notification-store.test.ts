import assert from "node:assert/strict";
import test from "node:test";
import { createDatabase } from "../../src/lib/sqlite/database.js";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import { SqlitePushNotificationStore } from "../../src/stores/push-notifications/SqlitePushNotificationStore.js";

function setup() {
  const db = createDatabase(":memory:");
  const x = new ObjectContext({ db: () => db });
  return { db, x, store: new SqlitePushNotificationStore() };
}

test("push device registration is idempotent", () => {
  const { db, x, store } = setup();
  store.upsertDevice(x, { token: "ExponentPushToken[test]", platform: "ios", updated_at: 1 });
  store.upsertDevice(x, { token: "ExponentPushToken[test]", platform: "ios", updated_at: 2 });
  assert.equal(store.listDevices(x).length, 1);
  assert.equal(store.listDevices(x)[0]?.updated_at, 2);
  db.close();
});

test("notification outbox deduplicates message and device", () => {
  const { db, x, store } = setup();
  db.prepare(
    "INSERT INTO sessions (id,channel,channel_target,created_at,last_active_at,config,alias) VALUES ('s','direct','s',1,1,'{}',NULL)",
  ).run();
  const message = db
    .prepare(
      "INSERT INTO messages (session_id,channel,channel_target,timestamp,type,content,archived,author) VALUES ('s','direct','s',1,'assistant','\"done\"',0,NULL)",
    )
    .run();
  const input = {
    message_id: Number(message.lastInsertRowid),
    device_token: "ExponentPushToken[test]",
    title: "Vito replied",
    body: "done",
    data: "{}",
    status: "queued" as const,
    attempts: 0,
    receipt_id: null,
    error: null,
    created_at: 1,
    updated_at: 1,
  };
  assert.ok(store.enqueue(x, input));
  assert.equal(store.enqueue(x, input), null);
  assert.equal(store.listPending(x, 10).length, 1);
  db.close();
});
