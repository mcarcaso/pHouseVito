---
name: playwright
description: Browse the web, take screenshots, and extract content from web pages using Playwright MCP
mcp:
  transport: stdio
  command: ./node_modules/.bin/playwright-mcp
  args: ["--headless", "--viewport-size", "1280x720", "--output-dir", "user/drive/screenshots"]
  allowTools:
    - browser_close
    - browser_resize
    - browser_console_messages
    - browser_handle_dialog
    - browser_evaluate
    - browser_file_upload
    - browser_drop
    - browser_fill_form
    - browser_press_key
    - browser_type
    - browser_navigate
    - browser_navigate_back
    - browser_network_requests
    - browser_network_request
    - browser_run_code_unsafe
    - browser_take_screenshot
    - browser_snapshot
    - browser_click
    - browser_drag
    - browser_hover
    - browser_select_option
    - browser_tabs
    - browser_wait_for
  timeoutMs: 60000
  maxOutputBytes: 100000
---

# Playwright Browser Skill

Primary browser automation now runs through **Playwright MCP** via the generic MCP client.

Use this skill when you need to:
- Read JavaScript-rendered pages
- Take screenshots
- Interact with pages/forms
- Inspect console/network traffic
- Extract content via snapshots or evaluation

## Discover Tools

```bash
node src/skills/builtin/mcp-client/mcp-client.mjs list src/skills/builtin/playwright/SKILL.md
```

Inspect a tool:

```bash
node src/skills/builtin/mcp-client/mcp-client.mjs schema src/skills/builtin/playwright/SKILL.md browser_navigate
```

## One-Shot Calls

Navigation returns page metadata and a snapshot:

```bash
node src/skills/builtin/mcp-client/mcp-client.mjs call src/skills/builtin/playwright/SKILL.md browser_navigate '{"url":"https://example.com"}'
```

## Multi-Step Browser Sessions

Use `batch` when page state matters. It keeps one MCP browser connection alive for all steps.

```bash
node src/skills/builtin/mcp-client/mcp-client.mjs batch src/skills/builtin/playwright/SKILL.md '[
  {"tool":"browser_navigate","args":{"url":"https://example.com"}},
  {"tool":"browser_snapshot","args":{}},
  {"tool":"browser_take_screenshot","args":{"filename":"example.png","fullPage":true}}
]'
```

Screenshots/output files are written under `user/drive/screenshots/` by the MCP server. Share with `MEDIA:/absolute/path` when needed.

## Safety

- `browser_run_code_unsafe` is allowlisted because Mike wants full-power browser automation available when needed.
- Treat `browser_run_code_unsafe` as RCE-equivalent: use it deliberately, keep snippets tight, and do not use it for real-world actions unless Mike explicitly asks.
- Use `browser_evaluate` for page-context extraction when that is enough.
- For purchases, messages, bookings, form submissions to real people/businesses, or account changes: stop and confirm first.

## Legacy Wrapper

The old local wrapper still exists at `user/skills/playwright/index.js` for fallback/debugging, but prefer MCP for new work.
