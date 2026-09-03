import type { Context } from "../../context/Context.js";
import { xFactService, xSessionStore, xVitoService } from "../../lib/x.js";
import type { FactIngestResult } from "../facts/FactService.js";
import { getEffectiveSettings } from "../vito/settings.js";
import { embedIngestionCandidates, type IngestionCandidate } from "./chunking.js";
import type { MemoryIngestionResult, MemoryIngestionService } from "./MemoryIngestionService.js";

function emptyFacts(start: number, skipped = "no_embedded_candidates"): FactIngestResult {
  return {
    skipped,
    inserted: [],
    supported: [],
    superseded: [],
    rejected: [],
    batchesProcessed: 0,
    messagesConsidered: 0,
    durationMs: Date.now() - start,
  };
}

function mergeFacts(results: FactIngestResult[], start: number): FactIngestResult {
  if (results.length === 0) return emptyFacts(start);
  return {
    ...(results.every((result) => result.skipped)
      ? { skipped: results.at(-1)?.skipped ?? "no_unprocessed_chunks" }
      : {}),
    inserted: results.flatMap((result) => result.inserted),
    supported: results.flatMap((result) => result.supported),
    superseded: results.flatMap((result) => result.superseded),
    rejected: results.flatMap((result) => result.rejected),
    batchesProcessed: results.reduce((sum, result) => sum + result.batchesProcessed, 0),
    messagesConsidered: results.reduce((sum, result) => sum + result.messagesConsidered, 0),
    durationMs: Date.now() - start,
  };
}

export class DefaultMemoryIngestionService implements MemoryIngestionService {
  async ingestCandidates(
    x: Context,
    candidates: IngestionCandidate[],
  ): Promise<MemoryIngestionResult> {
    const start = Date.now();
    if (candidates.length === 0) {
      return {
        embedding: {
          skipped: "no_candidates",
          chunks_created: 0,
          chunks: [],
          unembedded_messages: 0,
          unembedded_chars: 0,
          duration_ms: 0,
        },
        facts: emptyFacts(start, "no_candidates"),
      };
    }

    const sessionIds = new Set(candidates.map((candidate) => candidate.sessionId));
    if (sessionIds.size !== 1) throw new Error("Ingestion candidates must belong to one session");
    const sessionId = candidates[0].sessionId;
    const session = xSessionStore(x).list(x, { ids: [sessionId] })[0];
    const settings = getEffectiveSettings(
      xVitoService(x).getConfig(x),
      session?.channel ?? undefined,
      sessionId,
    );
    const embedding = await embedIngestionCandidates(x, candidates, {
      contextualizerModel: settings.memory?.chunkContextualizerModel,
    });
    if (embedding.chunks_created === 0) return { embedding, facts: emptyFacts(start) };

    const initialAfterMessageId = Math.min(
      ...candidates.map((candidate) => candidate.initialAfterMessageId),
    );
    const factResults: FactIngestResult[] = [];
    for (let index = 0; index < embedding.chunks_created; index += 1) {
      factResults.push(
        await xFactService(x).ingestNew(x, sessionId, {
          initialAfterMessageId,
          extractorModel: settings.memory?.factExtractorModel,
        }),
      );
    }
    return { embedding, facts: mergeFacts(factResults, start) };
  }
}
