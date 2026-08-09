# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Vito — personal AI agent that runs as a long-lived service across Dashboard, Discord, Telegram, and a programmatic Direct/API channel. Single Pi conversation per Vito session, lives for days/weeks, persisted to disk so the prompt prefix caches and survives restarts.

## Commands

```bash
npm run dev              # tsx watch src/index.ts
npm run dev:dashboard    # Vite dev server (separate terminal)
npm run build            # tsc → dist/
npm run build:dashboard  # Vite build → dashboard/dist/
npm run check            # backend/dashboard types + tests + example config validation
npm test                 # Node test runner via tsx
./vito config validate   # Zod-validate user/vito.config.json
./vito apps list         # Stable agent/operator app-management CLI
npm run validate:config  # Compatibility alias for config validation
npm start                # build dashboard + pm2 start user/ecosystem.config.cjs
npm run logs             # pm2 logs vito-server
npm run status / stop / restart   # pm2 wrappers (service name: vito-server)
```

Production deploy: `./aws_deploy/deploy.sh mike5` (git pull → npm ci → builds → pm2 restart on the EC2 box).

## Architecture

### Entry point

`src/index.ts` boots in this order: ensure `user/` exists (copied from `user.example/` on first run), load secrets into `process.env`, open SQLite and construct `RootContext`, resolve validated `vito.config.json` and `SOUL.md` through `VitoService`, set `process.env.TZ` from `config.settings.timezone`, construct `OrchestratorV2`, register the three real channels (Dashboard, Telegram, Discord — Direct is registered lazily by `Orchestrator.ask()`), `orchestrator.start()`, then watch the user directory with a 3s debounce for atomic config hot-reloads.

### Orchestrator V2 (`src/orchestrator_v2/`)

The whole point of v2 is **one long-lived `PiSessionHarness` per Vito session**, reused across every turn. The system prompt is set once at creation; subsequent turns just call `piSession.prompt(userMessage)`. This is what gets Anthropic prompt caching to hit on every turn.

`orchestrator.ts` owns: per-session FIFO queues (sequential within a session, parallel across sessions), abort tracking for `/stop`, the harness map keyed by Vito session id, and inbound routing. `pi-session-harness.ts` is the actual long-lived wrapper around `@earendil-works/pi-coding-agent`, including `setModel()` and `compact()` for live mutation. `system-prompt.ts` builds the deliberately small/stable system prompt; `capabilities.ts` is the static "capabilities map" string injected into it.

### Per-turn flow

Channel emits `InboundEvent` → `Orchestrator.handleInbound()` → per-session queue → `processMessage()`:

1. Resolve/create Vito session (`SessionManager`).
2. Download remote attachments (e.g., Telegram photos) into `user/drive/images/`.
3. If `requireMention` is on and the bot wasn't mentioned, store and return.
4. Resolve effective settings via `getEffectiveSettings()` (Global → Channel → Session deep merge).
5. Get-or-create the long-lived `PiSessionHarness` for `vitoSession.id`. If a `.fresh` marker exists in the session dir (written by `/new`), force a brand-new pi `SessionManager.create()` instead of `continueRecent()`.
6. Wrap with the decorator chain: `withTracing` → `withPersistence` → `withRelay` → `withTyping`.
7. Build system prompt (only on first run for this pi session — afterwards ignored): personality (SOUL.md) + `<system>` block (SYSTEM.md, hot-loaded from project root) + capabilities map + channel prompt + custom instructions + session identity. Datetime, author, channel, and the user message itself go into the per-turn user message instead, so the prefix stays cacheable.
8. Run with abort signal.
9. Background: `maybeEmbedNewChunks()` chunks new messages (2–4K chars) and embeds them into `user/embeddings.db` via OpenRouter (`text-embedding-3-small`, falling back to native OpenAI).

### Memory: agent-initiated, not pre-loaded

v2 does **not** auto-search embeddings on every turn and does **not** stuff prior messages into the system prompt. The agent calls memory skills explicitly when it needs them — `semantic-history-search` (hybrid: cosine + FTS5 BM25 + RRF) and `keyword-history-search` (raw SQL). Embedding persistence is isolated behind `EmbeddingStore`/`SqliteEmbeddingStore`; `MemoryService` coordinates incremental embedding, search, and statistics through context, while `src/memory/search.ts` and `src/memory/embeddings.ts` retain compatibility façades for standalone skills. Dashboard memory APIs live in `src/routers/MemoryRouterService.ts`. Within a single Vito session the conversation history lives in pi's `AgentSession`; cross-session lookup is only via those skills. `user/profile.md` is **not** inlined into the prompt — the capabilities map tells the agent to `Read` it on first response and `Edit` it when it learns something profile-worthy (see the `profile-maintenance` built-in skill for the rules).

