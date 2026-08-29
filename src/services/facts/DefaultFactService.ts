import { createHash } from "node:crypto";
import type { Context } from "../../context/Context.js";
import { xFactExtractor, xFactStore, xMessageStore } from "../../lib/x.js";
import type { MessageRow } from "../../stores/messages/MessageStore.js";
import type {
  AtomicFact,
  FactAuthority,
  FactSource,
  FactStatus,
} from "../../stores/facts/FactStore.js";
import { getSearchTerms } from "../memory/search-excerpt.js";
import type { ExtractedFactCandidate, FactExtractionMessage } from "./FactExtractor.js";
import type {
  FactBackfillOptions,
  FactIngestOptions,
  FactIngestResult,
  FactSearchOptions,
  FactSearchResult,
  FactService,
} from "./FactService.js";

function emptyResult(start: number, skipped?: string): FactIngestResult {
  return {
    ...(skipped ? { skipped } : {}),
    inserted: [],
    supported: [],
    superseded: [],
    rejected: [],
    batchesProcessed: 0,
    messagesConsidered: 0,
    durationMs: Date.now() - start,
  };
}

function jsonText(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function toExtractionMessage(row: MessageRow): FactExtractionMessage | null {
  // Fact extraction operates on the conversational record only. Thoughts and
  // raw tool events are both noisy and potentially enormous; verified action
  // outcomes belong in a separate deterministic ingestion path.
  if (row.type !== "user" && row.type !== "assistant") return null;
  try {
    const content = JSON.parse(row.content) as unknown;
    if (typeof content === "string") {
      return {
        id: row.id,
        sessionId: row.session_id,
        timestamp: row.timestamp,
        type: row.type,
        author: row.author,
        text: content,
      };
    }
    const record =
      content && typeof content === "object" && !Array.isArray(content)
        ? (content as Record<string, unknown>)
        : {};
    let text = typeof record.text === "string" ? record.text : jsonText(content);
    if (Array.isArray(record.attachments)) {
      for (const attachment of record.attachments) {
        const item = attachment as Record<string, unknown>;
        const ref = item.path ?? item.filename ?? item.url ?? "(attachment)";
        text += `\n[Attachment: ${String(ref)}]`;
      }
    }
    return {
      id: row.id,
      sessionId: row.session_id,
      timestamp: row.timestamp,
      type: row.type,
      author: row.author,
      text,
    };
  } catch {
    return {
      id: row.id,
      sessionId: row.session_id,
      timestamp: row.timestamp,
      type: row.type,
      author: row.author,
      text: row.content,
    };
  }
}

function normalizeText(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/g, "");
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return typeof value === "string" ? normalizeText(value) : value;
}

function fingerprint(candidate: ExtractedFactCandidate): string {
  const identity = candidate.slotKey
    ? {
        kind: candidate.kind,
        slotKey: normalizeText(candidate.slotKey),
        canonicalValue: stableValue(candidate.canonicalValue),
        ...(candidate.status !== "active" ? { temporalStatus: candidate.status } : {}),
        ...(candidate.kind === "event" || candidate.kind === "measurement"
          ? { validFrom: candidate.validFrom }
          : {}),
      }
    : {
        kind: candidate.kind,
        canonicalText: normalizeText(candidate.canonicalText),
        validFrom: candidate.validFrom,
      };
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}

function authorityFor(messages: FactExtractionMessage[]): FactAuthority {
  // Explicit user evidence remains authoritative even when the extractor also
  // cites the assistant's final acknowledgement. Assistant-only claims remain
  // reports until a separate deterministic action-result path verifies them.
  if (messages.some((message) => message.type === "user")) return "user_explicit";
  return "assistant_reported";
}

function sourceDay(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function containsCredentialValue(value: string): boolean {
  return (
    /\bsk-[A-Za-z0-9_-]{16,}\b/.test(value) ||
    /\bBearer\s+[A-Za-z0-9._~+\/-]{12,}/i.test(value) ||
    /\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|secret)\s*[:=]\s*["']?[^\s"']{12,}/i.test(
      value,
    ) ||
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/.test(value)
  );
}

function validateCandidate(
  candidate: ExtractedFactCandidate,
  messageById: Map<number, FactExtractionMessage>,
): { sources: Array<Omit<FactSource, "id" | "factId">>; authority: FactAuthority } | string {
  if (candidate.slotKey && candidate.canonicalValue === null) {
    return "replaceable facts require a canonicalValue";
  }
  if (
    containsCredentialValue(candidate.canonicalText) ||
    containsCredentialValue(JSON.stringify(candidate.canonicalValue))
  ) {
    return "fact contains a credential-like value";
  }
  const sourceMessages: FactExtractionMessage[] = [];
  const sources: Array<Omit<FactSource, "id" | "factId">> = [];
  for (const source of candidate.sources) {
    const message = messageById.get(source.messageId);
    if (!message) return `source message ${source.messageId} is outside the batch`;
    if (!message.text.includes(source.quote)) {
      return `quote is not an exact substring of message ${source.messageId}`;
    }
    if (containsCredentialValue(source.quote)) {
      return `source quote ${source.messageId} contains a credential-like value`;
    }
    sourceMessages.push(message);
    sources.push({
      messageId: message.id,
      sessionId: message.sessionId,
      messageType: message.type,
      quote: source.quote,
      sourceTimestamp: message.timestamp,
    });
  }
  return { sources, authority: authorityFor(sourceMessages) };
}

