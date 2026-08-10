import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Context } from "../../context/Context.js";
import {
  embedNewChunks,
  type EmbedOptions,
  type EmbeddingResult,
} from "./chunking.js";
import {
  searchMemory,
  type SearchOptions,
  type SearchResult,
} from "./search.js";
import { xEmbeddingStore, xUserDir } from "../../lib/x.js";
import type { EmbeddingStats } from "../../stores/embeddings/EmbeddingStore.js";
import type { MemoryService } from "./MemoryService.js";

export class DefaultMemoryService implements MemoryService {
  private embeddingInProgress = false;

  getProfile(x: Context): string | null {
    const profilePath = join(xUserDir(x), "profile.md");
    return existsSync(profilePath) ? readFileSync(profilePath, "utf-8") : null;
  }

  search(
    x: Context,
    query: string,
    options: SearchOptions = {}
  ): Promise<SearchResult[]> {
    return searchMemory(x, query, options);
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
      return await embedNewChunks(x, sessionId, options);
    } finally {
      this.embeddingInProgress = false;
    }
  }

  getStats(x: Context): EmbeddingStats {
    return xEmbeddingStore(x).getStats(x);
  }
}
