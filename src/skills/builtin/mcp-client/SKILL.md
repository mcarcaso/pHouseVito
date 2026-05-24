---
name: mcp-client
description: Generic MCP client bridge for skills — discover and call tools from MCP servers declared in SKILL.md frontmatter or passed as URLs
---

# MCP Client

Use this skill when another skill declares an `mcp:` block, or when you need to inspect/call a remote/stdIO MCP server without wiring it globally into Vito.

This is a **generic MCP bridge**. Individual skills should declare where to connect; this skill discovers the current tool list live via MCP `tools/list`, so tool schemas can evolve without stale docs.

## Supported MCP Config

In another skill's `SKILL.md` frontmatter:

```yaml
---
name: tavily
description: Web research through Tavily MCP
mcp:
  transport: http              # http | streamable-http | stdio
  url: https://mcp.example.com/mcp?apiKey=${API_KEY}
  # Optional safety/config:
  allowToolPrefix: tavily_     # optional; soft safety fence for calls
  timeoutMs: 30000             # optional; default 30000, max 120000
  maxOutputBytes: 50000        # optional; default 50000
---
```

For stdio servers:

```yaml
mcp:
  transport: stdio
  command: npx
  args: ["-y", "@vendor/mcp-server"]
  env:
    API_KEY: ${API_KEY}
```

Secrets are resolved from `process.env` first, then `user/secrets.json`. Never hardcode raw secrets in skill files.

## Commands

```bash
node src/skills/builtin/mcp-client/mcp-client.mjs list <skill-md-or-url-or-dir>
node src/skills/builtin/mcp-client/mcp-client.mjs call <skill-md-or-url-or-dir> <tool_name> '<json_args>'
node src/skills/builtin/mcp-client/mcp-client.mjs schema <skill-md-or-url-or-dir> <tool_name>
```

Aliases:
- `tools` = `list`
- `invoke` = `call`

## Examples

Discover tools from a skill with an `mcp:` block:

```bash
node src/skills/builtin/mcp-client/mcp-client.mjs list user/skills/tavily/SKILL.md
```

Call a discovered tool:

```bash
node src/skills/builtin/mcp-client/mcp-client.mjs call user/skills/tavily/SKILL.md tavily_search '{"query":"Forrest Frank Nashville GEODIS Park tickets","max_results":5}'
```

Use a raw remote MCP URL directly:

```bash
node src/skills/builtin/mcp-client/mcp-client.mjs list 'https://mcp.example.com/mcp?apiKey=${API_KEY}'
```

## Output

- `list` returns current tool names, descriptions, and input schemas.
- `schema` returns one tool's input schema.
- `call` returns the MCP tool result content as JSON, with text/resource/image blocks preserved.

## Safety Rules

- Always run `list` before the first `call` unless you just listed tools in the same task.
- If the target skill declares `allowTools` or `allowToolPrefix`, respect it.
- Keep outputs capped. If output is truncated, narrow the query or call a more specific tool.
- For tools that send messages, emails, calls, payments, bookings, account changes, or other real-world actions: confirm with Mike first.
- Do not use untrusted MCP URLs unless Mike explicitly approves the server.
