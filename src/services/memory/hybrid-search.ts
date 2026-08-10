/** Hybrid memory retrieval: embeddings + FTS5 BM25 + RRF merge. */

import type { Context } from "../../context/Context.js";
import { xEmbeddingService, xEmbeddingStore } from "../../lib/x.js";
import type { SearchOptions, SearchResult } from "./MemoryService.js";

const RRF_K = 60;

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index++) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

interface RecencyBiasResult {
  biasedScore: number;
  recencyFactor: number;
  daysAgo: number;
}

function applyRecencyBias(score: number, dayString: string): RecencyBiasResult {
  if (!dayString) return { biasedScore: score, recencyFactor: 1, daysAgo: 0 };
  const chunkDate = new Date(dayString);
  const today = new Date();
  const daysAgo = Math.max(
    0,
    Math.floor((today.getTime() - chunkDate.getTime()) / (1000 * 60 * 60 * 24)),
  );
  const recencyFactor = 1 / (1 + daysAgo * 0.01);
  return {
    biasedScore: score * recencyFactor,
    recencyFactor,
    daysAgo,
  };
}

export function getLastEmbeddedMessageId(x: Context, sessionId: string): number {
  return xEmbeddingStore(x).getLastEmbeddedMessageId(x, sessionId);
}

export async function searchMemory(
  x: Context,
  query: string,
  options: SearchOptions = {},
): Promise<SearchResult[]> {
  const { limit = 5, sessionFilter, mode = "hybrid" } = options;
  const store = xEmbeddingStore(x);
  const chunks = store.listChunksWithVectors(x, sessionFilter);
  if (chunks.length === 0) return [];

  let embeddingResults: Array<{
    id: number;
    score: number;
    rawScore: number;
    recencyFactor: number;
    daysAgo: number;
  }> = [];
  if (mode === "hybrid" || mode === "embedding") {
    const queryVector = await xEmbeddingService(x).create(x, query);
    embeddingResults = chunks.map((chunk) => {
      const rawScore = cosineSimilarity(queryVector, chunk.vector);
      const biased = applyRecencyBias(rawScore, chunk.day);
      return {
        id: chunk.id,
        score: biased.biasedScore,
        rawScore,
        recencyFactor: biased.recencyFactor,
        daysAgo: biased.daysAgo,
      };
    });
    embeddingResults.sort((a, b) => b.score - a.score);
    embeddingResults = embeddingResults.slice(0, Math.max(limit * 4, 20));
  }

  let bm25Results: Array<{ id: number; score: number }> = [];
  if (mode === "hybrid" || mode === "bm25") {
    const ftsQuery = query
      .replace(/[^\w\s'-]/g, "")
      .split(/\s+/)
      .filter((term) => term.length > 1)
      .map((term) => `"${term}"`)
      .join(" OR ");
    if (ftsQuery) {
      try {
        bm25Results = store.searchFts(x, {
          query: ftsQuery,
          limit: Math.max(limit * 4, 20),
          sessionId: sessionFilter,
        });
      } catch {
        bm25Results = [];
      }
    }
  }

  const merged = new Map<
    number,
    {
      embeddingScore: number;
      rawEmbeddingScore: number;
      recencyFactor: number;
      daysAgo: number;
      bm25Score: number;
      rrfScore: number;
    }
  >();
  for (let rank = 0; rank < embeddingResults.length; rank++) {
    const result = embeddingResults[rank];
    merged.set(result.id, {
      embeddingScore: result.score,
      rawEmbeddingScore: result.rawScore,
      recencyFactor: result.recencyFactor,
      daysAgo: result.daysAgo,
      bm25Score: 0,
      rrfScore: 0.5 / (RRF_K + rank + 1),
    });
  }
  for (let rank = 0; rank < bm25Results.length; rank++) {
    const result = bm25Results[rank];
    const rrfScore = 0.5 / (RRF_K + rank + 1);
    const existing = merged.get(result.id);
    if (existing) {
      existing.bm25Score = result.score;
      existing.rrfScore += rrfScore;
    } else {
      merged.set(result.id, {
        embeddingScore: 0,
        rawEmbeddingScore: 0,
        recencyFactor: 1,
        daysAgo: 0,
        bm25Score: result.score,
        rrfScore,
      });
    }
  }

  const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  return [...merged.entries()]
    .sort((a, b) => b[1].rrfScore - a[1].rrfScore)
    .slice(0, limit)
    .map(([id, scores]) => {
      const chunk = chunkById.get(id);
      if (!chunk) throw new Error(`Missing memory chunk: ${id}`);
      return {
        id,
        sessionId: chunk.sessionId,
        day: chunk.day,
        chunkIndex: chunk.chunkIndex,
        text: chunk.text,
        context: chunk.context,
        msgCount: chunk.messageCount,
        ...scores,
      };
    });
}
