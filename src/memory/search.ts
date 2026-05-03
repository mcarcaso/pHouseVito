/**
 * MEMORY SEARCH — Hybrid Retrieval (Embeddings + FTS5 BM25)
 * 
 * Two entry points:
 * 
 * 1. `autoSearchForContext(query)` — lightweight auto-search that runs before every response.
 *    Returns formatted text to inject into the system prompt if relevant results are found.
 *    Returns empty string if nothing scores above threshold (no noise).
 * 
 * 2. `searchMemory(query, options)` — full search for the CLI tool / deep digs.
 *    Returns structured results with scores and metadata.
 * 
 * Uses the same embeddings.db as the incremental embeddings pipeline.
 * Search is: embed the query → cosine similarity → FTS5 BM25 → RRF merge.
 */

import Database from "better-sqlite3";
import { join, resolve } from "path";
import { createEmbedding } from "./client.js";
import type { ResolvedMemorySettings } from "../types.js";

// ── Config ─────────────────────────────────────────────────

const ROOT = resolve(process.cwd());
const EMBEDDINGS_DB_PATH = join(ROOT, "user", "embeddings.db");

// Default auto-search settings (used if not provided via config)
const DEFAULT_AUTO_SEARCH_LIMIT = 3;           // Max chunks to inject
const DEFAULT_AUTO_SEARCH_RRF_THRESHOLD = 0.005; // Minimum RRF score to include (filters noise)
const RRF_K = 60;                              // RRF constant


// ── Shared DB ──────────────────────────────────────────────

let embDB: ReturnType<typeof Database> | null = null;

function getEmbeddingsDB(): ReturnType<typeof Database> {
  if (!embDB) {
    try {
      embDB = new Database(EMBEDDINGS_DB_PATH, { readonly: true });
      embDB.pragma("journal_mode = WAL");
    } catch {
      return null as any;
    }
  }
  return embDB;
}

// ── Vector Math ────────────────────────────────────────────

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Apply a light recency bias to embedding scores.
 * Recent chunks get a slight boost, but relevance still dominates.
 * Decay factor of 0.01 means:
 *   - Today: 100% score
 *   - 1 week: ~93%
 *   - 1 month: ~74%
 *   - 6 months: ~45%
 *   - 1 year: ~27%
 */
interface RecencyBiasResult {
  biasedScore: number;
  recencyFactor: number;
  daysAgo: number;
}

function applyRecencyBias(score: number, dayString: string): RecencyBiasResult {
  if (!dayString) return { biasedScore: score, recencyFactor: 1, daysAgo: 0 };
  const chunkDate = new Date(dayString);
  const today = new Date();
  const daysAgo = Math.max(0, Math.floor((today.getTime() - chunkDate.getTime()) / (1000 * 60 * 60 * 24)));
  const decayFactor = 0.01;
  const recencyFactor = 1 / (1 + daysAgo * decayFactor);
  return { 
    biasedScore: score * recencyFactor, 
    recencyFactor, 
    daysAgo 
  };
}


// ── Search Interfaces ──────────────────────────────────────

interface ChunkRow {
  id: number;
  session_id: string;
  day: string;
  chunk_index: number;
  text: string;
  context: string | null;
  msg_count: number;
  vector: Buffer;
}

/** Return the highest message id already covered by embedded chunks for a session. */
export function getLastEmbeddedMessageId(sessionId: string): number {
  const db = getEmbeddingsDB();
  if (!db) return 0;
  try {
    const row = db
      .prepare("SELECT MAX(msg_id_end) as last_id FROM chunks WHERE session_id = ?")
      .get(sessionId) as { last_id: number | null } | undefined;
    return row?.last_id ?? 0;
  } catch {
    return 0;
  }
}

interface SearchResult {
  id: number;
  sessionId: string;
  day: string;
  text: string;
  context: string | null;
  msgCount: number;
  embeddingScore: number;
  rawEmbeddingScore: number;
  recencyFactor: number;
  daysAgo: number;
  bm25Score: number;
  rrfScore: number;
}

interface SearchOptions {
  limit?: number;
  sessionFilter?: string;
  mode?: "hybrid" | "embedding" | "bm25";
}

// ── Core Search ────────────────────────────────────────────

/**
 * Full hybrid search. Returns structured results.
 */
