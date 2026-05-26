# Agent Recommendations

Recommended add-ons for another Vito/user-agent setup. Keep this file intentionally short.

## 1. Daily Profile Updating

Use a scheduled prompt job to keep `user/profile.md` fresh without adding new scheduler plumbing.

Add to `user/vito.config.json` under `cron.jobs` and adjust `session` / `timezone`:

```json
{
  "name": "profile-discovery-daily",
  "schedule": "0 7 * * *",
  "timezone": "America/Toronto",
  "session": "dashboard:default",
  "oneTime": false,
  "prompt": "Vito, run the profile-discovery skill for the last 24 hours. Read user/skills/profile-discovery/SKILL.md, src/skills/builtin/profile-maintenance/SKILL.md, and user/profile.md first. Use the adaptive raw-vs-semantic process. Apply only high-confidence durable profile updates directly to user/profile.md. Keep the final report short: applied edits, skipped/uncertain candidates, or no changes. Do not create extra report files unless needed."
}
```

Recommended supporting skill:

```text
user/skills/profile-discovery/SKILL.md
```

The skill should:
- count recent message volume
- use raw transcript mode when manageable
- use semantic probes when the day is too large
- verify candidates against exact messages
- edit only high-confidence durable facts
- keep the profile lean

## 2. Tavily Web Search Skill

Add a user skill for current web search and URL extraction through Tavily.

Recommended path:

```text
user/skills/web-search/
```

Recommended MCP-backed `SKILL.md`:

```markdown
---
name: web-search
description: Search and research the web using Tavily MCP — live tool discovery plus search/extract/map/crawl/research
mcp:
  transport: http
  url: https://mcp.tavily.com/mcp/?tavilyApiKey=${TAVILY_API_KEY}
  allowToolPrefix: tavily_
  timeoutMs: 45000
  maxOutputBytes: 75000
---

# Web Search

Use Tavily through the built-in `mcp-client` skill.

## Discover Tools

\`\`\`bash
node src/skills/builtin/mcp-client/mcp-client.mjs list user/skills/web-search/SKILL.md
\`\`\`

## Search

\`\`\`bash
node src/skills/builtin/mcp-client/mcp-client.mjs call user/skills/web-search/SKILL.md tavily_search '{"query":"your search query","max_results":5,"search_depth":"basic"}'
\`\`\`

## Extract URL

\`\`\`bash
node src/skills/builtin/mcp-client/mcp-client.mjs call user/skills/web-search/SKILL.md tavily_extract '{"urls":["https://example.com"],"extract_depth":"basic","format":"markdown"}'
\`\`\`

## Notes

Requires `TAVILY_API_KEY` in `user/secrets.json` or environment.
```

## 3. OpenRouter Image Generator Skill

Add a user skill for image generation through OpenRouter using Gemini/Nano Banana.

Recommended path:

```text
user/skills/openrouter-image/
```

Recommended model:

```text
google/gemini-3.1-flash-image-preview
```

Recommended `SKILL.md`:

```markdown
---
name: openrouter-image
description: Generate images through OpenRouter using Gemini 3.1 Flash Image / Nano Banana
---

# OpenRouter Image

Generate images with OpenRouter.

## Usage

\`\`\`bash
node user/skills/openrouter-image/generate.mjs "prompt text" --out user/drive/images/generated/image.png
\`\`\`

## Defaults

- Model: \`google/gemini-3.1-flash-image-preview\`
- Requires: \`OPENROUTER_API_KEY\` in \`user/secrets.json\`
- Save generated images under \`user/drive/images/\`

## Safety

- Do not generate images of real private people unless the user explicitly asks and provides/approves the source.
- For images sent to other people, confirm before sending.
```

Recommended CLI behavior:
- read `OPENROUTER_API_KEY` from `user/secrets.json` or env
- accept prompt as CLI arg or `--prompt-file`
- write output file to `user/drive/images/...`
- print only the final absolute file path so the agent can share it with `MEDIA:/absolute/path`
