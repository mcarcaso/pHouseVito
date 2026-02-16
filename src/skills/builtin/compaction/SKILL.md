# Memory Compaction Skill

**Description:** Compact recent conversations into long-term memory documents. This skill reads uncompacted messages from the database, merges them with existing memory files, and produces updated memory documents.

## Overview

You manage your own long-term memory. Memories are stored as markdown files in `user/memories/`, each with an UPPERCASE_SNAKE_CASE.md filename (e.g., `MIKE.md`, `PREFERENCES.md`).

When triggered, you'll:
1. Query the database for uncompacted messages
2. Read current memory files from `user/memories/`
3. Analyze the messages and update memories accordingly
4. Write updated memory files

## Database Access

The messages database is at `user/vito.db` (SQLite). Use bash + sqlite3 to query.

**Get uncompacted messages (oldest N):**
```bash
sqlite3 user/vito.db "SELECT id, session_id, type, content, timestamp FROM messages WHERE compacted = 0 ORDER BY timestamp ASC LIMIT 500"
```

**Get uncompacted messages for a specific session:**
```bash
sqlite3 user/vito.db "SELECT id, session_id, type, content, timestamp FROM messages WHERE compacted = 0 AND session_id = 'discord:123456' ORDER BY timestamp ASC"
```

The `content` column is JSON:
- For `user` type: Either a plain string `"message text"` or `{"text": "message text", "attachments": [...]}`
- For `assistant` type: Usually a plain string `"response text"`
- For `tool_start`/`tool_end`: Tool invocation details (can be skipped for memory purposes)

Example to extract readable content:
```bash
sqlite3 -json user/vito.db "SELECT id, session_id, type, content FROM messages WHERE compacted = 0 ORDER BY timestamp ASC LIMIT 100" | jq -r '.[] | "\(.session_id) [\(.type)]: \(.content | fromjson | if type == "string" then . else .text // "" end)"'
```

## Memory File Format

Each memory file in `user/memories/` is a standalone markdown document:
- Filename: `DESCRIPTIVE_NAME.md` (uppercase snake case)
- Content: Rich markdown with all relevant details

Example:
```
# Mike's Preferences

- Prefers direct file/database manipulation over ORMs
- Likes client-side processing where possible
- Values clean, minimal UI
```

## Compaction Rules

When processing messages:
- **Create** new documents for important topics worth remembering
- **Update** existing documents if new information refines or changes them
- **Merge** related documents if they cover the same topic
- **Remove** documents that are no longer relevant
- Keep documents **detailed** — include specifics, not just summaries
- Keep total documents to **10 or fewer** — merge aggressively if needed

## Triggering Compaction

You'll receive a message like:
- "Compact the oldest 500 uncompacted messages" — global compaction
- "Compact all uncompacted messages from session discord:123456" — session-specific

Read the messages, read current memories, write updated memories. That's it.

## Marking Messages as Compacted

**After** you've updated the memory files, mark the messages you processed as compacted:

```bash
sqlite3 user/vito.db "UPDATE messages SET compacted = 1 WHERE id IN (1, 2, 3, 4, 5)"
```

Use the actual message IDs you queried at the start. This prevents them from being processed again.

**Important:** Only mark messages after you've successfully written the updated memory files.

## Important Notes

- Focus only on the session(s) specified in the request
- If there are no uncompacted messages, just say so and exit