function strongerStatus(status: FactStatus): boolean {
  return status === "active" || status === "disputed";
}

export class DefaultFactService implements FactService {
  private ingestionInProgress = false;

  async ingestNew(
    x: Context,
    sessionId: string,
    options: FactIngestOptions = {},
  ): Promise<FactIngestResult> {
    const extractor = xFactExtractor(x);
    const storedBoundary = xFactStore(x).cmd(x, {
      type: "get_checkpoint",
      sessionId,
      extractorVersion: extractor.version,
    }) as number | null;
    const boundary = storedBoundary ?? options.initialAfterMessageId ?? 0;
    if (storedBoundary === null) {
      xFactStore(x).cmd(x, {
        type: "set_checkpoint",
        sessionId,
        extractorVersion: extractor.version,
        messageId: boundary,
      });
    }
    return this.processAvailableChunks(x, {
      sessionId,
      afterMessageId: boundary,
      limit: options.limit ?? 20,
      extractorModel: options.extractorModel,
    });
  }

  async backfill(x: Context, options: FactBackfillOptions = {}): Promise<FactIngestResult> {
    return this.processAvailableChunks(x, {
      limit: options.limit ?? 25,
      extractorModel: options.extractorModel,
    });
  }

  private async processAvailableChunks(
    x: Context,
    options: {
      sessionId?: string;
      afterMessageId?: number;
      limit: number;
      extractorModel?: FactIngestOptions["extractorModel"];
    },
  ): Promise<FactIngestResult> {
    const start = Date.now();
    if (this.ingestionInProgress) return emptyResult(start, "lock_held");
    this.ingestionInProgress = true;
    const extractor = xFactExtractor(x);
    try {
      const chunks = xFactStore(x).listExtractionChunks(x, {
        extractorVersion: extractor.version,
        sessionId: options.sessionId,
        afterMessageId: options.afterMessageId,
        limit: options.limit,
      });
      if (chunks.length === 0) return emptyResult(start, "no_unprocessed_chunks");
      const result = emptyResult(start);
      for (const chunk of chunks) {
        xFactStore(x).cmd(x, {
          type: "begin_chunk",
          chunkId: chunk.id,
          extractorVersion: extractor.version,
        });
        try {
          const messages = xMessageStore(x)
            .list(x, {
              sessionIds: [chunk.sessionId],
              afterId: chunk.messageIdStart - 1,
              throughId: chunk.messageIdEnd,
              types: ["user", "assistant"],
              order: "oldest",
            })
            .map(toExtractionMessage)
            .filter((message): message is FactExtractionMessage => message !== null);
          result.messagesConsidered += messages.length;
          const candidates = await extractor.extract(
            x,
            {
              chunkId: chunk.id,
              contextualizedText: chunk.contextualizedText,
              context: chunk.context,
              messages,
            },
            { model: options.extractorModel },
          );
          const chunkResult = this.reconcileCandidates(x, candidates, messages);
          result.inserted.push(...chunkResult.inserted);
          result.supported.push(...chunkResult.supported);
          result.superseded.push(...chunkResult.superseded);
          result.rejected.push(...chunkResult.rejected);
          result.batchesProcessed += 1;
          xFactStore(x).cmd(x, {
            type: "complete_chunk",
            chunkId: chunk.id,
            extractorVersion: extractor.version,
            inserted: chunkResult.inserted.length,
            supported: chunkResult.supported.length,
            rejected: chunkResult.rejected.length,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          xFactStore(x).cmd(x, {
            type: "fail_chunk",
            chunkId: chunk.id,
            extractorVersion: extractor.version,
            error: message,
          });
          console.error(`[Facts] Chunk ${chunk.id} failed: ${message}`);
        }
      }
      result.durationMs = Date.now() - start;
      return result;
    } finally {
      this.ingestionInProgress = false;
    }
  }

  private reconcileCandidates(
    x: Context,
    candidates: ExtractedFactCandidate[],
    messages: FactExtractionMessage[],
  ): Pick<FactIngestResult, "inserted" | "supported" | "superseded" | "rejected"> {
    const result = {
      inserted: [] as number[],
      supported: [] as number[],
      superseded: [] as number[],
      rejected: [] as Array<{ canonicalText: string; reason: string }>,
    };
    const messageById = new Map(messages.map((message) => [message.id, message]));
    for (const candidate of candidates) {
      const validation = validateCandidate(candidate, messageById);
      if (typeof validation === "string") {
        result.rejected.push({ canonicalText: candidate.canonicalText, reason: validation });
        continue;
      }
      let candidateFingerprint = fingerprint(candidate);
      const observedAt = Math.max(...validation.sources.map((source) => source.sourceTimestamp));
      const activeInSlot = candidate.slotKey
        ? xFactStore(x).list(x, {
            slotKeys: [candidate.slotKey],
            statuses: ["active", "disputed"],
            order: "recent",
          })
        : [];
      const sameActiveValue = activeInSlot.find(
        (existing) =>
          JSON.stringify(stableValue(existing.canonicalValue)) ===
          JSON.stringify(stableValue(candidate.canonicalValue)),
      );
      const exactDuplicate = xFactStore(x).list(x, {
        fingerprints: [candidateFingerprint],
        limit: 1,
      })[0];
      const duplicate =
        candidate.status === "active" && candidate.slotKey ? sameActiveValue : exactDuplicate;
      if (duplicate) {
        xFactStore(x).cmd(x, {
          type: "add_sources",
          factId: duplicate.id,
          sources: validation.sources,
          authority: validation.authority,
          observedAt,
        });
        if (candidate.status === "disputed" && duplicate.status === "active") {
          xFactStore(x).update(x, { id: duplicate.id, changes: { status: "disputed" } });
        }
        result.supported.push(duplicate.id);
        continue;
      }
      if (exactDuplicate) {
        candidateFingerprint = createHash("sha256")
          .update(
            `${candidateFingerprint}:${observedAt}:${validation.sources
              .map((source) => source.messageId)
              .join(",")}`,
          )
          .digest("hex");
      }
      let supersedesFactId: number | null = null;
      const replaced: AtomicFact[] = [];
      if (candidate.slotKey && candidate.status === "active") {
        for (const existing of activeInSlot) {
          if (existing.observedAt <= observedAt && strongerStatus(existing.status))
            replaced.push(existing);
        }
        supersedesFactId = replaced[0]?.id ?? null;
      }
      const created = xFactStore(x).create(x, {
        fingerprint: candidateFingerprint,
        canonicalText: candidate.canonicalText,
        kind: candidate.kind,
        slotKey: candidate.slotKey,
        canonicalValue: candidate.canonicalValue,
        status: candidate.status,
        authority: validation.authority,
        validFrom: candidate.validFrom,
        validTo: candidate.validTo,
        observedAt,
        supersedesFactId,
        entities: [...new Set(candidate.entities.map((entity) => entity.trim()).filter(Boolean))],
        sources: validation.sources,
      });
      result.inserted.push(created.id);
      if (candidate.status === "active") {
        const replacementDay = candidate.validFrom ?? sourceDay(observedAt);
        for (const existing of replaced) {
          xFactStore(x).update(x, {
            id: existing.id,
            changes: { status: "superseded", validTo: replacementDay },
          });
          result.superseded.push(existing.id);
        }
      }
    }
    return result;
  }

  async search(
    x: Context,
    query: string,
    options: FactSearchOptions = {},
  ): Promise<FactSearchResult[]> {
    const limit = options.limit ?? 10;
    const statuses = options.currentOnly
      ? (["active", "disputed"] satisfies FactStatus[])
      : (options.statuses ?? ["active", "historical", "disputed"]);
    const terms = getSearchTerms(query);
    let scored: Array<{ fact: AtomicFact; score: number }> = [];
    if (terms.length > 0) {
      const ftsQuery = terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" OR ");
      try {
        scored = xFactStore(x).searchFts(x, { query: ftsQuery, limit: limit * 3, statuses });
      } catch {
        scored = [];
      }
    }
    if (scored.length === 0) {
      scored = xFactStore(x)
        .list(x, { statuses, order: "recent", limit: limit * 3 })
        .map((fact, index) => ({
          fact,
          score: 1 / (index + 1),
        }));
    }
    return scored
      .filter(({ fact }) => !options.kinds || options.kinds.includes(fact.kind))
      .filter(({ fact }) => !options.authorities || options.authorities.includes(fact.authority))
      .filter(({ fact }) => {
        if (!options.asOf) return true;
        return (
          (!fact.validFrom || fact.validFrom <= options.asOf) &&
          (!fact.validTo || fact.validTo >= options.asOf)
        );
      })
      .slice(0, limit)
      .map(({ fact, score }) => ({
        fact,
        score: Number.isFinite(score) ? score : 0,
        conflicts: fact.slotKey
          ? xFactStore(x)
              .list(x, { slotKeys: [fact.slotKey], statuses: ["disputed"], limit: 10 })
              .filter((candidate) => candidate.id !== fact.id)
          : [],
      }));
  }

  get(x: Context, factId: number): AtomicFact | null {
    return xFactStore(x).list(x, { ids: [factId], limit: 1 })[0] ?? null;
  }
}
