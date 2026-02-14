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

### Installation

```bash
# Install dependencies
npm install

# Build the dashboard
npm run build:dashboard

# Start Vito (includes CLI and web dashboard)
npm start
```

The dashboard will be available at **http://localhost:3030**

### Environment Setup

Create a `.env` file with your API keys:

```bash
# Required for LLM
ANTHROPIC_API_KEY=your_key_here

# Required for embeddings
OPENAI_API_KEY=your_key_here
```

### Configuration

Edit `vito.config.json` to customize:

```json
{
  "model": {
    "provider": "anthropic",
    "name": "claude-sonnet-4"
  },
  "memory": {
    "currentSessionLimit": 50,
    "crossSessionLimit": 30,
    "memoriesLimit": 10,
    "compactionThreshold": 200
  }
}
```

### Personality

Define your agent's personality in `SOUL.md`. This is how you make Vito yours.

## Project Structure

```
vito3.0/
├── src/
│   ├── channels/          # Channel adapters (CLI, Dashboard, etc.)
│   ├── db/                # SQLite schema and queries
│   ├── memory/            # Memory management and embeddings
│   ├── sessions/          # Session management
│   ├── skills/            # Skill discovery
│   └── orchestrator.ts    # Core message flow
├── dashboard/             # React-based web UI
│   └── src/
│       └── components/    # Dashboard components
├── skills/                # Your custom skills
├── data/                  # SQLite database (gitignored)
├── SOUL.md                # Agent personality
└── vito.config.json       # Configuration
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

Create a new directory in `skills/` with a `SKILL.md` file:

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

- [ ] Discord channel adapter
- [ ] Telegram channel adapter
- [ ] Cron job system for scheduled tasks
- [ ] Secrets management UI
- [ ] Memory visualization
- [ ] Export/backup tools
- [ ] Multi-user support (optional)

## Contributing

This is a personal project, but suggestions and improvements are welcome!

## License

MIT
