---
name: apps
description: Create, deploy, and manage web apps accessible via Cloudflare tunnel at <name>.theworstproductions.com
---

# Apps Skill

Create and deploy web apps using ANY technology stack — static HTML, React, Node.js, Python, Astro, whatever the job calls for. Apps are served locally and exposed to the public internet via Cloudflare tunnel.

## Architecture

- **App directory:** `user/apps/<name>/` — each deployed app gets its own folder
- **Metadata:** `.vito-app.json` in each app folder (name, description, port, URL, createdAt)
- **PM2 tracking:** Each app registered as `app-<name>` in PM2
- **Cloudflare tunnel:** Adds ingress entry to `~/.cloudflared/config.yml`, restarts tunnel
- **DNS Records:** Created automatically via `cloudflared tunnel route dns` command for each app
- **Ports:** Auto-assigned starting from 3100, scanned from tunnel config to avoid conflicts
- **Dashboard:** Apps page (`/apps`) reads metadata + PM2 status via `GET /api/apps`

## Lifecycle

- **create_app:** Writes files → installs deps → starts server → adds tunnel entry → restarts cloudflared
- **delete_app:** Stops PM2 process → removes tunnel entry → deletes files → restarts cloudflared
- **Updates:** If app name already exists, files are overwritten and server is restarted

## When to Use

Use this skill when you need to:
- Create a new website or web app
- Deploy anything from a simple page to a full-stack app
- List or manage existing deployed apps
- Remove an app from deployment

## Guidelines for Creating Apps

**Choose the right technology for the job:**
- Simple landing page → plain HTML/CSS/JS (no build step needed)
- Interactive SPA → include a `server.js` that serves built files (bundle everything, don't rely on build steps)
- API/backend needed → Node.js `server.js` or Python `server.py`
- Complex app → Node.js with Express, include all dependencies inline or use a `package.json`

**Server conventions:**
- **Node.js apps**: Include a `server.js` that accepts `--port <port>` flag
- **Python apps**: Include a `server.py` that accepts `--port <port>` flag
- **Static sites**: Just HTML/CSS/JS files — a static file server is used automatically
- If the app has a `package.json`, `npm install` is run automatically before starting
- If the app has a `requirements.txt`, `pip install` is run automatically before starting

**Important:**
- Don't rely on build steps (no `npm run build` during deploy) — ship ready-to-run code
- For React-style apps, use self-contained approaches (CDN imports, single-file bundles)
- The server MUST listen on the port passed via `--port` flag
- Keep app names short, lowercase, URL-friendly (letters, numbers, hyphens)
- **No caching by default** — add a `serve.json` file to disable caching:
  ```json
  {
    "headers": [
      { "source": "**/*", "headers": [{ "key": "Cache-Control", "value": "no-cache, no-store, must-revalidate" }] }
    ]
  }
  ```
  This ensures updates are live immediately without waiting for Cloudflare cache to expire.

**App Icons:**
If you have access to an image generation skill (like `gemini-image`), generate icons for the app:

1. **Generate the icon** after the app is created (so you have a directory to save to):
   ```bash
   ~/vito3.0/user/skills/gemini-image/generate.py "your icon description" -o ~/vito3.0/user/apps/<name>/icon-180.png
   ```

2. **Resize for both sizes** using sips:
   ```bash
   cd ~/vito3.0/user/apps/<name>
   sips -z 180 180 icon-180.png  # resize to 180x180 for iOS
   cp icon-180.png icon-full.png && sips -z 32 32 icon-full.png --out icon-32.png && rm icon-full.png
   ```

3. **Add meta tags to the HTML** (in the `<head>`):
   ```html
   <link rel="icon" type="image/png" href="icon-32.png">
   <link rel="apple-touch-icon" href="icon-180.png">
   <meta name="apple-mobile-web-app-capable" content="yes">
   <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
   <meta name="apple-mobile-web-app-title" content="App Name">
   ```

**Important:** Use unique filenames like `icon-180.png` and `icon-32.png` instead of generic names like `apple-touch-icon.png` or `favicon.png`. Cloudflare aggressively caches these common filenames, and if they get cached with wrong content-type (e.g., from SPA mode routing), you'll be stuck waiting hours for cache to expire.

## Tools

### create_app
Creates app with provided files, installs deps, starts server, adds Cloudflare entry.
- Updates existing apps if the name already exists (restarts server after update)

### list_apps
Lists all deployed apps with URLs, ports, and PM2 status.

### delete_app
Stops server, removes PM2 process, removes Cloudflare entry, deletes files.

## Examples

- "Create a portfolio website" → static HTML/CSS/JS
- "Build a todo app" → React via CDN + static serve
- "Make an API that returns random quotes" → Node.js Express server
- "Create a URL shortener" → Node.js with SQLite backend
- "Build a Python Flask dashboard" → Python server.py

## File Structure

```
user/apps/
├── my-portfolio/
│   ├── .vito-app.json    (metadata — port, url, description)
│   ├── index.html
│   ├── style.css
│   └── script.js
├── my-api/
│   ├── .vito-app.json
│   ├── server.js
│   └── package.json
├── my-flask-app/
│   ├── .vito-app.json
│   ├── server.py
│   └── requirements.txt
```
