import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Context } from "../../context/Context.js";
import {
  xEmbeddingService,
  xFactExtractor,
  xFactStore,
  xMessageStore,
  xUserDir,
} from "../../lib/x.js";
import type { MessageRow } from "../../stores/messages/MessageStore.js";
import type {
  ApplyFactReconciliationResult,
  AtomicFact,
  FactAuthority,
  FactSource,
  FactStatus,
} from "../../stores/facts/FactStore.js";
import { getSearchTerms } from "../memory/search-excerpt.js";
import type {
  ExtractedFactCandidate,
  FactExtractionMessage,
  FactReconciliationDecision,
} from "./FactExtractor.js";
import { deterministicFactRejection } from "./fact-memory-policy.js";
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

function activeFingerprint(x: Context, candidate: ExtractedFactCandidate): string {
  const factSetId = xFactStore(x).cmd(x, { type: "get_active_set" }) as string;
  return `${factSetId}:${fingerprint(candidate)}`;
}

function isMikeAuthor(author: string | null): boolean {
  if (author === null) return true;
  return /^(?:mcarcaso|mike(?:\s+carcasole)?)$/i.test(author.trim());
}

function authorityFor(messages: FactExtractionMessage[]): FactAuthority {
  // Explicit user evidence remains authoritative even when the extractor also
  // cites the assistant's final acknowledgement. Assistant-only claims remain
  // reports until a separate deterministic action-result path verifies them.
  if (messages.some((message) => message.type === "user")) return "user_explicit";
  return "assistant_reported";
}

function authorityRank(value: FactAuthority): number {
  return value === "tool_verified" ? 2 : value === "user_explicit" ? 1 : 0;
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
  if (candidate.slotKey && !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(candidate.slotKey)) {
    return "slotKey must be stable lowercase namespaced text";
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
  if (
    /\bMike(?:'s|’s)?\b/i.test(candidate.canonicalText) &&
    sourceMessages.some((message) => message.type === "user") &&
    !sourceMessages.some((message) => message.type === "user" && isMikeAuthor(message.author))
  ) {
    return "a different participant's user message cannot be attributed to Mike";
  }
  if (candidate.admission) {
    const sourceIds = new Set(sources.map((source) => source.messageId));
    if (
      candidate.admission.evidenceMap.some(
        (mapping) =>
          mapping.messageIds.length === 0 || mapping.messageIds.some((id) => !sourceIds.has(id)),
      )
    ) {
      return "admission evidence-map IDs must all be submitted exact sources";
    }
    if (candidate.admission.valueClass === "durable_current" && candidate.status === "historical")
      return "durable_current admission cannot use historical status";
    if (candidate.admission.valueClass === "meaningful_historical" && candidate.status === "active")
      return "meaningful_historical admission cannot use active status";
  }
  return { sources, authority: authorityFor(sourceMessages) };
}

function historicalBackfillRunning(x: Context): boolean {
  const path = join(xUserDir(x), "logs", "fact-backfill-active.pid");
  if (!existsSync(path)) return false;
  const pid = Number(readFileSync(path, "utf-8").trim());
  if (Number.isInteger(pid) && pid > 0) {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      // Stale process marker; clean it up below.
    }
  }
  rmSync(path, { force: true });
  return false;
}

function normalizeReconciliationDecision(
  candidate: ExtractedFactCandidate,
  decision: FactReconciliationDecision,
  relatedFacts: AtomicFact[],
): FactReconciliationDecision {
  const requiresTarget = ["duplicate", "update", "conflict", "merge"].includes(decision.action);
  if (requiresTarget !== decision.targetIds.length > 0)
    throw new Error(`Invalid target count for reconciliation action ${decision.action}`);
  if (decision.action === "duplicate" && decision.targetIds.length !== 1)
    throw new Error("Duplicate reconciliation requires exactly one target");
  if (decision.action === "duplicate" && candidate.status === "active" && candidate.slotKey) {
    const duplicate = relatedFacts.find((fact) => fact.id === decision.targetIds[0]);
    const current = relatedFacts.find(
      (fact) =>
        fact.slotKey === candidate.slotKey &&
        (fact.status === "active" || fact.status === "disputed"),
    );
    if (duplicate?.status === "superseded" && current)
      return {
        ...decision,
        action: "update",
        targetIds: [current.id],
        canonicalText: decision.canonicalText ?? candidate.canonicalText,
        kind: decision.kind ?? candidate.kind,
        slotKey: decision.slotKey ?? candidate.slotKey,
        canonicalValue: decision.canonicalValue ?? candidate.canonicalValue,
        status: "active",
        reason: `${decision.reason} A superseded prior value cannot support the current A→B→A state; update the current value instead.`,
      };
  }
  if (decision.action === "discard" || decision.action === "duplicate") return decision;
  const kind = decision.kind ?? candidate.kind;
  if (decision.action === "conflict") return { ...decision, status: "disputed" };
  if (kind === "event") return { ...decision, status: "historical" };
  if (["identity", "relationship", "preference"].includes(kind))
    return { ...decision, status: "active" };
  if (decision.action === "update") return { ...decision, status: decision.status ?? "active" };
  return { ...decision, status: decision.status ?? candidate.status };
}

function reconciliationCandidate(
  candidate: ExtractedFactCandidate,
  decision: FactReconciliationDecision,
): ExtractedFactCandidate {
  return {
    canonicalText: decision.canonicalText ?? candidate.canonicalText,
    kind: decision.kind ?? candidate.kind,
    slotKey: decision.slotKey ?? candidate.slotKey,
    canonicalValue: decision.canonicalValue ?? candidate.canonicalValue,
    status: decision.status ?? candidate.status,
    validFrom: candidate.validFrom,
    validTo: candidate.validTo,
    entities: candidate.entities,
    sources: candidate.sources,
  };
}

function uniqueSources(
  sources: Array<Omit<FactSource, "id" | "factId">>,
): Array<Omit<FactSource, "id" | "factId">> {
  return [
    ...new Map(
      sources.map((source) => [`${source.messageId}:${source.quote}`, source] as const),
    ).values(),
  ];
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }
  return normA > 0 && normB > 0 ? dot / Math.sqrt(normA * normB) : 0;
}

