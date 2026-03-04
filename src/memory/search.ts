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
import OpenAI from "openai";
import { readFileSync } from "fs";
import { join, resolve } from "path";

// ── Config ─────────────────────────────────────────────────

const ROOT = resolve(process.cwd());
const EMBEDDINGS_DB_PATH = join(ROOT, "user", "embeddings.db");
const EMBEDDING_MODEL = "openai/text-embedding-3-small";

// Auto-search settings
const AUTO_SEARCH_LIMIT = 3;           // Max chunks to inject
const AUTO_SEARCH_RRF_THRESHOLD = 0.005; // Minimum RRF score to include (filters noise)
const RRF_K = 60;                      // RRF constant

let openrouterApiKey: string | null = null;

function getOpenRouterKey(): string {
  if (!openrouterApiKey) {
    const secrets = JSON.parse(readFileSync(join(ROOT, "user", "secrets.json"), "utf-8"));
    openrouterApiKey = secrets.OPENROUTER_API_KEY;
  }
  return openrouterApiKey!;
}

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

// ── Embed Query ────────────────────────────────────────────

async function embedQuery(text: string): Promise<Float32Array> {
  const openai = new OpenAI({ 
    apiKey: getOpenRouterKey(),
    baseURL: "https://openrouter.ai/api/v1",
  });
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });
  return new Float32Array(response.data[0].embedding);
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

interface SearchResult {
  id: number;
  sessionId: string;
  day: string;
  text: string;
  context: string | null;
  msgCount: number;
  embeddingScore: number;
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

  // ── Embedding search ──
  let embeddingResults: { id: number; score: number }[] = [];
  if (mode === "hybrid" || mode === "embedding") {
    const queryVector = await embedQuery(query);
    embeddingResults = rows.map((row) => {
      const vector = new Float32Array(
        row.vector.buffer,
        row.vector.byteOffset,
        row.vector.byteLength / 4
      );
      return { id: row.id, score: cosineSimilarity(queryVector, vector) };
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
  const merged = new Map<number, { embeddingScore: number; bm25Score: number; rrfScore: number }>();

  for (let rank = 0; rank < embeddingResults.length; rank++) {
    const r = embeddingResults[rank];
    merged.set(r.id, {
      embeddingScore: r.score,
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
      bm25_score: number;
      text_preview: string;
    }[];
    skipped?: string;
  };
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
export async function autoSearchForContext(userMessage: string): Promise<AutoSearchResult> {
  const startTime = Date.now();
  const trimmed = userMessage.trim();

  const makeResult = (text: string, results: AutoSearchResult["trace"]["results"], resultsFound: number, skipped?: string): AutoSearchResult => ({
    text,
    trace: {
      query: trimmed,
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
    const results = await searchMemory(trimmed, { limit: AUTO_SEARCH_LIMIT });
    
    const traceResults = results.map(r => ({
      id: r.id,
      session_id: r.sessionId,
      day: r.day,
      context: r.context,
      rrf_score: r.rrfScore,
      embedding_score: r.embeddingScore,
      bm25_score: r.bm25Score,
      text_preview: r.text.slice(0, 200),
    }));

    if (results.length === 0) return makeResult("", traceResults, 0);

    // Filter by RRF threshold — only include genuinely relevant results
    const relevant = results.filter((r) => r.rrfScore >= AUTO_SEARCH_RRF_THRESHOLD);
    if (relevant.length === 0) return makeResult("", traceResults, results.length);

    // Format as recalled memories block
    const chunks = relevant.map((r, i) => {
      const header = `[Memory #${i + 1} — ${r.day} | ${r.sessionId}]`;
      const contextLine = r.context ? `Context: ${r.context}` : "";
      return [header, contextLine, r.text].filter(Boolean).join("\n");
    });

    const injectedResults = relevant.map(r => ({
      id: r.id,
      session_id: r.sessionId,
      day: r.day,
      context: r.context,
      rrf_score: r.rrfScore,
      embedding_score: r.embeddingScore,
      bm25_score: r.bm25Score,
      text_preview: r.text.slice(0, 200),
    }));

    return {
      text: chunks.join("\n\n---\n\n"),
      trace: {
        query: trimmed,
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
