import type { Context } from "../../context/Context.js";
import type { EmbedOptions, EmbeddingResult } from "./chunking.js";
import type { EmbeddingStats } from "../../stores/embeddings/EmbeddingStore.js";
import type {
  FactIngestOptions,
  FactIngestResult,
  FactSearchResult,
} from "../facts/FactService.js";

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
  dayFilter?: string;
  dayStart?: string;
  dayEnd?: string;
  referenceDay?: string;
  mode?: "hybrid" | "embedding" | "bm25";
}

export interface ProfileSearchResult {
  heading: string;
  text: string;
  score: number;
}

export interface MemoryRecallOptions {
  depth?: "quick" | "deep";
  currentOnly?: boolean;
  asOf?: string;
}

export interface MemoryRecallResult {
  profile: ProfileSearchResult[];
  facts: FactSearchResult[];
  transcripts: SearchResult[];
}

export interface MemoryAnswerCitation {
  provider: "profile" | "fact" | "transcript";
  id: string;
  label: string;
}

export interface MemoryAnswerResult {
  answer: string;
  citations: MemoryAnswerCitation[];
  recall: MemoryRecallResult;
  durationMs: number;
}

export interface MemoryIngestionOptions extends EmbedOptions {
  factExtractorModel?: FactIngestOptions["extractorModel"];
}

export interface MemoryIngestionResult {
  embedding: EmbeddingResult;
  facts: FactIngestResult;
}

export interface MemoryService {
  getProfile(x: Context): string | null;
  search(x: Context, query: string, options?: SearchOptions): Promise<SearchResult[]>;
  recall(x: Context, query: string, options?: MemoryRecallOptions): Promise<MemoryRecallResult>;
  answer(x: Context, query: string, options?: MemoryRecallOptions): Promise<MemoryAnswerResult>;
  maybeProcessNewMemory(
    x: Context,
    sessionId: string,
    options?: MemoryIngestionOptions,
  ): Promise<MemoryIngestionResult>;
  maybeEmbedNewChunks(
    x: Context,
    sessionId: string,
    options?: EmbedOptions,
  ): Promise<EmbeddingResult>;
  getStats(x: Context): EmbeddingStats;
}