export class DefaultFactService implements FactService {
  private ingestionInProgress = false;

  async ingestNew(
    x: Context,
    sessionId: string,
    options: FactIngestOptions = {},
  ): Promise<FactIngestResult> {
    const start = Date.now();
    if (historicalBackfillRunning(x)) return emptyResult(start, "historical_backfill_active");
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
    return this.processNextChunk(x, {
      sessionId,
      afterMessageId: boundary,
      extractorModel: options.extractorModel,
    });
  }

  async backfill(x: Context, options: FactBackfillOptions = {}): Promise<FactIngestResult> {
    return this.processNextChunk(x, { extractorModel: options.extractorModel });
  }

  private async processNextChunk(
    x: Context,
    options: {
      sessionId?: string;
      afterMessageId?: number;
      extractorModel?: FactIngestOptions["extractorModel"];
    },
  ): Promise<FactIngestResult> {
    const start = Date.now();
    if (this.ingestionInProgress) return emptyResult(start, "lock_held");
    this.ingestionInProgress = true;
    const extractor = xFactExtractor(x);
    try {
      const activeFactSetId = xFactStore(x).cmd(x, { type: "get_active_set" }) as string;
      if (extractor.factSetId && extractor.factSetId !== activeFactSetId)
        return emptyResult(start, "target_fact_set_inactive");
      const chunk = xFactStore(x).listExtractionChunks(x, {
        extractorVersion: extractor.version,
        sessionId: options.sessionId,
        afterMessageId: options.afterMessageId,
        limit: 1,
      })[0];
      if (!chunk) return emptyResult(start, "no_unprocessed_chunks");
      const result = emptyResult(start);
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
        result.messagesConsidered = messages.length;
        const chunkResult = await this.reconcileCandidates(
          x,
          chunk.id,
          candidates,
          messages,
          options.extractorModel,
        );
        result.inserted.push(...chunkResult.inserted);
        result.supported.push(...chunkResult.supported);
        result.superseded.push(...chunkResult.superseded);
        result.rejected.push(...chunkResult.rejected);
        result.batchesProcessed = 1;
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
      try {
        await this.embedMissing(x, 200);
      } catch (error) {
        console.error("[Facts] Failed to embed extracted facts:", error);
      }
      result.durationMs = Date.now() - start;
      return result;
    } finally {
      this.ingestionInProgress = false;
    }
  }

