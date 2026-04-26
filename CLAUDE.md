# CLAUDE.md — Vito 3.0

Personal AI agent framework. Multi-channel (Dashboard, Discord, Telegram, Direct/API) with a pluggable harness system, semantic memory pipeline, skills, and per-field auto classifier.

## Tech Stack

- **Backend**: Node.js, TypeScript 5.7+, Express 5.2, better-sqlite3 (WAL mode), WebSocket (ws)
- **Frontend**: React 18.3, Vite 6.4, Tailwind CSS 4.1, React Router 7, react-markdown
- **AI Harness**: `@mariozechner/pi-coding-agent` + `@mariozechner/pi-ai` — supports Anthropic, OpenAI, Google, OpenRouter, Groq, xAI
- **Embeddings**: OpenAI `text-embedding-3-small` via OpenRouter (falls back to native OpenAI)
- **Channels**: grammy (Telegram), discord.js 14 (Discord), Express+WS (Dashboard), readline (CLI), DirectChannel (API)
- **Process**: PM2 (`vito-server`), croner for cron scheduling
- **Other**: axios, playwright, googleapis, gray-matter, ajv, execa, @viz-js/viz, dotenv

## Commands

```bash
npm run dev              # Backend watch mode (tsx watch src/index.ts)
npm run dev:dashboard    # Dashboard dev server (Vite, separate terminal)
npm run build            # TypeScript compile (tsc → dist/)
npm run build:dashboard  # Vite build (dashboard/dist/)
npm start                # Build dashboard + start with PM2 (user/ecosystem.config.cjs)
npm stop / npm restart   # PM2 lifecycle (pm2 stop/restart vito-server)
npm logs                 # PM2 logs (pm2 logs vito-server)
npm run status           # PM2 status
```

Always rebuild after source changes before running in production.

## Project Structure

