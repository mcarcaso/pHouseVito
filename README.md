# Vito

A personal AI agent framework with persistent memory, extensible skills, and multi-channel support.

## Features

### 🧠 Intelligent Memory System
- **Short-term memory** - Recent conversation context per session
- **Long-term memory** - LLM-managed semantic memories with embeddings
- **Cross-session awareness** - Sessions can reference each other
- **Automatic compaction** - LLM decides what to remember

### 📡 Multi-Channel Support
- **CLI** - Terminal-based chat interface
- **Dashboard** - Web-based UI with real-time updates
- **Discord** - Bot integration with guild/channel filtering
- **Telegram** - Bot integration with chat ID filtering

### 🔌 Harness System
- **pi-coding-agent** - Pi Coding Agent harness (supports OpenAI, Anthropic, Google, OpenRouter)
- **Per-session overrides** - Use different models for different conversations

### 🎯 Skills System
- Markdown-based skill definitions
- Optional script execution
- Auto-discovery from `skills/` directory

### 📊 Web Dashboard
- 💬 Real-time chat interface
- 📋 Browse all sessions and message history
- 🧠 View and search long-term memories
- 🛠️ Manage skills
- ⏰ Scheduled cron jobs
- ⚙️ Settings management (harness, channels, per-session overrides)

## Quick Start

### Prerequisites
- Node.js 18+ 
- npm or pnpm
- PM2 (`npm install -g pm2`)

### Installation

```bash
# Clone the repo
git clone https://github.com/mcarcaso/pHouseVito.git
cd pHouseVito

# Install dependencies
npm install

# Set up your user directory from the template
cp -r user.example user

# Configure your secrets (API keys, tokens, etc.)
# Edit user/secrets.json and fill in your keys

# Configure your settings
# Edit user/vito.config.json to set model, channels, etc.

# Configure PM2 paths
# Edit user/ecosystem.config.cjs and set your node path

# Build and start
npm start
```

The dashboard will be available at **http://localhost:3030**

### User Directory

The `user/` directory contains all your personal configuration, data, and customizations. It's gitignored so your secrets and data never end up in the repo.

The `user.example/` directory is the template — copy it to `user/` to get started:

```
user/
├── SOUL.md                  # Your agent's personality (edit this!)
├── secrets.json             # API keys and tokens
├── vito.config.json         # Model, memory, and channel settings
├── ecosystem.config.cjs     # PM2 process manager config
├── vito.db                  # SQLite database (auto-created)
├── memories/                # Long-term memory docs (auto-managed)
├── skills/                  # Your custom skills
│   └── example/             # Example skill template
├── apps/                    # Deployed web apps
├── images/                  # Generated images and screenshots
└── logs/                    # PM2 and app logs
```

### Personality

Edit `user/SOUL.md` to define your agent's personality. This is how you make Vito yours — give it a name, a vibe, and tell it what you care about.

## Project Structure

```
pHouseVito/
├── src/                       # Core application code
│   ├── channels/              # Channel adapters (Dashboard, Telegram, Discord)
│   ├── db/                    # SQLite schema and queries
│   ├── harnesses/             # AI backend harnesses (pi-coding-agent)
│   ├── memory/                # Memory management and compaction
│   ├── sessions/              # Session management
│   ├── skills/                # Builtin skill discovery and loading
│   └── orchestrator.ts        # Core message flow
├── dashboard/                 # React-based web UI
├── data/                      # Runtime data (attachments, etc.) — gitignored
├── user.example/              # Template — copy to user/ to get started
└── user/                      # Your data, config, and customizations (gitignored)
    ├── SOUL.md                # Agent personality
    ├── secrets.json           # API keys
    ├── vito.config.json       # Configuration
    ├── ecosystem.config.cjs   # PM2 config
    ├── vito.db                # SQLite database
    ├── memories/              # Long-term memory docs
    ├── skills/                # Custom skills
    ├── apps/                  # Deployed web apps
    ├── images/                # Generated media
    └── logs/                  # Process logs
```

## Usage

### CLI Mode

```bash
npm start
```

Type your messages and press Enter. Type `/quit` to exit.

### Dashboard Mode

1. Start Vito: `npm start`
2. Open http://localhost:3030 in your browser
3. Use the tabs to:
   - Chat with Vito
   - Browse sessions and message history
   - View long-term memories
   - Manage skills and jobs

### Adding Skills

Create a new directory in `user/skills/` with a `SKILL.md` file:

```markdown
---
name: example
description: What this skill does
---

# Example Skill

## When to Use
- Describe when the agent should use this skill

## How to Use
- Provide instructions for the agent
```

Skills are automatically discovered on startup.

## Development

### Run in Development Mode

```bash
# Watch mode for backend
npm run dev

# Separate terminal for dashboard hot reload
npm run dev:dashboard
```

### Build

```bash
# Build TypeScript
npm run build

# Build dashboard
npm run build:dashboard
```

## Architecture

### Core Runtime

- **Orchestrator** — Central brain that routes inbound messages to the harness and outbound responses to channels.
- **Per-session queue** — Messages are queued per session so work completes in order without interruption. Cross-session work runs in parallel.
- **Streaming pipeline** — Raw events are emitted in real-time while normalized events are stored in the DB.
- **Thought promotion** — Harness emits thoughts; the last “thought” is promoted to the final assistant message.

### Harness System

The harness is the pluggable AI backend that handles LLM interaction.

