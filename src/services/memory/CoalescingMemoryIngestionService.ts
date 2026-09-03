import type { Context } from "../../context/Context.js";
import type { IngestionCandidate } from "./chunking.js";
import type { MemoryIngestionResult, MemoryIngestionService } from "./MemoryIngestionService.js";

const DEBOUNCE_MS = 25;

function candidateKey(candidate: IngestionCandidate): string {
  const first = candidate.messages[0]?.id ?? 0;
  const last = candidate.messages[candidate.messages.length - 1]?.id ?? 0;
  return `${candidate.sessionId}:${first}:${last}`;
}

function mergeResults(results: MemoryIngestionResult[]): MemoryIngestionResult {
  return {
    embedding: {
      ...(results.every((result) => result.embedding.skipped)
        ? { skipped: results.at(-1)?.embedding.skipped ?? "no_candidates" }
        : {}),
      chunks_created: results.reduce((sum, result) => sum + result.embedding.chunks_created, 0),
      chunks: results.flatMap((result) => result.embedding.chunks),
      unembedded_messages: results.reduce(
        (sum, result) => sum + result.embedding.unembedded_messages,
        0,
      ),
      unembedded_chars: results.reduce((sum, result) => sum + result.embedding.unembedded_chars, 0),
      duration_ms: results.reduce((sum, result) => sum + result.embedding.duration_ms, 0),
    },
    facts: {
      ...(results.every((result) => result.facts.skipped)
        ? { skipped: results.at(-1)?.facts.skipped ?? "no_candidates" }
        : {}),
      inserted: results.flatMap((result) => result.facts.inserted),
      supported: results.flatMap((result) => result.facts.supported),
      superseded: results.flatMap((result) => result.facts.superseded),
      rejected: results.flatMap((result) => result.facts.rejected),
      batchesProcessed: results.reduce((sum, result) => sum + result.facts.batchesProcessed, 0),
      messagesConsidered: results.reduce((sum, result) => sum + result.facts.messagesConsidered, 0),
      durationMs: results.reduce((sum, result) => sum + result.facts.durationMs, 0),
    },
  };
}

export class CoalescingMemoryIngestionService implements MemoryIngestionService {
  private readonly active = new Map<string, Promise<MemoryIngestionResult>>();
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly inner: MemoryIngestionService) {}

  ingestCandidates(x: Context, candidates: IngestionCandidate[]): Promise<MemoryIngestionResult> {
    if (candidates.length === 0) return this.inner.ingestCandidates(x, []);

    const promises: Promise<MemoryIngestionResult>[] = [];
    const pending: IngestionCandidate[] = [];
    for (const candidate of candidates) {
      const existing = this.active.get(candidateKey(candidate));
      if (existing) promises.push(existing);
      else pending.push(candidate);
    }

    if (pending.length > 0) {
      let resolveJob!: (result: MemoryIngestionResult) => void;
      let rejectJob!: (error: unknown) => void;
      const job = new Promise<MemoryIngestionResult>((resolve, reject) => {
        resolveJob = resolve;
        rejectJob = reject;
      });
      for (const candidate of pending) this.active.set(candidateKey(candidate), job);
      promises.push(job);

      const run = async () => {
        await new Promise((resolve) => setTimeout(resolve, DEBOUNCE_MS));
        return this.inner.ingestCandidates(x, pending);
      };
      const queued = this.tail.then(run, run);
      this.tail = queued.then(
        () => undefined,
        () => undefined,
      );
      void queued.then(resolveJob, rejectJob).finally(() => {
        for (const candidate of pending) {
          const key = candidateKey(candidate);
          if (this.active.get(key) === job) this.active.delete(key);
        }
      });
    }

    return Promise.all([...new Set(promises)]).then(mergeResults);
  }
}
