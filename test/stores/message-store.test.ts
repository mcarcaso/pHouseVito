import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import { createDatabase } from "../../src/lib/sqlite/database.js";
import { SqliteMessageStore } from "../../src/stores/messages/SqliteMessageStore.js";
import { SqliteSessionStore } from "../../src/stores/sessions/SqliteSessionStore.js";

function createHarness() {
  const db = createDatabase(":memory:");
  const x = new ObjectContext({ db: () => db });
  const store = new SqliteMessageStore();
  const sessionStore = new SqliteSessionStore();
  for (const id of ["a", "b"]) {
    sessionStore.create(x, {
      id,
      channel: "dashboard",
      channel_target: id,
      created_at: 1,
      last_active_at: 1,
      config: "{}",
      alias: null,
    });
  }
  return { db, x, store };
}

function createMessage(
  store: SqliteMessageStore,
  x: ObjectContext,
  args: { sessionId: string; timestamp: number; type?: "user" | "thought" },
) {
  return store.create(x, {
    session_id: args.sessionId,
    channel: "dashboard",
    channel_target: args.sessionId,
    timestamp: args.timestamp,
    type: args.type ?? "user",
    content: JSON.stringify(`message ${args.timestamp}`),
    archived: 0,
    author: null,
  });
}

describe("SqliteMessageStore", () => {
  it("uses one filter shape for list and count", () => {
    const { db, x, store } = createHarness();
    try {
      createMessage(store, x, { sessionId: "a", timestamp: 1 });
      createMessage(store, x, { sessionId: "a", timestamp: 2, type: "thought" });
      createMessage(store, x, { sessionId: "b", timestamp: 3 });

      const filter = {
        sessionIds: ["a"],
        excludeTypes: ["thought" as const],
        archived: false,
      };
      const messages = store.list(x, { ...filter, order: "oldest" });
      assert.equal(messages.length, 1);
      assert.equal(store.count(x, filter), messages.length);
    } finally {
      db.close();
    }
  });

  it("returns created and updated records", () => {
    const { db, x, store } = createHarness();
    try {
      const created = createMessage(store, x, { sessionId: "a", timestamp: 1 });
      assert.equal(typeof created.id, "number");
      assert.equal(created.type, "user");

      const updated = store.update(x, {
        id: created.id,
        changes: { type: "assistant", archived: true },
      });
      assert.equal(updated.type, "assistant");
      assert.equal(updated.archived, 1);
    } finally {
      db.close();
    }
  });

  it("validates commands before performing bulk mutations", () => {
    const { db, x, store } = createHarness();
    try {
      createMessage(store, x, { sessionId: "a", timestamp: 1 });
      createMessage(store, x, { sessionId: "b", timestamp: 2 });

      assert.equal(store.cmd(x, { type: "archive-sessions", sessionIds: [] }), undefined);
      assert.equal(store.count(x, { archived: true }), 0);
      assert.equal(store.cmd(x, { type: "archive-sessions", sessionIds: ["a"] }), 1);
      assert.equal(store.count(x, { sessionIds: ["a"], archived: true }), 1);
      assert.equal(store.count(x, { sessionIds: ["b"], archived: false }), 1);
    } finally {
      db.close();
    }
  });

  it("deletes only explicitly filtered records", () => {
    const { db, x, store } = createHarness();
    try {
      const first = createMessage(store, x, { sessionId: "a", timestamp: 1 });
      createMessage(store, x, { sessionId: "b", timestamp: 2 });

      assert.equal(store.delete(x, {}), 0);
      assert.equal(store.delete(x, { ids: [first.id] }), 1);
      assert.equal(store.count(x, {}), 1);
    } finally {
      db.close();
    }
  });
});
