# Atomic Fact Memory

Vito's durable recall uses three independent evidence lanes:

1. `user/profile.md` for curated identity, policy, preferences, and durable current state
2. SQLite atomic facts for consolidated claims with validity and supersession
3. Raw transcript chunks for authoritative evidence and episodic context

Raw messages remain authoritative. Atomic facts are derived, replaceable, and rebuildable.

## Ingestion

`EmbeddingMessageStore` decorates the raw SQLite message store. After a finalized assistant message, its private candidate selector reads the embedding checkpoint, groups pending conversational messages into the existing 2–4K-character windows, and does nothing until a complete candidate exists. Voice-session finalization and `/new` archiving force the otherwise undersized remainder through the same path.

Candidates are submitted without awaiting through the focused `MemoryIngestionService.ingestCandidates()` contract. `CoalescingMemoryIngestionService` deduplicates and serializes background work; errors are caught at the persistence boundary and incomplete candidates remain eligible for a later retry. `DefaultMemoryIngestionService` contextualizes and embeds each supplied candidate before invoking atomic-fact extraction and reconciliation.

The successfully stored contextualized embedding chunk is the fact-extraction work unit. Luna receives the same `context + text` payload used for embedding plus typed raw-message mappings. Thoughts, `tool_start`, and raw `tool_end` payloads are excluded by the candidate selector. The generated context may guide interpretation but can never serve as evidence. Per-chunk, per-extractor-version run records provide independent retries and idempotency.

Live ingestion and historical backfill use the same sequential unit of work: take the earliest pending chunk, extract its candidates, and process each candidate completely before moving on. Candidate processing is deterministic validation → deterministic admission filters → exact/semantic retrieval of related canonical facts → one Luna reconciliation decision → one transactional persistence operation → canonical embedding. Historical catch-up remains an explicit resumable operation. Extraction and reconciliation default to `openai-codex/gpt-5.6-luna` through Pi authentication and share `settings.memory.factExtractorModel`. Retrieved conversation content is explicitly treated as untrusted quoted data.

## Provenance

Every extracted fact must cite one or more source messages. Persistence rejects a source unless:

- The message belongs to the extraction batch
- The quoted evidence is an exact substring of the raw message text
- The candidate validates against the typed schema
- Replaceable slots include a canonical value

Authority is derived from cited source types rather than trusted from model output:

- `user_explicit`
- `assistant_reported`
- `tool_verified` is reserved for a future deterministic action-result ingestion path

Raw tool output is never sent to the fact-extraction model. Assistant recommendations remain recommendations and do not become user decisions.

## Semantic reconciliation and temporal handling

Each valid candidate retrieves related facts through exact slot/fingerprint lookup and hybrid semantic/lexical search. Luna then chooses one action:

- `create`: persist a distinct memory-worthy fact
- `duplicate`: attach exact evidence to one existing canonical fact
- `update`: create a changed current value and supersede its prior target
- `conflict`: preserve incompatible unresolved claims as disputed
- `merge`: create one canonical consolidation and supersede the fragments
- `discard`: reject low-value, transient, or redundant material

Obvious market-price telemetry, betting-balance telemetry, transient operational slots, and unadopted assistant recommendations are rejected deterministically before Luna. One-time events are normalized to historical status. A deterministic A → B → A guard prevents a returned value from being attached to its superseded earlier occurrence instead of replacing current B.

The fact mutation, status changes, evidence, and `fact_ingestion_decisions` audit row are written in one SQLite transaction. The resulting canonical fact is embedded before the next candidate is reconciled. Fact-set-prefixed SHA-256 fingerprints provide idempotency without colliding across versioned sets. Invalid or invented evidence quotes are rejected before retrieval or reconciliation.

Facts are never physically deleted through `FactStore`.

## Retrieval

```bash
./vito memory facts "query" [--current] [--as-of YYYY-MM-DD]
./vito memory recall "query" [--deep] [--current] [--as-of YYYY-MM-DD]
./vito memory backfill-facts --all [--max-chunks N]
```

`memory recall` queries relevant profile sections, atomic facts, and transcript search together. Facts have both FTS/entity/slot indexing and semantic vectors. The Expo companion's Memory workspace exposes separate Answer, Facts, and Transcripts pages; Answer uses Luna to synthesize profile, fact, and transcript evidence with structurally validated citations. The `memory-recall` and `fact-memory-search` skills document agent usage and evidence policy.

## Current limitations

- Explicit retraction without a replacement value needs a richer reconciliation operation.
- Historical backfill is explicit and resumable; it is never started automatically.
- Generated recall answers are produced by the calling agent and are not persisted as truth.
