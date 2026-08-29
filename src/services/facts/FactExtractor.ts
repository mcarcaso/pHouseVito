import type { Context } from "../../context/Context.js";
import type { ModelConfig } from "../../shared/schemas/vito-config.js";
import type { FactKind, FactStatus } from "../../stores/facts/FactStore.js";

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
}

export interface FactExtractionInput {
  messages: FactExtractionMessage[];
}

export interface FactExtractorOptions {
  model?: ModelConfig;
}

export interface FactExtractor {
  readonly version: string;
  extract(
    x: Context,
    input: FactExtractionInput,
    options?: FactExtractorOptions,
  ): Promise<ExtractedFactCandidate[]>;
}

export class ProxyFactExtractor implements FactExtractor {
  constructor(protected readonly inner: FactExtractor) {}

  get version(): string {
    return this.inner.version;
  }

  extract(x: Context, input: FactExtractionInput, options?: FactExtractorOptions) {
    return this.inner.extract(x, input, options);
  }
}
