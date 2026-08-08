import type { Context } from "../../context/Context.js";
import type { EmbedOptions, EmbeddingResult } from "../../memory/embeddings.js";
import type { SearchOptions, SearchResult } from "../../memory/search.js";
import type { EmbeddingStats } from "../../stores/embeddings/EmbeddingStore.js";

export interface MemoryService {
  search(x: Context, query: string, options?: SearchOptions): Promise<SearchResult[]>;
  maybeEmbedNewChunks(
    x: Context,
    sessionId: string,
    options?: EmbedOptions
  ): Promise<EmbeddingResult>;
  getStats(x: Context): EmbeddingStats;
}