```
src/
  index.ts                  # Entry point — loads config, secrets, creates orchestrator, registers channels, watches config
  orchestrator.ts           # Core message routing, context assembly, auto classifier, harness execution, /stop /new /restart commands
  types.ts                  # Shared types (VitoConfig, Settings, Channel, Harness, InboundEvent, MsgType, etc.)
  config.ts                 # Loads vito.config.json and SOUL.md from user/
  settings.ts               # Settings cascade: Global -> Channel -> Session (with deep merge)
  secrets.ts                # Loads user/secrets.json into process.env, provider key management
  system-instructions.ts    # Reads SYSTEM.md, builds <system> block for prompts
  workspace.ts              # Sandbox enforcement (dev mode = full access, package mode = ~/vito only)
  traceTypes.ts             # TypeScript types for .jsonl trace file format

  channels/
    dashboard.ts            # Express + WS server (port 3030), auth, REST API, file serving, drive
    telegram.ts             # grammy bot, long polling, photo/document attachments
    discord.ts              # discord.js client, guild messages + DMs, slash commands, attachments
    cli.ts                  # readline-based interactive channel (streaming capable)
    direct.ts               # Programmatic API channel — captures response, used by Orchestrator.ask()

  harnesses/
    types.ts                # Harness interface, NormalizedEvent, HarnessCallbacks, HarnessFactory
    proxy.ts                # ProxyHarness — base class for decorator pattern (delegates all calls)
    pi-coding-agent/
      index.ts              # PiHarness — wraps @mariozechner/pi-coding-agent, default model claude-sonnet-4
    index.ts                # Re-exports: PiHarness, ProxyHarness, TracingHarness, PersistenceHarness, RelayHarness, TypingHarness
    tracing.ts              # withTracing() — logs all events to .jsonl trace files (user/logs/)
    persistence.ts          # withPersistence() — saves user/assistant/tool messages to SQLite
    relay.ts                # withRelay() — forwards messages to channel OutputHandler (stream/bundled/final modes)
    typing.ts               # withTyping() — manages typing indicators on channels that support them

  harness/decorators/
    index.ts                # Re-exports withNoReplyCheck
    no-reply-final-message.ts  # Suppresses relay if response contains NO_REPLY (for conditional cron jobs)

  db/
    schema.ts               # SQLite schema creation + migrations (sessions, messages, memories, traces tables)
    queries.ts              # Prepared statement wrappers (Queries class) for all DB operations

  memory/
    models.ts               # Shared model identifier: openai/text-embedding-3-small
    client.ts               # OpenAI-compatible client for embeddings (OpenRouter > native OpenAI fallback)
    context.ts              # assembleContext() — builds 3-layer context: memories, cross-session, current-session
    embeddings.ts           # Incremental embeddings — chunks messages (2-4K chars), generates contextual sentence, embeds to embeddings.db
    search.ts               # Hybrid retrieval: embedding cosine similarity + FTS5 BM25 + RRF merge
    auto-classifier.ts      # Per-field auto classifier — cheap LLM (claude-haiku-4-5) decides settings per turn
    profile.ts              # User profile (user/profile.md) — auto-updated after each turn via LLM with Read/Edit tools

  skills/
    discovery.ts            # Scans user/skills/ and src/skills/builtin/ for SKILL.md files (gray-matter frontmatter)

  sessions/
    manager.ts              # Session resolution — resolves or creates sessions by key (channel:target format)

  cron/
    scheduler.ts            # Croner-based scheduler — timezone-aware, one-time jobs, sendCondition support

SYSTEM.md                   # System instructions (hot-loaded into every prompt, ~94 lines)

dashboard/                  # React SPA
  src/
    App.tsx                 # Routes: Chat, Sessions, Memory, Skills, Secrets, Jobs, System, Server, Apps, Drive, Traces, Settings
    components/
      Chat.tsx, ChatView.tsx, Sessions.tsx, Memory.tsx, Skills.tsx,
      Secrets.tsx, Jobs.tsx, System.tsx, Server.tsx, Apps.tsx,
      Drive.tsx, Traces.tsx, Login.tsx, FilterButton.tsx
      settings/             # Unified settings UI

user/                       # User config directory (gitignored, created from user.example/ on first run)
  vito.config.json          # Main config: bot, settings, harnesses, channels, sessions, cron
  secrets.json              # API keys (flat key-value, injected into process.env)
  SOUL.md                   # Agent personality
  profile.md                # Auto-managed user profile (markdown)
  profile.json              # Auto-managed user profile (structured)
  vito.db                   # Main SQLite database
  embeddings.db             # Embeddings database (chunks + vectors)
  ecosystem.config.cjs      # PM2 config
  skills/                   # User-defined skills (SKILL.md format, ~36 skills)
  apps/                     # User apps
  drive/                    # File storage (images/, with .meta.json for public/private)
  logs/                     # Trace files (.jsonl)
  images/                   # Static images

src/skills/builtin/         # Built-in skills: apps, history, scheduler, semantic-history-search
```

## Architecture

### Message Flow
Channel receives message -> `Orchestrator.handleInbound()` -> per-session queue (sequential within session, parallel across sessions) -> `processMessage()`:
1. Resolve/create session via `SessionManager`
2. Download remote attachments (e.g., Telegram photos) to `user/drive/images/`
3. Check `requireMention` setting (if not mentioned, store message silently and return)
4. Resolve effective settings via `getEffectiveSettings()` (Global -> Channel -> Session cascade)
5. If any `auto` flags enabled, run auto classifier (cheap LLM call) to decide per-turn settings
6. Assemble context: memories list, cross-session messages, current-session messages
7. Auto-search embeddings for relevant historical chunks (hybrid: embedding + FTS5 BM25 + RRF)
8. Build harness with decorator chain: `PiHarness` -> `withTracing()` -> `withPersistence()` -> `withRelay()` -> `withTyping()`
9. Build system prompt: datetime, personality (SOUL.md), system block (SYSTEM.md), skills, channel prompt, harness instructions, custom instructions, user profile, recalled memories, session context
10. Execute harness with abort signal support
11. Background: embed new chunks, update user profile

