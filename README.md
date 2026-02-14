# Vito 3.0

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
- Extensible channel system for adding Discord, Telegram, etc.

### 🎯 Skills System
- Markdown-based skill definitions
- Optional script execution
- Auto-discovery from `skills/` directory

### 📊 Web Dashboard
- 💬 Real-time chat interface
- 📋 Browse all sessions and message history
- 🧠 View and search long-term memories
- 🛠️ Manage skills
- ⏰ View scheduled jobs (coming soon)
- 🔒 Manage secrets (coming soon)

## Quick Start

### Prerequisites
- Node.js 18+ 
- npm or pnpm
- PM2 (`npm install -g pm2`)

### Installation

```bash
# Clone the repo
git clone https://github.com/your-repo/vito3.0.git
cd vito3.0

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
vito3.0/
├── src/                       # Core application code
│   ├── channels/              # Channel adapters (Dashboard, Telegram, Discord)
│   ├── db/                    # SQLite schema and queries
│   ├── memory/                # Memory management and compaction
│   ├── sessions/              # Session management
│   ├── skills/                # Builtin skill discovery and loading
│   └── orchestrator.ts        # Core message flow
├── dashboard/                 # React-based web UI
├── user.example/              # Template — copy to user/ to get started
└── user/                      # Your data, config, and customizations (gitignored)
    ├── SOUL.md                # Agent personality
    ├── secrets.json           # API keys
    ├── vito.config.json       # Configuration
    ├── ecosystem.config.cjs   # PM2 config
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
   - Manage skills

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

## Architecture Highlights

### Memory Flow

1. Messages are stored in SQLite (append-only log)
2. Context is assembled from:
   - Long-term memories (semantic search via embeddings)
   - Cross-session short-term (recent messages from other sessions)
   - Current session short-term (recent messages from this session)
3. When un-compacted messages exceed threshold, LLM reviews and updates memories
4. Processed messages are marked as compacted but never deleted

### Channel System

Channels are adapters that convert between platform-specific formats and Vito's internal message format. Each channel implements:

- `start()` / `stop()` - Lifecycle
- `listen()` - Receive inbound messages
- `createHandler()` - Send outbound messages
- `getSessionKey()` - Identify unique sessions

### Dashboard Architecture

- **Backend**: Express server with WebSocket support
- **Frontend**: React + TypeScript + Vite
- **Communication**: REST API for data queries, WebSocket for real-time chat
- **Styling**: Custom CSS with dark theme

## Roadmap

- [x] Discord channel adapter
- [x] Telegram channel adapter
- [x] Cron job system for scheduled tasks
- [x] Secrets management UI
- [ ] Memory visualization
- [ ] Export/backup tools
- [ ] Multi-user support (optional)

## Contributing

This is a personal project, but suggestions and improvements are welcome!

## License

MIT