### Pi sessions on disk

Each Vito session id (`channel:target`, e.g., `dashboard:default`, `telegram:123:456`) maps to a directory under `user/pi-sessions/<urlencoded-id>/`. Pi writes its own JSONL state there, which is why a process restart can resume the same conversation. Dashboard listing, reading, and deletion go through the context-scoped `PiSessionStore`; persisted JSONL lines are runtime-validated before being returned. `/new` writes a `.fresh` marker (handled even without an in-memory harness, e.g., right after a server restart) so the next create starts clean. `/compact` calls `piSession.compact()` to summarize older turns in place.

### Channel services (`src/services/channels/`)

Four context-driven `ChannelService` implementations own their platform SDK lifecycle and transport mapping: `DashboardChannelService` (Express on port 3030), `TelegramChannelService` (grammy long polling and attachments), `DiscordChannelService` (discord.js messages, DMs, attachments, and slash commands), and `DirectChannelService` (programmatic requests through the full orchestrator pipeline). `DefaultChannelRegistryService` is the shared registry used by the orchestrator and channel-management routers. Discord and Telegram expose composed `ChannelManagement` capabilities for command registration and platform-specific session aliases; dashboard and direct do not implement fake management operations. Operations take `Context` first, current config comes from `VitoService`, and secrets come from `SecretService`. Dashboard APIs are composed from focused `RouterService` implementations under `src/routers/`; each implements `createRouter(x: Context): Promise<Router>`. `DashboardChannelService` awaits and mounts them in one composition point. Route handlers use `createRoute` for validated JSON responses or `createRawRoute` for streams, redirects, and compatibility responses. These helpers centralize Zod request validation and auth-policy resolution (`public`, `public-drive`, `provider-auth`, `dashboard`, or `ask`) and pass an explicitly scoped context to the handler. `requireMention` remains a per-channel/session setting. The stable external `POST /api/ask` integration surface uses bearer authentication and delegates through `AskApiService`, `Orchestrator.ask()`, and `DirectChannelService`.

### Context model

`Context` is intentionally opaque: `get(key: string): unknown`. Different root, trusted overlay, user, or agent contexts may expose different dependency subsets without consumers knowing their concrete scope. All intentional casts belong in `src/lib/x.ts` convenience accessors such as `xMessageStore(x)`. `ObjectContext` supports lazy factories and optional parent fallback; parent fallback is only for trusted overlays. Authenticated dashboard routes receive a per-request `DashboardUserContext` with an `owner` principal and explicitly exposed dependencies; public Drive, provider-auth, Ask API, and unauthenticated routes receive narrower contexts from `src/context/HttpContext.ts`. Restricted request contexts do not inherit unrestricted `RootContext` access.

### Vito service and config validation

`src/services/vito/` owns access to mutable Vito state. `FileVitoService` reads `vito.config.json` and `SOUL.md`, validates config through the shared Zod schema in `src/shared/contracts/vito-config.ts`, writes application-originated updates atomically, and keeps the last known valid config when a runtime file edit is invalid. Agents may continue editing the files directly and should run `npm run validate:config` afterward; the built-in `vito-config` skill documents that workflow.

### Settings cascade

`getEffectiveSettings(config, channelName, sessionKey)` in `src/settings.ts` deep-merges Global → Channel → Session. The whole live surface is: `streamMode` (`stream`/`bundled`/`final`), `customInstructions`, `requireMention`, `traceMessageUpdates`, `timezone`, and `pi-coding-agent` (with `model.{provider,name}`, `openRouterProvider`, and `thinkingLevel`). Pi is the only runtime. Defaults: `streamMode=stream`, `timezone=America/Toronto`, default model `anthropic/claude-sonnet-4-20250514`.

### Slash commands (priority, bypass queue)

- `/stop` — abort active request, clear queue, release session lock.
- `/restart` — confirm, then spawn delayed `pm2 restart vito-server`.
- `/new` — write `.fresh` marker; next turn starts a brand-new pi session (history archived in `messages.archived`, embedded first).
- `/compact` — summarize older turns of the live pi session in place.
- `/model <name>` — hot-swap the model on the live pi session.

