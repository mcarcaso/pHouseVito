import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import { createDatabase } from "../../src/db/schema.js";
import { StoreRecordNotFoundError } from "../../src/stores/Store.js";
import { SqliteSessionStore } from "../../src/stores/sessions/SqliteSessionStore.js";
import type { SessionRow } from "../../src/stores/sessions/SessionStore.js";

function createHarness() {
  const db = createDatabase(":memory:");
  const x = new ObjectContext({ db: () => db });
  const store = new SqliteSessionStore();
  return { db, x, store };
}

function session(
  id: string,
  overrides: Partial<SessionRow> = {}
): SessionRow {
  return {
    id,
    channel: "dashboard",
    channel_target: id,
    created_at: 1,
    last_active_at: 1,
    config: "{}",
    alias: null,
    ...overrides,
  };
}

describe("SqliteSessionStore", () => {
  it("returns created records and supports consistent list/count filters", () => {
    const { db, x, store } = createHarness();
    try {
      const created = store.create(x, session("a", {
        channel: "discord",
        alias: "Alpha",
        last_active_at: 2,
      }));
      store.create(x, session("b", {
        channel: "discord",
        last_active_at: 3,
      }));
      store.create(x, session("c", { channel: "telegram" }));

      assert.equal(created.alias, "Alpha");
      const filter = { channels: ["discord"], hasAlias: true };
      assert.deepEqual(store.list(x, filter).map((row) => row.id), ["a"]);
      assert.equal(store.count(x, filter), 1);
      assert.deepEqual(
        store.list(x, { channels: ["discord"], order: "recent" }).map((row) => row.id),
        ["b", "a"]
      );
    } finally {
      db.close();
    }
  });

  it("updates mutable fields and returns the updated record", () => {
    const { db, x, store } = createHarness();
    try {
      store.create(x, session("a"));
      const updated = store.update(x, {
        id: "a",
        changes: {
          alias: "Updated",
          config: '{"streamMode":"final"}',
          last_active_at: 10,
        },
      });
      assert.equal(updated.alias, "Updated");
      assert.equal(updated.config, '{"streamMode":"final"}');
      assert.equal(updated.last_active_at, 10);
      assert.throws(
        () => store.update(x, { id: "missing", changes: { alias: "nope" } }),
        StoreRecordNotFoundError
      );
    } finally {
      db.close();
    }
  });

  it("requires explicit IDs for deletion", () => {
    const { db, x, store } = createHarness();
    try {
      store.create(x, session("a"));
      store.create(x, session("b"));
      assert.equal(store.delete(x, { ids: [] }), 0);
      assert.equal(store.delete(x, { ids: ["a"] }), 1);
      assert.equal(store.count(x, {}), 1);
    } finally {
      db.close();
    }
  });
});
