import type { Context } from "../../context/Context.js";
import type { ModelConfig } from "../../shared/schemas/vito-config.js";
import type {
  AtomicFact,
  FactAuthority,
  FactKind,
  FactStatus,
} from "../../stores/facts/FactStore.js";

export interface FactIngestOptions {
  force?: boolean;
  initialAfterMessageId?: number;
  extractorModel?: ModelConfig;
}

export interface FactIngestResult {
  skipped?: string;
  inserted: number[];
  supported: number[];
  superseded: number[];
  rejected: Array<{ canonicalText: string; reason: string }>;
  batchesProcessed: number;
  messagesConsidered: number;
  durationMs: number;
}

export interface FactSearchOptions {
  limit?: number;
  currentOnly?: boolean;
  asOf?: string;
  kinds?: FactKind[];
  authorities?: FactAuthority[];
  statuses?: FactStatus[];
}

export interface FactSearchResult {
  fact: AtomicFact;
  score: number;
  conflicts: AtomicFact[];
}

export interface FactService {
  ingestNew(x: Context, sessionId: string, options?: FactIngestOptions): Promise<FactIngestResult>;
  search(x: Context, query: string, options?: FactSearchOptions): Promise<FactSearchResult[]>;
  get(x: Context, factId: number): AtomicFact | null;
}

export class ProxyFactService implements FactService {
  constructor(protected readonly inner: FactService) {}

  ingestNew(x: Context, sessionId: string, options?: FactIngestOptions) {
    return this.inner.ingestNew(x, sessionId, options);
  }

  search(x: Context, query: string, options?: FactSearchOptions) {
    return this.inner.search(x, query, options);
  }

  get(x: Context, factId: number) {
    return this.inner.get(x, factId);
  }
}