export async function searchMemory(
  query: string,
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  const { limit = 5, sessionFilter, mode = "hybrid" } = options;
  const db = getEmbeddingsDB();
  if (!db) return [];

  // Load all chunks with embeddings
  let sql = `
    SELECT c.id, c.session_id, c.day, c.chunk_index, c.text, c.context, c.msg_count,
           e.vector
    FROM chunks c
    JOIN embeddings e ON e.chunk_id = c.id
  `;
  const params: any[] = [];
  if (sessionFilter) {
    sql += ` WHERE c.session_id = ?`;
    params.push(sessionFilter);
  }

  const rows = db.prepare(sql).all(...params) as ChunkRow[];
  if (rows.length === 0) return [];

  // ── Embedding search (with recency bias) ──
  let embeddingResults: { id: number; score: number; rawScore: number; recencyFactor: number; daysAgo: number }[] = [];
  if (mode === "hybrid" || mode === "embedding") {
    const queryVector = await createEmbedding(query);
    embeddingResults = rows.map((row) => {
      const vector = new Float32Array(
        row.vector.buffer,
        row.vector.byteOffset,
        row.vector.byteLength / 4
      );
      const rawScore = cosineSimilarity(queryVector, vector);
      // Apply light recency bias — recent stuff gets a boost
      const { biasedScore, recencyFactor, daysAgo } = applyRecencyBias(rawScore, row.day);
      return { id: row.id, score: biasedScore, rawScore, recencyFactor, daysAgo };
    });
    embeddingResults.sort((a, b) => b.score - a.score);
    embeddingResults = embeddingResults.slice(0, Math.max(limit * 4, 20));
  }

  // ── FTS5 BM25 search ──
  let bm25Results: { id: number; score: number }[] = [];
  if (mode === "hybrid" || mode === "bm25") {
    const ftsQuery = query
      .replace(/[^\w\s'-]/g, "")
      .split(/\s+/)
      .filter((t) => t.length > 1)
      .map((t) => `"${t}"`)
      .join(" OR ");

    if (ftsQuery) {
      try {
        let ftsSql = `
          SELECT rowid as id, rank * -1 as score
          FROM chunks_fts
          WHERE chunks_fts MATCH ?
          ORDER BY rank
          LIMIT ?
        `;
        const ftsRows = db.prepare(ftsSql).all(ftsQuery, Math.max(limit * 4, 20)) as {
          id: number;
          score: number;
        }[];
        bm25Results = ftsRows;
      } catch {
        // FTS5 can throw on weird query syntax — graceful fallback
        bm25Results = [];
      }
    }
  }

  // ── RRF merge ──
  const merged = new Map<number, { 
    embeddingScore: number; 
    rawEmbeddingScore: number;
    recencyFactor: number;
    daysAgo: number;
    bm25Score: number; 
    rrfScore: number;
  }>();

  for (let rank = 0; rank < embeddingResults.length; rank++) {
    const r = embeddingResults[rank];
    merged.set(r.id, {
      embeddingScore: r.score,
      rawEmbeddingScore: r.rawScore,
      recencyFactor: r.recencyFactor,
      daysAgo: r.daysAgo,
      bm25Score: 0,
      rrfScore: 0.5 / (RRF_K + rank + 1),
    });
  }

  for (let rank = 0; rank < bm25Results.length; rank++) {
    const r = bm25Results[rank];
    const rrfScore = 0.5 / (RRF_K + rank + 1);
    if (merged.has(r.id)) {
      const existing = merged.get(r.id)!;
      existing.bm25Score = r.score;
      existing.rrfScore += rrfScore;
    } else {
      merged.set(r.id, {
        embeddingScore: 0,
        rawEmbeddingScore: 0,
        recencyFactor: 1,
        daysAgo: 0,
        bm25Score: r.score,
        rrfScore,
      });
    }
  }

  // Sort by RRF and take top results
  const sortedIds = [...merged.entries()]
    .sort((a, b) => b[1].rrfScore - a[1].rrfScore)
    .slice(0, limit);

  // Build lookup for chunk data
  const chunkMap = new Map<number, ChunkRow>();
  for (const row of rows) {
    chunkMap.set(row.id, row);
  }

  return sortedIds.map(([id, scores]) => {
    const chunk = chunkMap.get(id)!;
    return {
      id,
      sessionId: chunk.session_id,
      day: chunk.day,
      text: chunk.text,
      context: chunk.context,
      msgCount: chunk.msg_count,
      ...scores,
    };
  });
}

// ── Auto-Search ────────────────────────────────────────────

export interface AutoSearchResult {
  /** Formatted text to inject into system prompt (empty string if nothing relevant) */
  text: string;
  /** Trace data for the search step */
  trace: {
    query: string;
    original_query?: string;
    contextual_query?: string;
    contextualizer_duration_ms?: number;
    contextualizer_skipped?: string;
    duration_ms: number;
    results_found: number;
    results_injected: number;
    results: {
      id: number;
      session_id: string;
      day: string;
      context: string | null;
      rrf_score: number;
      embedding_score: number;
      raw_embedding_score: number;
      recency_factor: number;
      days_ago: number;
      bm25_score: number;
      text_preview: string;
    }[];
    skipped?: string;
  };
}

export interface AutoSearchOptions {
  /** Memory settings from resolved config */
  memory?: ResolvedMemorySettings;
  /** Raw incoming message, if query has been contextualized before search. */
  originalQuery?: string;
  /** LLM-generated contextual query used to build the embedded search text. */
  contextualQuery?: string;
  /** Time spent contextualizing the query, if applicable. */
  contextualizerDurationMs?: number;
  /** Reason contextualization was skipped/fell back, if applicable. */
  contextualizerSkipped?: string;
}

/**
 * Lightweight auto-search that runs before every response.
 * Embeds the user's message, searches the memory, and returns
 * formatted text to inject into the system prompt + trace data.
 * 
 * Returns empty text if:
 * - No embeddings exist yet
 * - Nothing scores above the threshold
 * - The query is too short/generic to be useful
 * 
 * Cost: ~200ms (one embedding call + SQLite queries)
 */
export async function autoSearchForContext(
  userMessage: string,
  options: AutoSearchOptions = {}
): Promise<AutoSearchResult> {
  const startTime = Date.now();
  const trimmed = userMessage.trim();

  // Use config values or fall back to defaults
  const limit = options.memory?.recalledMemoryLimit ?? DEFAULT_AUTO_SEARCH_LIMIT;
  const threshold = options.memory?.recalledMemoryThreshold ?? DEFAULT_AUTO_SEARCH_RRF_THRESHOLD;

  const makeResult = (text: string, results: AutoSearchResult["trace"]["results"], resultsFound: number, skipped?: string): AutoSearchResult => ({
    text,
    trace: {
      query: trimmed,
      original_query: options.originalQuery,
      contextual_query: options.contextualQuery,
      contextualizer_duration_ms: options.contextualizerDurationMs,
      contextualizer_skipped: options.contextualizerSkipped,
      duration_ms: Date.now() - startTime,
      results_found: resultsFound,
      results_injected: results.filter(r => text.length > 0).length,
      results,
      skipped,
    },
  });

  // Only skip if truly empty
  if (trimmed.length === 0) return makeResult("", [], 0, "empty query");

  try {
    const results = await searchMemory(trimmed, { limit });
    
    const traceResults = results.map(r => ({
      id: r.id,
      session_id: r.sessionId,
      day: r.day,
      context: r.context,
      rrf_score: r.rrfScore,
      embedding_score: r.embeddingScore,
      raw_embedding_score: r.rawEmbeddingScore,
      recency_factor: r.recencyFactor,
      days_ago: r.daysAgo,
      bm25_score: r.bm25Score,
      text_preview: r.text.slice(0, 200),
      full_text: r.text,
    }));

    if (results.length === 0) return makeResult("", traceResults, 0);

    // Filter by RRF threshold — only include genuinely relevant results
    const relevant = results.filter((r) => r.rrfScore >= threshold);
    if (relevant.length === 0) return makeResult("", traceResults, results.length);

    // Group by session, then sort each group by date (chronological within session)
    // Sessions themselves are sorted by their earliest chunk date
    const sessionGroups = new Map<string, typeof relevant>();
    for (const r of relevant) {
      const group = sessionGroups.get(r.sessionId) || [];
      group.push(r);
      sessionGroups.set(r.sessionId, group);
    }

    // Sort chunks within each session by date (chronological)
    for (const group of sessionGroups.values()) {
      group.sort((a, b) => new Date(a.day).getTime() - new Date(b.day).getTime());
    }

    // Sort sessions by their earliest chunk date
    const sortedSessions = [...sessionGroups.entries()].sort((a, b) => {
      const aEarliest = new Date(a[1][0].day).getTime();
      const bEarliest = new Date(b[1][0].day).getTime();
      return aEarliest - bEarliest;
    });

    // Format as recalled memories block — grouped by session, chronological
    // No memory numbers, and don't repeat session ID for consecutive chunks
    const chunks: string[] = [];
    let lastSessionId: string | null = null;
    
    for (const [sessionId, group] of sortedSessions) {
      for (const r of group) {
        // Only show session ID header if it's different from the previous chunk
        // Date is already in r.text, so don't duplicate it in the header
        if (sessionId !== lastSessionId) {
          chunks.push(`[${r.sessionId}]\n${r.text}`);
        } else {
          // Same session, just add the text (which has its own date header)
          chunks.push(r.text);
        }
        lastSessionId = sessionId;
      }
    }

    // Build injected results in the same grouped/sorted order
    const orderedRelevant = sortedSessions.flatMap(([_, group]) => group);
    const injectedResults = orderedRelevant.map(r => ({
      id: r.id,
      session_id: r.sessionId,
      day: r.day,
      context: r.context,
      rrf_score: r.rrfScore,
      embedding_score: r.embeddingScore,
      raw_embedding_score: r.rawEmbeddingScore,
      recency_factor: r.recencyFactor,
      days_ago: r.daysAgo,
      bm25_score: r.bm25Score,
      text_preview: r.text.slice(0, 200),
      full_text: r.text,
    }));

    return {
      text: chunks.join("\n\n---\n\n"),
      trace: {
        query: trimmed,
        original_query: options.originalQuery,
        contextual_query: options.contextualQuery,
        contextualizer_duration_ms: options.contextualizerDurationMs,
        contextualizer_skipped: options.contextualizerSkipped,
        duration_ms: Date.now() - startTime,
        results_found: results.length,
        results_injected: relevant.length,
        results: traceResults,
      },
    };
  } catch (err) {
    console.error("[Search] Auto-search failed:", err);
    return makeResult("", [], 0, `error: ${err instanceof Error ? err.message : String(err)}`);
  }
}
