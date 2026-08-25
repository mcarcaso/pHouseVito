import assert from "node:assert/strict";
import test from "node:test";
import { createDatabase } from "../../src/lib/sqlite/database.js";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import { SqliteQuickCommandStore } from "../../src/stores/quick-commands/SqliteQuickCommandStore.js";

function setup() {
  const db = createDatabase(":memory:");
  const x = new ObjectContext({ db: () => db });
  return { db, x, store: new SqliteQuickCommandStore() };
}

test("quick command store persists lifecycle updates", () => {
  const { db, x, store } = setup();
  const row = {
    id: "command-123",
    status: "queued" as const,
    transcript: null,
    result: null,
    error: null,
    created_at: 1,
    updated_at: 1,
  };
  store.create(x, row);
  assert.deepEqual(store.get(x, row.id), row);
  const updated = store.update(x, row.id, {
    status: "completed",
    transcript: "hello",
    result: "done",
    updated_at: 2,
  });
  assert.equal(updated.status, "completed");
  assert.equal(store.get(x, row.id)?.result, "done");
  db.close();
});

test("push device registration is idempotent", () => {
  const { db, x, store } = setup();
  store.upsertPushDevice(x, { token: "ExponentPushToken[test]", platform: "ios", updated_at: 1 });
  store.upsertPushDevice(x, { token: "ExponentPushToken[test]", platform: "ios", updated_at: 2 });
  assert.equal(store.listPushDevices(x).length, 1);
  assert.equal(store.listPushDevices(x)[0]?.updated_at, 2);
  db.close();
});
