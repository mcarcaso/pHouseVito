import type { Context } from "../../context/Context.js";
import type { FactIngestResult } from "../facts/FactService.js";
import type { EmbeddingResult, IngestionCandidate } from "./chunking.js";

export interface MemoryIngestionResult {
  embedding: EmbeddingResult;
  facts: FactIngestResult;
}

export interface MemoryIngestionService {
  ingestCandidates(x: Context, candidates: IngestionCandidate[]): Promise<MemoryIngestionResult>;
}
