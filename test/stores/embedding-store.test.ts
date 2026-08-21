import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { RootContext } from "../../src/context/RootContext.js";
import { createDatabase } from "../../src/lib/sqlite/database.js";
import { xEmbeddingDb, xEmbeddingStore } from "../../src/lib/x.js";

const userDir = mkdtempSync(join(tmpdir(), "vito-embedding-store-"));
const db = createDatabase(":memory:");
const x = RootContext({ db, userDir, skillsDir: join(userDir, "skills") });
const store = xEmbeddingStore(x);

function createChunk(args: {
  sessionId: string;
  day: string;
  chunkIndex: number;
  text: string;
  messageIdStart: number;
  messageIdEnd: number;
  vector: Float32Array;
}): number {
  return store.createChunk(x, {
    ...args,
    context: `Context for ${args.text}`,
    embeddedText: args.text,
    messageCount: args.messageIdEnd - args.messageIdStart + 1,
  });
}

after(() => {
  xEmbeddingDb(x).close();
  db.close();
  rmSync(userDir, { recursive: true, force: true });
});

describe("SqliteEmbeddingStore", () => {
  it("stores chunks and vectors and tracks incremental state", () => {
    createChunk({
      sessionId: "session:a",
      day: "2026-01-01",
      chunkIndex: 0,
      text: "alpha memory",
      messageIdStart: 1,
      messageIdEnd: 3,
      vector: new Float32Array([1, 0]),
    });
    createChunk({
      sessionId: "session:a",
      day: "2026-01-01",
      chunkIndex: 1,
      text: "beta memory",
      messageIdStart: 4,
      messageIdEnd: 5,
      vector: new Float32Array([0, 1]),
    });

    assert.equal(store.getLastEmbeddedMessageId(x, "session:a"), 5);
    assert.equal(store.getNextChunkIndices(x, "session:a").get("2026-01-01"), 2);
    assert.equal(store.getPreviousChunkText(x, "session:a"), "beta memory");

    const chunks = store.listChunksWithVectors(x, "session:a");
    assert.equal(chunks.length, 2);
    assert.deepEqual([...chunks[0].vector], [1, 0]);
  });

  it("updates a chunk without creating duplicate rows or orphaning its vector", () => {
    const original = store.listChunksWithVectors(x, "session:a")[0];
    const updatedId = createChunk({
      sessionId: "session:a",
      day: "2026-01-01",
      chunkIndex: 0,
      text: "updated alpha memory",
      messageIdStart: 1,
      messageIdEnd: 3,
      vector: new Float32Array([0.5, 0.5]),
    });

    assert.equal(updatedId, original.id);
    const chunks = store.listChunksWithVectors(x, "session:a");
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0].text, "updated alpha memory");
    assert.deepEqual([...chunks[0].vector], [0.5, 0.5]);
  });

  it("supports session-scoped FTS and aggregate statistics", () => {
    createChunk({
      sessionId: "session:b",
      day: "2026-01-02",
      chunkIndex: 0,
      text: "alpha from another session",
      messageIdStart: 6,
      messageIdEnd: 6,
      vector: new Float32Array([1, 0]),
    });

    const allResults = store.searchFts(x, { query: '"alpha"', limit: 10 });
    const scopedResults = store.searchFts(x, {
      query: '"alpha"',
      limit: 10,
      sessionId: "session:a",
    });
    assert.equal(allResults.length, 2);
    assert.equal(scopedResults.length, 1);

    const stats = store.getStats(x);
    assert.equal(stats.totalChunks, 3);
    assert.equal(stats.totalSessions, 2);
    assert.equal(stats.totalDays, 2);
    assert.equal(stats.sessions[0]?.count, 2);
  });
});
