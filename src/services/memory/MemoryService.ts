import type { Context } from "../../context/Context.js";
import type { EmbedOptions, EmbeddingResult } from "./chunking.js";
import type { EmbeddingStats } from "../../stores/embeddings/EmbeddingStore.js";

export interface SearchResult {
  id: number;
  sessionId: string;
  day: string;
  chunkIndex: number;
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

export interface SearchOptions {
  limit?: number;
  sessionFilter?: string;
  mode?: "hybrid" | "embedding" | "bm25";
}

export interface MemoryService {
  getProfile(x: Context): string | null;
  search(x: Context, query: string, options?: SearchOptions): Promise<SearchResult[]>;
  maybeEmbedNewChunks(
    x: Context,
    sessionId: string,
    options?: EmbedOptions
  ): Promise<EmbeddingResult>;
  getStats(x: Context): EmbeddingStats;
}