  private async reconcileCandidates(
    x: Context,
    chunkId: number,
    candidates: ExtractedFactCandidate[],
    messages: FactExtractionMessage[],
    model?: FactIngestOptions["extractorModel"],
  ): Promise<Pick<FactIngestResult, "inserted" | "supported" | "superseded" | "rejected">> {
    const result = {
      inserted: [] as number[],
      supported: [] as number[],
      superseded: [] as number[],
      rejected: [] as Array<{ canonicalText: string; reason: string }>,
    };
    const extractor = xFactExtractor(x);
    const messageById = new Map(messages.map((message) => [message.id, message]));
    for (const candidate of candidates) {
      const validation = validateCandidate(candidate, messageById);
      if (typeof validation === "string") {
        result.rejected.push({ canonicalText: candidate.canonicalText, reason: validation });
        continue;
      }
      const observedAt = Math.max(...validation.sources.map((source) => source.sourceTimestamp));
      const deterministicReason = deterministicFactRejection(candidate, validation.authority);
      if (deterministicReason) {
        xFactStore(x).cmd(x, {
          type: "apply_reconciliation",
          chunkId,
          action: "discard",
          targetIds: [],
          candidateText: candidate.canonicalText,
          reason: `Deterministic policy: ${deterministicReason}.`,
        });
        result.rejected.push({
          canonicalText: candidate.canonicalText,
          reason: deterministicReason,
        });
        continue;
      }
      const related = await this.relatedFacts(x, candidate);
      const decision = normalizeReconciliationDecision(
        candidate,
        await extractor.reconcile(
          x,
          { candidate, authority: validation.authority, observedAt, relatedFacts: related },
          { model },
        ),
        related,
      );
      if (decision.action === "discard") {
        xFactStore(x).cmd(x, {
          type: "apply_reconciliation",
          chunkId,
          action: "discard",
          targetIds: [],
          candidateText: candidate.canonicalText,
          reason: decision.reason,
        });
        result.rejected.push({ canonicalText: candidate.canonicalText, reason: decision.reason });
        continue;
      }
      const targetById = new Map(related.map((fact) => [fact.id, fact]));
      const targets = decision.targetIds
        .map((id) => targetById.get(id))
        .filter((fact): fact is AtomicFact => !!fact);
      if (targets.length !== new Set(decision.targetIds).size)
        throw new Error("Fact reconciler selected an unavailable target");
      const reconciled = reconciliationCandidate(candidate, decision);
      const mergedSources =
        decision.action === "merge"
          ? [
              ...validation.sources,
              ...targets.flatMap((fact) =>
                fact.sources
                  .filter((source) => source.messageType !== "tool_end")
                  .map(({ id: _id, factId: _factId, ...source }) => source),
              ),
            ]
          : validation.sources;
      const authority =
        decision.action === "merge"
          ? [validation.authority, ...targets.map((fact) => fact.authority)].sort(
              (left, right) => authorityRank(right) - authorityRank(left),
            )[0]
          : validation.authority;
      let candidateFingerprint = activeFingerprint(x, reconciled);
      if (xFactStore(x).list(x, { fingerprints: [candidateFingerprint], limit: 1 }).length > 0)
        candidateFingerprint = createHash("sha256")
          .update(`${candidateFingerprint}:${observedAt}:${decision.targetIds.join(",")}`)
          .digest("hex");
      const applied = xFactStore(x).cmd(x, {
        type: "apply_reconciliation",
        chunkId,
        action: decision.action,
        targetIds: decision.targetIds,
        candidateText: candidate.canonicalText,
        reason: decision.reason,
        fact: {
          fingerprint: candidateFingerprint,
          canonicalText: reconciled.canonicalText,
          kind: reconciled.kind,
          slotKey: reconciled.slotKey,
          canonicalValue: reconciled.canonicalValue,
          status: reconciled.status,
          authority,
          validFrom: reconciled.validFrom,
          validTo: reconciled.validTo,
          observedAt: Math.max(observedAt, ...targets.map((fact) => fact.observedAt)),
          supersedesFactId: null,
          entities: [
            ...new Set([
              ...reconciled.entities.map((entity) => entity.trim()).filter(Boolean),
              ...(decision.action === "merge" ? targets.flatMap((fact) => fact.entities) : []),
            ]),
          ],
          sources: uniqueSources(mergedSources),
        },
      }) as ApplyFactReconciliationResult;
      result.supported.push(...applied.supportedIds);
      result.superseded.push(...applied.supersededIds);
      if (applied.created) {
        result.inserted.push(applied.created.id);
        await this.embedFact(x, applied.created);
      }
    }
    return result;
  }