- **pi-coding-agent** — Uses the Pi Coding Agent SDK. Supports multiple providers (OpenAI, Anthropic, Google, OpenRouter) with thinking levels.

Configure in `user/vito.config.json`:
```json
{
  "harnesses": {
    "pi-coding-agent": {
      "model": { "provider": "openrouter", "name": "anthropic/claude-sonnet-4.6" },
      "thinkingLevel": "off"
    }
  }
}
```

Override per-session via the Dashboard Settings page.

### Harness Decorators

Runtime behaviors are layered via decorators:
- `withTracing()` — JSONL trace logging
- `withPersistence()` — SQLite message storage
- `withRelay()` — Streaming to channels
- `withTyping()` — Typing indicators
- `withNoReplyCheck()` — Drops responses containing `NO_REPLY`

### System Instructions

System instructions are centralized in `src/system-instructions.ts`, including:
- **Core instructions** (tools, MEDIA protocol, restart rules)
- **Commands block** (`/new` only for interactive sessions)
- **Cardinal rules** (verify facts, investigate before assuming)
- **Investigation-first behavior**

### Memory Flow

1. Messages are stored in SQLite (append-only log)
2. Context is assembled from:
   - Long-term memories (LLM-managed files)
   - Cross-session short-term (recent messages from other sessions)
   - Current session short-term (recent messages from this session)
3. When un-compacted messages exceed threshold, compaction runs and updates memory docs
4. Processed messages are marked as compacted but never deleted

### Compaction System

Compaction is implemented as a **skill** and runs via the `system:compaction` session:
- Orchestrator triggers a synthetic message when threshold is exceeded or `/new` is used
- The compaction skill reads SQLite + memory files, then rewrites memory docs
- Orchestrator marks compaction session messages as compacted after completion

### Multimodal Handling

- **Images**: stored as `[Attached image: /path]` tags and converted by the harness to pixel data
- **Audio**: not wired by default; requires explicit transcription

### Channel System

Channels are adapters that convert between platform-specific formats and Vito's internal message format. Each channel implements:
- `start()` / `stop()` - Lifecycle
- `listen()` - Receive inbound messages
- `createHandler()` - Send outbound messages
- `getSessionKey()` - Identify unique sessions

### Dashboard Architecture

- **Backend**: Express server with WebSocket support (port 3030)
- **Frontend**: React + TypeScript + Vite
- **Communication**: REST API for data queries, WebSocket for real-time chat
- **Styling**: Custom CSS with dark theme

### Cron + Scheduler

- **node-cron** schedules recurring jobs
- Jobs live in `user/vito.config.json` and hot-reload on config change
- `NO_REPLY` message marker suppresses replies when `sendCondition` isn’t met
- Health check endpoint at `/api/cron/health` exposes runner state

### Bot Identity + Mentions

- `bot.name` in `user/vito.config.json` defines Vito’s display name
- Channels normalize @mentions to `@{bot.name}` for clean storage
- `requireMention` can be overridden per session/channel in the settings cascade

### Session Aliases

- Sessions can have user-defined aliases stored in the DB
- Dashboard shows alias as primary name with raw session id beneath
- Alias editing is inline in the Sessions view

## Lessons Learned

### File Operations
- **Check file size before reading** (use `ls -la` or `wc -l`)
- **Send .txt for iOS** — Mike can’t open `.ts`/`.js` on iOS

### Build & Deploy
- **Always rebuild after source changes** — `npm run build` if changes aren’t working
- **Dashboard needs devDeps** — use `NODE_ENV=development npm install` in dashboard dir
- **Cloudflare caches 404s** — use cache-busting params or wait for expiry
- **Icon caching** — avoid common names like `favicon.png`, use unique filenames
- **Disable caching by default** — use `serve.json` with no-cache headers
- **Don’t use SPA mode** for static sites (`serve -s` breaks static files)

### PM2 & Processes
- **Use `npx pm2`** — not bare `pm2`
- **Service name is `vito-server`** — not `vito`
- **Always use `--nostream`** for logs
- **Watch for orphan processes** — avoid rogue `node server.js &`

### React
- **Hooks must be before any returns**
- **Number inputs need local string state**
- **localStorage can corrupt** — wrap JSON.parse in try/catch
- **Defensive object access** — handle empty objects in inherited configs

### API & Config Patterns
- **PUT endpoints do shallow merge** — `{}` doesn’t delete keys
- **Send `null` to remove config keys**
- **Nested object replacement** — replace, don’t merge

### Unicode in JSX
- `\u25BC` in JSX renders literally — use `▼` or `{"\u25BC"}`

### Hallucination Risk
- **Don’t assume image content** — look first
- **Verify personal details** — no sloppy memory recall

### Debugging & Investigation
- **Never restart yourself** — tell the user “changes are ready”
- **Search the message DB first** when something looks off

### Browser Cookie Extraction
- **Safari cookies are binary** — use `browser_cookie3` or parse manually
- **Playwright sessions are isolated** — must inject cookies
- **Pattern**: login in browser → extract cookies → load into Playwright

## Roadmap

- [x] Discord channel adapter
- [x] Telegram channel adapter
- [x] Cron job system for scheduled tasks
- [x] Secrets management UI
- [x] Harness system with multiple AI backends
- [x] Per-session harness/model overrides
- [ ] Memory visualization
- [ ] Export/backup tools
- [ ] Multi-user support (optional)

## Contributing

This is a personal project, but suggestions and improvements are welcome!

## License

MIT