### Cron

`src/cron/scheduler.ts` (croner, timezone-aware). Jobs are defined in `vito.config.json` under `cron.jobs` and re-applied on hot-reload. `oneTime: true` removes the job from the config after firing. `sendCondition` forces `streamMode: "final"` and wraps the handler with `withNoReplyCheck` — if the response contains `NO_REPLY`, nothing gets relayed. Dashboard cron APIs live in `src/routers/CronRouterService.ts`, use the context-scoped `CronService`, validate schedules before mutation, and persist configured jobs through `VitoService`.

### Pi runtime decorators (`src/harnesses/`)

Decorators wrap the long-lived `PiSessionHarness` through its runtime interface: `ProxyHarness` is the base for `TracingHarness`, `PersistenceHarness`, `RelayHarness`, `TypingHarness`. The decorator chain order matters: tracing (uses the context-scoped `TraceStore` and `TraceEventStore` to write append-only `.jsonl` traces into `logs/`, capped at 50MB) → persistence (writes user/assistant/tool rows into SQLite; never deletes — `/new` only archives) → relay (delivers to the channel's `OutputHandler` per `streamMode`) → typing. The current trace stores are file-backed; the harness and dashboard do not access trace files directly.

### Skills (`src/skills/`)

`SkillStore` is the skill persistence/discovery boundary. Its current `FileSkillStore` scans `user/skills/` and `src/skills/builtin/` for Zod-validated `SKILL.md` frontmatter (`name`, `description`), optionally includes skill files, and applies user-overrides-built-in resolution. Built-in skills are read-only through the store. The agent calls skills via the Skill tool exposed by pi-coding-agent — they're not pre-listed in the system prompt.

### Database

`user/vito.db` (SQLite WAL):

```
sessions  (id PK, channel, channel_target, created_at, last_active_at, config JSON, alias)
messages  (id PK, session_id FK, channel, channel_target, timestamp,
           type CHECK('user','thought','assistant','tool_start','tool_end'),
           content JSON, compacted, archived, author)
memories  (legacy table, no live readers/writers)
traces    (legacy table retained for existing data; live tracing uses file-backed stores)
```

Separate `user/embeddings.db` holds chunk vectors + FTS5 index used by `semantic-history-search`. Schema migrations live in `src/db/schema.ts` and run on startup.

### Configuration files

- `user/vito.config.json` — `bot`, `settings` (global), `harnesses["pi-coding-agent"]`, `channels[]`, `sessions{}` (per-key overrides), `cron.jobs[]`. Hot-reloaded with 3s debounce; live pi sessions get their model re-synced on reload.
- `user/secrets.json` — flat key-value managed through the context-scoped `SecretService` and injected into `process.env` at boot. Writes are atomic and empty values clear the corresponding environment variable. Provider keys: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `GROQ_API_KEY`, `XAI_API_KEY`, `OPENROUTER_API_KEY`. Channel tokens: `TELEGRAM_BOT_TOKEN`, `DISCORD_BOT_TOKEN`. Other: `DASHBOARD_PASSWORD_HASH` (managed by the dashboard, don't hand-edit), `BLAND_WEBHOOK_SECRET`.
- `SYSTEM.md` (project root, **not** under `user/`) — hot-loaded into every system prompt.
- `user/SOUL.md` — agent personality, hot-loaded.
- `user/profile.md` — agent-managed user profile. Read by the agent on first response in a session.
- `~/.pi/agent/auth.json` — pi's OAuth tokens (separate from `secrets.json`).

## Code conventions

- ESM only (`"type": "module"`). Imports use explicit `.js` extensions even for `.ts` sources — required by Node16 module resolution.
- TypeScript strict, target ES2022, `module: Node16`, `moduleResolution: Node16`.
- `import type { ... }` for type-only.
- Files: kebab-case. Interfaces/Classes: PascalCase. Functions/vars: camelCase.
- Decorators extend `ProxyHarness`.

## Operational notes

- PM2 service is `vito-server`; npm scripts call bare `pm2`, not `npx pm2`.
- The dashboard has its own `node_modules` — run `npm install` inside `dashboard/` to get `vite`/`typescript` etc.
- Heartbeat log every 30 minutes (server alive + active cron count).
- After a server restart, in-memory harness state is gone but pi-session JSONL on disk remains, so the next message resumes the same conversation. Vito's own message DB is append-only.
