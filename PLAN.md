# Vito Phase 1 Implementation Plan

## Project Structure

```
vito3.0/
├── package.json
├── tsconfig.json
├── SOUL.md                     ← User personality (placeholder)
├── vito.config.json            ← Runtime config
├── skills/                     ← Skills directory (empty for now)
├── data/                       ← SQLite DB (gitignored)
├── .gitignore
└── src/
    ├── index.ts                ← Entry point: wire + start
    ├── config.ts               ← Load vito.config.json + SOUL.md
    ├── types.ts                ← Shared interfaces
    ├── db/
    │   ├── schema.ts           ← Create tables
    │   └── queries.ts          ← All DB operations
    ├── memory/
    │   ├── context.ts          ← Context assembly (build prompt)
    │   ├── embeddings.ts       ← OpenAI embeddings + cosine sim
    │   └── compaction.ts       ← LLM-driven memory management
    ├── sessions/
    │   └── manager.ts          ← Create/resume sessions
    ├── channels/
    │   ├── types.ts            ← Channel/OutputHandler interfaces
    │   └── cli.ts              ← Terminal chat channel
    ├── skills/
    │   └── discovery.ts        ← Scan skills/*/SKILL.md
    └── orchestrator.ts         ← Message flow: channel → memory → pi → channel
```

## Dependencies

- `@mariozechner/pi-coding-agent` — LLM calls + tool execution (bash/read/write/edit)
- `@mariozechner/pi-ai` — Model selection (`getModel`)
- `better-sqlite3` + `@types/better-sqlite3` — SQLite
- `openai` — Embeddings API
- `gray-matter` — Parse SKILL.md frontmatter
- `typescript`, `tsx` — Build/run

## Implementation Order

1. **Project setup** — package.json, tsconfig, gitignore
2. **Types** — Shared interfaces (Channel, InboundEvent, etc.)
3. **Config** — Load config file + SOUL.md
4. **DB schema + queries** — SQLite tables, all CRUD
5. **Session manager** — Create/resume sessions
6. **Embeddings** — OpenAI embed + cosine similarity in JS
7. **Memory context assembly** — Build the 3-layer context
8. **Compaction** — LLM-driven memory management (triggered when threshold hit)
9. **Skills discovery** — Scan + parse SKILL.md files
10. **Orchestrator** — Ties everything together, manages pi sessions
11. **CLI channel** — readline-based terminal chat
12. **Entry point** — Wire and start

## Key Design

- **Pi integration**: Per Vito session, maintain a long-lived pi `AgentSession` with `SessionManager.inMemory()`. System prompt = SOUL.md + memories + cross-session context + skills. Pi handles conversation history + tool execution natively.
- **Context rebuild**: Before each `session.prompt()`, rebuild system prompt with fresh memories/cross-session context. Only recreate the pi session if context changes significantly.
- **Embeddings**: OpenAI `text-embedding-3-small`, stored as Float32Array blobs. Cosine similarity computed in JS (no sqlite-vec needed at this scale).
- **Compaction**: After each message, check un-compacted count. If > threshold, run LLM to consolidate memories, mark messages compacted.
- **Media parsing**: Regex for `MEDIA:/path` in LLM output, convert to attachments.
