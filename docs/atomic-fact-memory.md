# Atomic Fact Memory

Vito's durable recall uses three independent evidence lanes:

1. `user/profile.md` for curated identity, policy, preferences, and durable current state
2. SQLite atomic facts for consolidated claims with validity and supersession
3. Raw transcript chunks for authoritative evidence and episodic context

Raw messages remain authoritative. Atomic facts are derived, replaceable, and rebuildable.

## Ingestion

`MemoryService.maybeProcessNewMemory()` runs after a completed agent turn. It captures the current transcript checkpoint and starts two independent branches:

- Transcript chunk contextualization and embedding
- Atomic-fact extraction and reconciliation

The successfully stored contextualized embedding chunk is the fact-extraction work unit. Luna receives the same `context + text` payload used for embedding plus typed raw-message mappings. Thoughts, `tool_start`, and raw `tool_end` payloads are excluded by the transcript chunker. The generated context may guide interpretation but can never serve as evidence. Per-chunk, per-extractor-version run records provide independent retries and idempotency.

Fact extraction defaults to `openai-codex/gpt-5.6-luna` through Pi authentication. It can be overridden with `settings.memory.factExtractorModel`. Retrieved conversation content is explicitly treated as untrusted quoted data.

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

## Duplicate and temporal handling

A deterministic SHA-256 fingerprint is built from the fact kind, normalized slot, stable canonical value, and temporal identity where appropriate.

- Repeated active slot/value: add evidence to the existing fact
- Repeated event: add evidence to the existing event
- Changed active slot/value: insert a new fact and supersede the prior active value
- Value returns later (A → B → A): create a new occurrence and preserve both earlier validity intervals
- Invalid or invented evidence quote: reject the candidate

Facts are never physically deleted through `FactStore`.

## Retrieval

```bash
./vito memory facts "query" [--current] [--as-of YYYY-MM-DD]
./vito memory recall "query" [--deep] [--current] [--as-of YYYY-MM-DD]
./vito memory backfill-facts --all [--batch 25]
```

`memory recall` queries relevant profile sections, atomic facts, and transcript search together. The `memory-recall` and `fact-memory-search` skills document agent usage and evidence policy.

## Current limitations

- Fact retrieval is FTS/entity/slot based; fact-vector retrieval is not yet implemented.
- Explicit retraction without a replacement value needs a richer reconciliation operation.
- Historical backfill is explicit and resumable; it is never started automatically.
- Generated recall answers are produced by the calling agent and are not persisted as truth.
