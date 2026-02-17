# Vito Dashboard

A web-based interface for managing and interacting with Vito.

## Features

- 💬 **Chat** - Real-time chat interface with WebSocket connection
- 📋 **Sessions** - Browse all conversation sessions and their message history
- 🧠 **Memories** - View and search long-term memories
- 🛠️ **Skills** - Browse installed skills
- ⏰ **Jobs** - View and manage scheduled cron jobs
- ⚙️ **Settings** - Configure harness, channels, and per-session overrides

## Development

```bash
# Install dependencies
npm install

# Run development server (with hot reload)
npm run dev

# Build for production
npm run build
```

## Production

The dashboard is built and served automatically when you run Vito:

```bash
npm start
```

Then open http://localhost:3030 in your browser.

## Tech Stack

- React 18
- TypeScript
- Vite
- WebSocket for real-time communication
- Express for API endpoints