  private async relatedFacts(x: Context, candidate: ExtractedFactCandidate): Promise<AtomicFact[]> {
    const ranked = (
      await this.search(x, candidate.canonicalText, {
        limit: 12,
        currentOnly: false,
      })
    ).map((result) => result.fact);
    const exactSlot = candidate.slotKey
      ? xFactStore(x).list(x, { slotKeys: [candidate.slotKey], order: "recent", limit: 12 })
      : [];
    const exactFingerprint = xFactStore(x).list(x, {
      fingerprints: [activeFingerprint(x, candidate)],
      limit: 1,
    });
    return [
      ...new Map(
        [...exactSlot, ...exactFingerprint, ...ranked].map((fact) => [fact.id, fact]),
      ).values(),
    ].slice(0, 12);
  }

  private async embedFact(x: Context, fact: AtomicFact): Promise<void> {
    const text = [fact.canonicalText, fact.slotKey, ...fact.entities].filter(Boolean).join("\n");
    const vector = await xEmbeddingService(x).create(x, text);
    xFactStore(x).putFactEmbeddings(x, [{ factId: fact.id, vector }]);
  }

  async embedMissing(x: Context, limit = 200): Promise<number> {
    const facts = xFactStore(x).listFactsMissingEmbeddings(x, limit);
    if (facts.length === 0) return 0;
    const service = xEmbeddingService(x);
    const texts = facts.map((fact) =>
      [fact.canonicalText, fact.slotKey, ...fact.entities].filter(Boolean).join("\n"),
    );
    const vectors = service.createMany
      ? await service.createMany(x, texts)
      : await Promise.all(texts.map((text) => service.create(x, text)));
    xFactStore(x).putFactEmbeddings(
      x,
      facts.map((fact, index) => ({ factId: fact.id, vector: vectors[index] })),
    );
    return facts.length;
  }

  async search(
    x: Context,
    query: string,
    options: FactSearchOptions = {},
  ): Promise<FactSearchResult[]> {
    const limit = options.limit ?? 10;
    const statuses = options.currentOnly
      ? (["active", "disputed"] satisfies FactStatus[])
      : (options.statuses ?? ["active", "historical", "disputed", "superseded"]);
    const terms = getSearchTerms(query);
    let lexical: Array<{ fact: AtomicFact; score: number }> = [];
    if (terms.length > 0) {
      const ftsQuery = terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" OR ");
      try {
        lexical = xFactStore(x).searchFts(x, { query: ftsQuery, limit: limit * 5, statuses });
      } catch {
        lexical = [];
      }
    }

    let semantic: AtomicFact[] = [];
    try {
      const queryVector = await xEmbeddingService(x).create(x, query);
      const rankedIds = xFactStore(x)
        .listFactVectors(x)
        .map((item) => ({ factId: item.factId, score: cosineSimilarity(queryVector, item.vector) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit * 10)
        .map((item) => item.factId);
      const byId = new Map(
        xFactStore(x)
          .list(x, { ids: rankedIds })
          .map((fact) => [fact.id, fact]),
      );
      semantic = rankedIds.map((id) => byId.get(id)).filter((fact): fact is AtomicFact => !!fact);
    } catch (error) {
      console.error("[Facts] Semantic search unavailable, using lexical search:", error);
    }

    const byId = new Map<number, { fact: AtomicFact; score: number }>();
    const addRanked = (facts: AtomicFact[]) => {
      facts.forEach((fact, index) => {
        const item = byId.get(fact.id) ?? { fact, score: 0 };
        item.score += 1 / (60 + index + 1);
        byId.set(fact.id, item);
      });
    };
    addRanked(lexical.map((item) => item.fact));
    addRanked(semantic);
    let scored = [...byId.values()].sort((a, b) => b.score - a.score);
    if (scored.length === 0) {
      scored = xFactStore(x)
        .list(x, { statuses, order: "recent", limit: limit * 3 })
        .map((fact, index) => ({ fact, score: 1 / (index + 1) }));
    }
    return scored
      .filter(({ fact }) => statuses.includes(fact.status))
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
