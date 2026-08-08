import type { Context } from "../../context/Context.js";
import {
  maybeEmbedNewChunksInContext,
  type EmbedOptions,
  type EmbeddingResult,
} from "../../memory/embeddings.js";
import {
  searchMemoryInContext,
  type SearchOptions,
  type SearchResult,
} from "../../memory/search.js";
import { xEmbeddingStore } from "../../lib/x.js";
import type { EmbeddingStats } from "../../stores/embeddings/EmbeddingStore.js";
import type { MemoryService } from "./MemoryService.js";

export class DefaultMemoryService implements MemoryService {
  private embeddingInProgress = false;

  search(
    x: Context,
    query: string,
    options: SearchOptions = {}
  ): Promise<SearchResult[]> {
    return searchMemoryInContext(x, query, options);
  }

  async maybeEmbedNewChunks(
    x: Context,
    sessionId: string,
    options: EmbedOptions = {}
  ): Promise<EmbeddingResult> {
    const start = Date.now();
    if (this.embeddingInProgress) {
      return {
        skipped: "lock_held",
        chunks_created: 0,
        chunks: [],
        unembedded_messages: 0,
        unembedded_chars: 0,
        duration_ms: Date.now() - start,
      };
    }

    this.embeddingInProgress = true;
    try {
      return await maybeEmbedNewChunksInContext(x, sessionId, options);
    } finally {
      this.embeddingInProgress = false;
    }
  }

  getStats(x: Context): EmbeddingStats {
    return xEmbeddingStore(x).getStats(x);
  }
}