### Key Patterns
- **Harness decorator chain**: ProxyHarness base class, decorators wrap inner harness. Order matters: tracing -> persistence -> relay -> typing
- **Settings cascade**: Global -> Channel -> Session (deep merge, later wins). Resolved via `getEffectiveSettings()`
- **Auto classifier**: Per-field LLM classifier (claude-haiku-4-5 default) can auto-select: currentContext.limit, currentContext.includeWorkingContext, crossContext.limit, crossContext.maxSessions, crossContext.includeWorkingContext, recalledMemoryLimit, pi-coding-agent model. Configurable model choices, classifier model, and classifierContext (how much history the classifier sees)
- **Stream modes**: `stream` (real-time tokens), `bundled` (chunks), `final` (single message). DirectChannel and sendCondition force `final`
- **Append-only DB**: Messages never deleted, only marked archived. `/new` command embeds then archives
- **Hot-reload**: Config file watched with 3s debounce, reloads orchestrator + cron + dashboard
- **Per-session queues**: Messages queue per session, process sequentially. `/stop` bypasses queue, aborts active request, releases session lock
- **Trace files**: .jsonl format in user/logs/ — header, invocation, prompt, user_message, raw_events, normalized_events, memory_search, embedding_result, profile_update, footer
- **Conditional cron**: Jobs with `sendCondition` force final mode, wrap handler with NO_REPLY check

### Memory System
- **User profile** (`user/profile.md`): Freeform markdown, always injected into system prompt. Auto-updated after each turn by a lightweight LLM call with Read/Edit tools
- **Current session context**: Recent messages from current session (default 100, configurable)
- **Cross-session context**: Last N messages from other sessions (default 5 per session, max 15 sessions)
- **Semantic search**: Incremental embeddings (2-4K char chunks) stored in embeddings.db. Auto-search runs before every response using hybrid retrieval (cosine similarity + FTS5 BM25 + RRF merge). Contextual sentence generated per chunk via gpt-4o-mini
- **Auto-search tuning**: recalledMemoryLimit (default 3), recalledMemoryThreshold (default 0.005 RRF score)

### Sessions
Format: `channel:target` (e.g., `dashboard:default`, `telegram:123456789`, `discord:guild:channel`, `api:default`)
- Session key is built by the channel, orchestrator treats it as opaque
- Sessions have optional aliases for human-readable display
- Special session `system:profile-updater` configures the profile update harness

### Commands
- `/new` — Force embed unembedded messages, then archive all messages in session (clean slate)
- `/stop` — Abort current request, clear queue, release stuck session lock (bypasses queue)
- `/restart` — Sends confirmation, spawns delayed `pm2 restart vito-server` (5s delay)

### DirectChannel / API
`Orchestrator.ask()` provides a programmatic API that routes through the full pipeline (context, search, decorators, persistence). Used by external integrations (Bland.ai phone, webhooks). 2-minute timeout. Forces `final` stream mode.

## Code Conventions

- ESM modules only (`"type": "module"`)
- Explicit `.js` extensions in imports (even for .ts files — required by Node16 module resolution)
- `import type { ... }` for type-only imports
- Files: kebab-case. Interfaces/Classes: PascalCase. Functions/vars: camelCase
- TypeScript strict mode, target ES2022, module Node16, moduleResolution Node16
- Single responsibility per file
- Decorators follow proxy pattern (extend ProxyHarness)

## Configuration

- `user/vito.config.json` — Main config: `bot` (name), `settings` (global defaults), `harnesses` (pi-coding-agent model/thinking), `channels` (enabled + per-channel settings), `sessions` (per-session overrides), `cron` (jobs array)
- `user/secrets.json` — Flat key-value. Provider keys: ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY, GROQ_API_KEY, XAI_API_KEY, OPENROUTER_API_KEY. Channel tokens: TELEGRAM_BOT_TOKEN, DISCORD_BOT_TOKEN. Dashboard: DASHBOARD_PASSWORD_HASH. Webhook: BLAND_WEBHOOK_SECRET
- `user/SOUL.md` — Agent personality (injected into every prompt)
- `user/profile.md` — Auto-managed user profile (freeform markdown, always in prompt)
- `user/profile.json` — Auto-managed structured user profile
- `SYSTEM.md` — System instructions (hot-loaded from project root, not user/)

