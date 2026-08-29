import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import { searchMemory } from "../../src/services/memory/hybrid-search.js";
import {
  extractRelevantExcerpt,
  getSearchTerms,
} from "../../src/services/memory/search-excerpt.js";
import type { EmbeddingStore } from "../../src/stores/embeddings/EmbeddingStore.js";

function vectorWithCosine(similarity: number): Float32Array {
  return new Float32Array([similarity, Math.sqrt(1 - similarity * similarity)]);
}

function dayOffset(daysAgo: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

function createContext(args: {
  chunks: Array<{
    id: number;
    day: string;
    vector: Float32Array;
    text?: string;
    context?: string;
  }>;
  fts?: Array<{ id: number; score: number }>;
  observedFtsLimits?: number[];
}) {
  const store: EmbeddingStore = {
    getLastEmbeddedMessageId: () => 0,
    getNextChunkIndices: () => new Map(),
    getPreviousChunkText: () => null,
    createChunk: () => 0,
    listChunksWithVectors: () =>
      args.chunks.map((chunk) => ({
        id: chunk.id,
        sessionId: "test:session",
        day: chunk.day,
        chunkIndex: chunk.id,
        text: chunk.text ?? `chunk ${chunk.id}`,
        context: chunk.context ?? null,
        messageCount: 1,
        vector: chunk.vector,
      })),
    searchFts: (_x, options) => {
      args.observedFtsLimits?.push(options.limit);
      return (args.fts ?? []).slice(0, options.limit);
    },
    getStats: () => ({
      totalChunks: args.chunks.length,
      totalSessions: 1,
      totalDays: 1,
      oldestDay: null,
      newestDay: null,
      sessions: [],
    }),
  };
  return new ObjectContext({
    embeddingStore: () => store,
    embeddingService: () => ({ create: async () => new Float32Array([1, 0]) }),
  });
}

describe("memory search", () => {
  it("uses a stable candidate pool so larger limits preserve the earlier ranking", async () => {
    const observedFtsLimits: number[] = [];
    const chunks = Array.from({ length: 60 }, (_, index) => ({
      id: index + 1,
      day: dayOffset(index),
      vector: vectorWithCosine(0.99 - index * 0.005),
    }));
    const fts = [...chunks].reverse().map((chunk, index) => ({ id: chunk.id, score: 100 - index }));
    const x = createContext({ chunks, fts, observedFtsLimits });

    const five = await searchMemory(x, "stable retrieval", { limit: 5 });
    const ten = await searchMemory(x, "stable retrieval", { limit: 10 });

    assert.deepEqual(
      ten.slice(0, 5).map((result) => result.id),
      five.map((result) => result.id),
    );
    assert.deepEqual(observedFtsLimits, [40, 40]);
  });

  it("does not bury an older durable fact unless the query asks for current state", async () => {
    const x = createContext({
      chunks: [
        { id: 1, day: dayOffset(180), vector: vectorWithCosine(0.98), text: "older fact" },
        { id: 2, day: dayOffset(0), vector: vectorWithCosine(0.8), text: "recent fact" },
      ],
    });

    const durable = await searchMemory(x, "favorite band", { limit: 2, mode: "embedding" });
    const current = await searchMemory(x, "current favorite band", {
      limit: 2,
      mode: "embedding",
    });

    assert.equal(durable[0].id, 1);
    assert.equal(current[0].id, 2);
  });

  it("normalizes invalid BM25 scores instead of leaking nulls into output", async () => {
    const x = createContext({
      chunks: [{ id: 1, day: dayOffset(0), vector: vectorWithCosine(1) }],
      fts: [{ id: 1, score: null as unknown as number }],
    });
    const [result] = await searchMemory(x, "dated query", { mode: "bm25" });
    assert.equal(result.bm25Score, 0);
  });
});

describe("memory search excerpts", () => {
  it("removes conversational filler from lexical search terms", () => {
    assert.deepEqual(getSearchTerms("What is Mike's current favorite band?"), ["favorite", "band"]);
  });

  it("centers evidence on a relevant user statement instead of the start of the chunk", () => {
    const text = [
      "Earlier unrelated discussion about lunch.",
      "[8:00 AM] assistant: Maybe the vehicle is blue.",
      "More unrelated filler ".repeat(20),
      "[8:05 AM] user: My current vehicle is a black manual Honda Civic.",
      "Later unrelated discussion.",
    ].join("\n");

    const excerpt = extractRelevantExcerpt(text, "What is Mike's current vehicle?", 220);
    assert.match(excerpt, /user: My current vehicle is a black manual Honda Civic/);
    assert.doesNotMatch(excerpt, /^Earlier unrelated discussion/);
  });
});
