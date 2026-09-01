import type { Context } from "../../context/Context.js";
import type { ModelConfig } from "../../shared/schemas/vito-config.js";
import type {
  AtomicFact,
  FactAuthority,
  FactKind,
  FactStatus,
} from "../../stores/facts/FactStore.js";

export interface FactExtractionMessage {
  id: number;
  sessionId: string;
  timestamp: number;
  type: "user" | "assistant";
  author: string | null;
  text: string;
}

export interface ExtractedFactSource {
  messageId: number;
  quote: string;
}

export interface FactAdmissionAssessment {
  futureQuestion: string;
  valueClass: "durable_current" | "meaningful_historical";
  whyWorthKeeping: string;
  whyNotNoise: string;
  evidenceMap: Array<{ claim: string; messageIds: number[] }>;
}

export interface ExtractedFactCandidate {
  canonicalText: string;
  kind: FactKind;
  slotKey: string | null;
  canonicalValue: unknown;
  status: Extract<FactStatus, "active" | "historical" | "disputed">;
  validFrom: string | null;
  validTo: string | null;
  entities: string[];
  sources: ExtractedFactSource[];
  admission?: FactAdmissionAssessment;
}

export interface FactExtractionInput {
  chunkId: number;
  contextualizedText: string;
  context: string | null;
  messages: FactExtractionMessage[];
}

export interface FactExtractorOptions {
  model?: ModelConfig;
}

export type FactReconciliationAction =
  "create" | "duplicate" | "update" | "conflict" | "merge" | "discard";

export interface FactReconciliationInput {
  candidate: ExtractedFactCandidate;
  authority: FactAuthority;
  observedAt: number;
  relatedFacts: AtomicFact[];
}

export interface FactReconciliationDecision {
  action: FactReconciliationAction;
  targetIds: number[];
  canonicalText: string | null;
  kind: FactKind | null;
  slotKey: string | null;
  canonicalValue: unknown;
  status: Extract<FactStatus, "active" | "historical" | "disputed"> | null;
  reason: string;
}

export interface FactExtractor {
  readonly version: string;
  readonly factSetId?: string;
  extract(
    x: Context,
    input: FactExtractionInput,
    options?: FactExtractorOptions,
  ): Promise<ExtractedFactCandidate[]>;
  reconcile(
    x: Context,
    input: FactReconciliationInput,
    options?: FactExtractorOptions,
  ): Promise<FactReconciliationDecision>;
}

export class ProxyFactExtractor implements FactExtractor {
  constructor(protected readonly inner: FactExtractor) {}

  get version(): string {
    return this.inner.version;
  }

  get factSetId(): string | undefined {
    return this.inner.factSetId;
  }

  extract(x: Context, input: FactExtractionInput, options?: FactExtractorOptions) {
    return this.inner.extract(x, input, options);
  }

  reconcile(x: Context, input: FactReconciliationInput, options?: FactExtractorOptions) {
    return this.inner.reconcile(x, input, options);
  }
}
