import type { Context } from "../../context/Context.js";
import type { EmbedOptions, EmbeddingResult } from "./chunking.js";
import type { SearchOptions, SearchResult } from "./search.js";
import type { EmbeddingStats } from "../../stores/embeddings/EmbeddingStore.js";

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
