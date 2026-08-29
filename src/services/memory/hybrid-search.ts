/** Hybrid memory retrieval: embeddings + FTS5 BM25 + RRF merge. */

import type { Context } from "../../context/Context.js";
import { xEmbeddingService, xEmbeddingStore } from "../../lib/x.js";
import type { SearchOptions, SearchResult } from "./MemoryService.js";
import { getSearchTerms } from "./search-excerpt.js";

const RRF_K = 60;
/**
 * Keep retrieval depth independent from the requested output count. Previously
 * this was `limit * 4`, so asking for ten results could reorder (or remove)
 * results returned when asking for five. A fixed pool makes search monotonic.
 */
const RETRIEVAL_CANDIDATE_LIMIT = 40;
const ORDINARY_RECENCY_DECAY = 0.001;
const CURRENT_STATE_RECENCY_DECAY = 0.01;

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index++) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }
  if (normA === 0 || normB === 0) return 0;
  const similarity = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  return Number.isFinite(similarity) ? similarity : 0;
}

function isCurrentStateQuery(query: string): boolean {
  return /\b(current|currently|latest|final|now|still|today|present)\b/i.test(query);
}

interface RecencyBiasResult {
  biasedScore: number;
  recencyFactor: number;
  daysAgo: number;
}

function applyRecencyBias(
  score: number,
  dayString: string,
  options: { referenceDay?: string; currentStateQuery: boolean },
): RecencyBiasResult {
  if (!dayString) return { biasedScore: score, recencyFactor: 1, daysAgo: 0 };
  const chunkDate = new Date(`${dayString}T12:00:00`);
  const referenceDate = options.referenceDay
    ? new Date(`${options.referenceDay}T12:00:00`)
    : new Date();
  const daysAgo = Math.max(
    0,
    Math.floor(Math.abs(referenceDate.getTime() - chunkDate.getTime()) / (1000 * 60 * 60 * 24)),
  );
  // Explicit temporal questions get a strong proximity preference. Queries
  // asking for current state retain the previous recency behavior, while
  // ordinary factual recall uses a genuinely gentle decay so older durable
  // facts are not buried merely because they were learned months ago.
  const decayRate = options.referenceDay
    ? 0.25
    : options.currentStateQuery
      ? CURRENT_STATE_RECENCY_DECAY
      : ORDINARY_RECENCY_DECAY;
  const recencyFactor = 1 / (1 + daysAgo * decayRate);
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
  const {
    limit = 5,
    sessionFilter,
    dayFilter,
    dayStart,
    dayEnd,
    referenceDay,
    mode = "hybrid",
  } = options;
  const store = xEmbeddingStore(x);
  const currentStateQuery = isCurrentStateQuery(query);
  const chunks = store.listChunksWithVectors(x, sessionFilter).filter((chunk) => {
    if (dayFilter && chunk.day !== dayFilter) return false;
    if (dayStart && chunk.day < dayStart) return false;
    if (dayEnd && chunk.day > dayEnd) return false;
    return true;
  });
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
      const biased = applyRecencyBias(rawScore, chunk.day, {
        referenceDay,
        currentStateQuery,
      });
      return {
        id: chunk.id,
        score: biased.biasedScore,
        rawScore,
        recencyFactor: biased.recencyFactor,
        daysAgo: biased.daysAgo,
      };
    });
    embeddingResults.sort((a, b) => b.score - a.score);
    embeddingResults = embeddingResults.slice(0, RETRIEVAL_CANDIDATE_LIMIT);
  }

  let bm25Results: Array<{ id: number; score: number }> = [];
  if (mode === "hybrid" || mode === "bm25") {
    const ftsQuery = getSearchTerms(query)
      .map((term) => `"${term}"`)
      .join(" OR ");
    if (ftsQuery) {
      try {
        const allowedIds = new Set(chunks.map((chunk) => chunk.id));
        bm25Results = store
          .searchFts(x, {
            query: ftsQuery,
            limit: dayFilter || dayStart || dayEnd ? 500 : RETRIEVAL_CANDIDATE_LIMIT,
            sessionId: sessionFilter,
          })
          .filter((result) => allowedIds.has(result.id))
          .slice(0, RETRIEVAL_CANDIDATE_LIMIT);
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
    const bm25Score = Number.isFinite(result.score) ? result.score : 0;
    const rrfScore = 0.5 / (RRF_K + rank + 1);
    const existing = merged.get(result.id);
    if (existing) {
      existing.bm25Score = bm25Score;
      existing.rrfScore += rrfScore;
    } else {
      merged.set(result.id, {
        embeddingScore: 0,
        rawEmbeddingScore: 0,
        recencyFactor: 1,
        daysAgo: 0,
        bm25Score,
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