### Settings Defaults
| Setting | Default |
|---|---|
| harness | `pi-coding-agent` |
| streamMode | `stream` |
| currentContext.limit | 100 |
| currentContext.includeThoughts | true |
| currentContext.includeTools | true |
| auto.classifierContext.currentSessionMessages | 25 |
| auto.classifierContext.crossSessionMessages | 0 |
| auto.classifierContext.crossSessionMaxSessions | 0 |
| crossContext.limit | 5 |
| crossContext.maxSessions | 15 |
| memory.recalledMemoryLimit | 3 |
| memory.recalledMemoryThreshold | 0.005 |
| memory.profileUpdateContext | 2 |
| auto.* | all false (off) |
| auto.classifierModel | anthropic/claude-haiku-4-5 |
| timezone | America/Toronto |

## Dashboard

- Port 3030, Express HTTP + WebSocket server (same port)
- Optional auth: password hash in secrets.json, cookie-based sessions, 7-day TTL, rate-limited login (5 attempts/15 min)
- Pages: Chat, Sessions, Memory search, Skills, Secrets, Cron Jobs, System (SYSTEM.md), Server, Apps, Drive (file browser with public/private via .meta.json), Traces (JSONL viewer), Settings (unified)
- File serving: `/api/drive/*` for user/drive/, `/api/attachments/*` for data/attachments/
- REST API: auth, sessions, messages, config, secrets, skills, cron, memory search, traces, drive, provider models/status

## Database (SQLite — user/vito.db)

```sql
sessions (id TEXT PK, channel, channel_target, created_at, last_active_at, config JSON, alias TEXT)
messages (id INTEGER PK, session_id FK, channel, channel_target, timestamp, type CHECK('user','thought','assistant','tool_start','tool_end'), content JSON, compacted, archived, author)
memories (id INTEGER PK, timestamp, title, content, embedding BLOB)
traces   (id INTEGER PK, session_id, channel, timestamp, user_message, system_prompt, model)
```

Indexes: messages(session_id), messages(compacted), messages(timestamp), messages(archived), messages(type), sessions(last_active_at), traces(timestamp)

Separate embeddings database: `user/embeddings.db` (chunks table with vectors)

## Skills

- Discovered from `user/skills/` (user) and `src/skills/builtin/` (built-in). User skills override built-in with same name
- Each skill is a directory with a `SKILL.md` file (gray-matter frontmatter: name, description)
- Built-in skills: apps, history, scheduler, semantic-history-search
- ~36 user skills in this instance
- Skills prompt is formatted and injected into system prompt on every request

## Important Notes

- PM2 service name is `vito-server` — scripts use bare `pm2` (not `npx pm2`)
- Dashboard needs devDependencies: run `npm install` in dashboard/ (vite, typescript, etc.)
- Config hot-reloads on save (3s debounce) — reloads orchestrator config, cron jobs, and dashboard config
- Default model for pi-coding-agent: `anthropic/claude-sonnet-4-20250514` (configurable per Global/Channel/Session)
- Auto classifier default model choices (via OpenRouter): claude-haiku-4.5, claude-sonnet-4.6, claude-opus-4.6
- Timezone set via `config.settings.timezone` (default: America/Toronto), propagated to `process.env.TZ`
- Dev mode (has .git): full filesystem access. Package mode: sandboxed to ~/vito workspace
- VITO_WORKSPACE env var overrides workspace location. VITO_SANDBOX=false disables sandbox
- Heartbeat log every 30 minutes (server alive + active cron job count)
- Trace files capped at 50MB per file
- Embedding chunk size: 2-4K chars, contextual sentence via gpt-4o-mini
- Pi auth tokens stored at `~/.pi/agent/auth.json` (OAuth providers)
