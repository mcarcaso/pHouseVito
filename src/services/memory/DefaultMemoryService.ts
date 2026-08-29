import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Context } from "../../context/Context.js";
import { embedNewChunks, type EmbedOptions, type EmbeddingResult } from "./chunking.js";
import { searchMemory } from "./hybrid-search.js";
import { getSearchTerms } from "./search-excerpt.js";
import { xEmbeddingStore, xFactService, xUserDir } from "../../lib/x.js";
import type { EmbeddingStats } from "../../stores/embeddings/EmbeddingStore.js";
import type {
  MemoryIngestionOptions,
  MemoryIngestionResult,
  MemoryRecallOptions,
  MemoryRecallResult,
  MemoryService,
  ProfileSearchResult,
  SearchOptions,
  SearchResult,
} from "./MemoryService.js";

export class DefaultMemoryService implements MemoryService {
  private embeddingInProgress = false;
  private ingestionInProgress = false;

  getProfile(x: Context): string | null {
    const profilePath = join(xUserDir(x), "profile.md");
    return existsSync(profilePath) ? readFileSync(profilePath, "utf-8") : null;
  }

  search(x: Context, query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    return searchMemory(x, query, options);
  }

  async recall(
    x: Context,
    query: string,
    options: MemoryRecallOptions = {},
  ): Promise<MemoryRecallResult> {
    const deep = options.depth === "deep";
    const currentOnly =
      options.currentOnly ??
      /\b(current|currently|latest|final|now|still|today|present)\b/i.test(query);
    const [facts, transcripts] = await Promise.all([
      xFactService(x).search(x, query, {
        limit: deep ? 20 : 8,
        currentOnly,
        asOf: options.asOf,
      }),
      this.search(x, query, {
        limit: deep ? 20 : 5,
        referenceDay: options.asOf,
      }),
    ]);
    return {
      profile: this.searchProfile(x, query, deep ? 5 : 3),
      facts,
      transcripts,
    };
  }

  private searchProfile(x: Context, query: string, limit: number): ProfileSearchResult[] {
    const profile = this.getProfile(x);
    if (!profile) return [];
    const terms = getSearchTerms(query);
    if (terms.length === 0) return [];
    const sections: Array<{ heading: string; text: string }> = [];
    let heading = "Profile";
    let lines: string[] = [];
    for (const line of profile.split("\n")) {
      if (/^#{1,6}\s+/.test(line)) {
        if (lines.some((value) => value.trim()))
          sections.push({ heading, text: lines.join("\n").trim() });
        heading = line.replace(/^#{1,6}\s+/, "").trim();
        lines = [];
      } else {
        lines.push(line);
      }
    }
    if (lines.some((value) => value.trim()))
      sections.push({ heading, text: lines.join("\n").trim() });
    return sections
      .map((section) => {
        const title = section.heading.toLocaleLowerCase();
        const body = section.text.toLocaleLowerCase();
        const score = terms.reduce(
          (sum, term) => sum + (title.includes(term) ? 3 : 0) + (body.includes(term) ? 1 : 0),
          0,
        );
        return { ...section, score };
      })
      .filter((section) => section.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  async maybeProcessNewMemory(
    x: Context,
    sessionId: string,
    options: MemoryIngestionOptions = {},
  ): Promise<MemoryIngestionResult> {
    if (this.ingestionInProgress) {
      const now = Date.now();
      return {
        embedding: {
          skipped: "lock_held",
          chunks_created: 0,
          chunks: [],
          unembedded_messages: 0,
          unembedded_chars: 0,
          duration_ms: 0,
        },
        facts: {
          skipped: "lock_held",
          inserted: [],
          supported: [],
          superseded: [],
          rejected: [],
          batchesProcessed: 0,
          messagesConsidered: 0,
          durationMs: Date.now() - now,
        },
      };
    }

    this.ingestionInProgress = true;
    try {
      // Capture this before the embedding branch advances its checkpoint. On
      // first deployment, facts start at the same unembedded boundary rather
      // than silently backfilling the entire historical database.
      const initialAfterMessageId = xEmbeddingStore(x).getLastEmbeddedMessageId(x, sessionId);
      // A successfully stored embedding chunk is the fact-extraction work
      // unit. Run sequentially so the fact branch sees chunks created above.
      const embedding = await this.maybeEmbedNewChunks(x, sessionId, options);
      const facts = await xFactService(x).ingestNew(x, sessionId, {
        initialAfterMessageId,
        extractorModel: options.factExtractorModel,
      });
      return { embedding, facts };
    } finally {
      this.ingestionInProgress = false;
    }
  }

  async maybeEmbedNewChunks(
    x: Context,
    sessionId: string,
    options: EmbedOptions = {},
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
