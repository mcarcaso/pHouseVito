import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import { createDatabase } from "../../src/lib/sqlite/database.js";
import { CoalescingMemoryIngestionService } from "../../src/services/memory/CoalescingMemoryIngestionService.js";
import type { IngestionCandidate } from "../../src/services/memory/chunking.js";
import { createEmbeddingDatabase } from "../../src/stores/embeddings/embedding-database.js";
import { SqliteEmbeddingStore } from "../../src/stores/embeddings/SqliteEmbeddingStore.js";
import { EmbeddingMessageStore } from "../../src/stores/messages/EmbeddingMessageStore.js";
import { SqliteMessageStore } from "../../src/stores/messages/SqliteMessageStore.js";
import { SqliteSessionStore } from "../../src/stores/sessions/SqliteSessionStore.js";

function result(candidates: IngestionCandidate[]) {
  return {
    embedding: {
      chunks_created: candidates.length,
      chunks: [],
      unembedded_messages: candidates.flatMap((candidate) => candidate.messages).length,
      unembedded_chars: candidates.reduce((sum, candidate) => sum + candidate.text.length, 0),
      duration_ms: 0,
    },
    facts: {
      inserted: [],
      supported: [],
      superseded: [],
      rejected: [],
      batchesProcessed: 0,
      messagesConsidered: 0,
      durationMs: 0,
    },
  };
}

function setup() {
  const db = createDatabase(":memory:");
  const embeddingDb = createEmbeddingDatabase(":memory:");
  const calls: IngestionCandidate[][] = [];
  const store = new EmbeddingMessageStore(new SqliteMessageStore());
  const sessionStore = new SqliteSessionStore();
  const x = new ObjectContext({
    db: () => db,
    embeddingDb: () => embeddingDb,
    embeddingStore: () => new SqliteEmbeddingStore(),
    sessionStore: () => sessionStore,
    memoryIngestionService: () => ({
      ingestCandidates: async (_x: ObjectContext, candidates: IngestionCandidate[]) => {
        calls.push(candidates);
        return result(candidates);
      },
    }),
  });
  sessionStore.create(x, {
    id: "dashboard:test",
    channel: "dashboard",
    channel_target: "test",
    created_at: 1,
    last_active_at: 1,
    config: "{}",
    alias: "Test",
  });
  return { db, embeddingDb, calls, store, x };
}

function createMessage(
  store: EmbeddingMessageStore,
  x: ObjectContext,
  type: "user" | "thought" | "assistant",
  content: string,
) {
  return store.create(x, {
    session_id: "dashboard:test",
    channel: "dashboard",
    channel_target: "test",
    timestamp: Date.now(),
    type,
    content: JSON.stringify(content),
    archived: 0,
    author: type === "user" ? "mcarcaso" : "Vito",
  });
}

describe("CoalescingMemoryIngestionService", () => {
  it("deduplicates the same candidate while it is queued", async () => {
    const { db, embeddingDb, store, x } = setup();
    const user = createMessage(store, x, "user", "u".repeat(1_100));
    const assistant = createMessage(store, x, "thought", "a".repeat(1_100));
    const candidate: IngestionCandidate = {
      sessionId: "dashboard:test",
      initialAfterMessageId: 0,
      day: "2026-09-03",
      chunkIndex: 0,
      text: "candidate",
      messages: [
        { ...user, type: "user" },
        { ...assistant, type: "assistant" },
      ],
    };
    let calls = 0;
    const service = new CoalescingMemoryIngestionService({
      ingestCandidates: async (_x, candidates) => {
        calls += 1;
        return result(candidates);
      },
    });

    await Promise.all([
      service.ingestCandidates(x, [candidate]),
      service.ingestCandidates(x, [candidate]),
    ]);

    assert.equal(calls, 1);
    embeddingDb.close();
    db.close();
  });
});

describe("EmbeddingMessageStore", () => {
  it("only invokes ingestion when a finalized assistant creates a complete character window", async () => {
    const { db, embeddingDb, calls, store, x } = setup();
    createMessage(store, x, "user", "u".repeat(1_100));
    const thought = createMessage(store, x, "thought", "a".repeat(1_100));
    assert.equal(calls.length, 0);

    store.update(x, { id: thought.id, changes: { type: "assistant" } });
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.equal(calls.length, 1);
    assert.deepEqual(
      calls[0].flatMap((candidate) => candidate.messages.map((message) => message.id)),
      [thought.id - 1, thought.id],
    );
    embeddingDb.close();
    db.close();
  });

  it("forces an undersized remainder through the same path when sessions are archived", async () => {
    const { db, embeddingDb, calls, store, x } = setup();
    createMessage(store, x, "user", "short user turn");
    createMessage(store, x, "assistant", "short assistant turn");
    assert.equal(calls.length, 0);

    store.cmd(x, { type: "archive-sessions", sessionIds: ["dashboard:test"] });
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.equal(calls.length, 1);
    assert.equal(calls[0][0]?.sessionId, "dashboard:test");
    assert.equal(calls[0][0]?.messages.length, 2);
    embeddingDb.close();
    db.close();
  });
});
