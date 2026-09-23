# Discord

Discord is a core pHouseVito channel. Allowed guilds and channels remain configured under `channels.discord`.

## Reliability

- Invoking messages are inserted into the main SQLite database before execution.
- Each Discord conversation drains in snowflake order and shares the global per-session turn lease with dashboard and Jobs.
- Pending messages survive restart. A turn that was active when the process stopped is marked interrupted and is **not** replayed blindly.
- Outbound text chunks and attachments use deterministic Discord nonces plus durable piece receipts. Completed pieces are not sent twice.
- Responses split below Discord's 2,000-character limit while preserving fenced code blocks.
- A `MEDIA:/absolute/path` marker on its own line sends a regular file up to 20 MiB. Paths may contain spaces.
- Tool progress is sanitized to the tool name, links to the exact dashboard conversation, and is removed when authoritative output arrives.
- Mentioned guild turns include a bounded native Discord context window since Vito's previous response. Omitted messages are reported, not invented.

## Deterministic controls

- `/new` — archive dashboard chat and start a fresh Pi session
- `/session [id]` — list or resume a persisted Pi session belonging to this conversation
- `/compact` — compact the active Pi session
- `/model [provider/model]` — inspect or persist this session's model override
- `/login [provider]` — begin provider authorization; defaults to `openai-codex`
- `/stop` — abort active work and clear queued invocations
- `/status` — show session, model, and durable queue state
- `/help` — show controls
- `/restart` — owner-only supervised Vito restart; never reboots the host

These commands bypass model interpretation. `/stop` and `/restart` bypass the ordinary conversation queue so they remain available during active work. The Discord application owner is authorized automatically. Optional additional owner IDs may be configured in `channels.discord.ownerIds`.

Set `VITO_DASHBOARD_URL` when the dashboard base URL differs from the existing pHouse default. Progress links use `/chat/<encoded-session-id>` and open the authoritative dashboard conversation, not a separate trace viewer.
