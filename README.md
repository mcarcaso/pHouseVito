# Vito

Your personal AI assistant — runs locally, remembers everything, extends with skills.

## Quick Start

```bash
# Install globally
npm install -g vito-ai

# Initialize your workspace
vito init

# Add your API keys
nano ~/vito/secrets.json

# Start Vito
vito start
```

Then open `http://localhost:3000` in your browser.

## Commands

| Command | Description |
|---------|-------------|
| `vito init` | Create a new workspace at `~/vito` |
| `vito start` | Start Vito (dashboard + agent) |
| `vito stop` | Stop Vito |
| `vito status` | Check if Vito is running |
| `vito logs` | View recent logs |
| `vito logs -f` | Follow logs in real-time |
| `vito reset` | Reset config and clear memory (keeps secrets) |

## Configuration

All config lives in `~/vito/`:

```
~/vito/
├── vito.config.json   # Settings, channels, sessions
├── secrets.json       # API keys (never committed)
├── profile.json       # Info about you (Vito uses this for context)
├── SOUL.md            # Vito's personality (customize it!)
├── SYSTEM.md          # System instructions
├── vito.db            # Memory database (SQLite)
├── skills/            # Your custom skills
└── images/            # Screenshots, generated images
```

## API Keys

Edit `~/vito/secrets.json`:

```json
{
  "ANTHROPIC_API_KEY": "sk-ant-...",
  "OPENROUTER_API_KEY": "sk-or-..."
}
```

At minimum, you need an Anthropic API key. OpenRouter is optional but gives you access to more models.

## Skills

Skills extend what Vito can do. Built-in skills include:
- **scheduler** — Schedule tasks with cron
- **keyword-history-search** — Search past conversations
- **semantic-history-search** — Search by meaning, not just keywords
- **apps** — Deploy simple web apps

### Creating Your Own Skills

1. Create a folder: `~/vito/skills/my-skill/`
2. Add a `SKILL.md` file with frontmatter:

```markdown
---
name: my-skill
description: What this skill does
---

# My Skill

## Usage

Explain how to use it...
```

3. Add your scripts (e.g., `run.js`, `index.py`)

Vito will discover the skill automatically.

## Personalizing Vito

Edit `~/vito/profile.json` to teach Vito about yourself:

```json
{
  "user": {
    "name": "Your Name",
    "email": "you@example.com",
    "timezone": "America/New_York"
  },
  "preferences": {
    "communication": ["Keep responses concise", "No emojis"],
    "code": ["TypeScript preferred", "Use Tailwind CSS"]
  },
  "work": {
    "title": "Software Engineer",
    "company": "Acme Corp"
  }
}
```

Edit `~/vito/SOUL.md` to change Vito's personality. Make it your own!

## Channels

Vito can connect to multiple channels:
- **Dashboard** (built-in) — Web interface at localhost:3000
- **Discord** — Add bot token to secrets.json
- **Telegram** — Add bot token to secrets.json

Configure in `~/vito/vito.config.json`:

```json
{
  "channels": {
    "dashboard": { "enabled": true },
    "discord": { 
      "enabled": true,
      "settings": { "streamMode": "bundled" }
    }
  }
}
```

## Requirements

- Node.js 20+
- ~2GB disk space (includes Playwright browsers)

## License

MIT
