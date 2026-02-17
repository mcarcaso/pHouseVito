---
name: history
description: Search and retrieve old conversation transcripts from the message database
---

# History / Transcript Retrieval

Search and retrieve past conversations from the SQLite database (`user/vito.db`).

## When to Use

Use this skill when:
- The user asks "what did we talk about [time period]?"
- You need to find a past conversation about a specific topic
- The user references something from a previous session
- You need to look up old decisions, code changes, or discussions
- Cross-session context and long-term memories aren't enough

## Database Schema

### messages table
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Auto-increment primary key |
| session_id | TEXT | e.g. `dashboard:default`, `telegram:123456789` |
| channel | TEXT | `dashboard` or `telegram` |
| channel_target | TEXT | `default` or telegram chat ID |
| timestamp | INTEGER | Unix epoch in **milliseconds** |
| role | TEXT | `user`, `assistant`, `system`, or `tool` |
| content | JSON | Message content (JSON string — use `json_extract` or just cast) |
| compacted | INTEGER | 1 = compacted (knowledge extracted to memory docs) |
| archived | INTEGER | 1 = archived (old session, fully processed) |

### sessions table
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | Session ID (e.g. `dashboard:default`) |
| channel | TEXT | `dashboard` or `telegram` |
| channel_target | TEXT | Target identifier |
| created_at | INTEGER | Unix epoch ms |
| last_active_at | INTEGER | Unix epoch ms |
| config | JSON | Session-specific config |

## Common Queries

### Search messages by keyword
```sql
SELECT datetime(timestamp/1000, 'unixepoch', 'localtime') as time,
       role, substr(content, 1, 200) as preview
FROM messages
WHERE content LIKE '%keyword%'
  AND role IN ('user', 'assistant')
ORDER BY timestamp DESC
LIMIT 20;
```

### Get conversation from a specific date
```sql
SELECT datetime(timestamp/1000, 'unixepoch', 'localtime') as time,
       role, content
FROM messages
WHERE date(timestamp/1000, 'unixepoch', 'localtime') = '2026-02-13'
  AND role IN ('user', 'assistant')
ORDER BY timestamp ASC;
```

### Get conversation from a time range
```sql
SELECT datetime(timestamp/1000, 'unixepoch', 'localtime') as time,
       role, content
FROM messages
WHERE timestamp BETWEEN strftime('%s', '2026-02-13 09:00:00', 'utc') * 1000
                     AND strftime('%s', '2026-02-13 12:00:00', 'utc') * 1000
  AND role IN ('user', 'assistant')
ORDER BY timestamp ASC;
```

### Get messages from a specific channel
```sql
SELECT datetime(timestamp/1000, 'unixepoch', 'localtime') as time,
       role, substr(content, 1, 200) as preview
FROM messages
WHERE channel = 'telegram'
  AND role IN ('user', 'assistant')
ORDER BY timestamp DESC
LIMIT 30;
```

### Get a summary of activity by date
```sql
SELECT date(timestamp/1000, 'unixepoch', 'localtime') as day,
       COUNT(*) as msg_count,
       COUNT(DISTINCT session_id) as sessions
FROM messages
WHERE role IN ('user', 'assistant')
GROUP BY day
ORDER BY day DESC;
```

### Find conversations about a topic (with surrounding context)
First find matching message IDs, then grab nearby messages:
```sql
-- Step 1: Find matching messages
SELECT id, session_id, timestamp
FROM messages
WHERE content LIKE '%topic%' AND role IN ('user', 'assistant');

-- Step 2: Get context around a match (±10 messages in same session)
SELECT datetime(timestamp/1000, 'unixepoch', 'localtime') as time,
       role, content
FROM messages
WHERE session_id = 'SESSION_ID_HERE'
  AND id BETWEEN (MATCH_ID - 10) AND (MATCH_ID + 10)
  AND role IN ('user', 'assistant')
ORDER BY timestamp ASC;
```

## How to Execute Queries

Use the Bash tool with sqlite3:
```bash
sqlite3 user/vito.db "YOUR QUERY HERE"
```

For multi-line or complex queries:
```bash
sqlite3 user/vito.db <<'EOF'
SELECT ...
FROM ...
WHERE ...;
EOF
```

## Tips

- **Timestamps are in milliseconds** — divide by 1000 for unix seconds
- Use `datetime(timestamp/1000, 'unixepoch', 'localtime')` for readable times
- **content is a JSON string** — for user/assistant messages it's typically just a quoted string. For tool calls it's a JSON array.
- Filter `role IN ('user', 'assistant')` to skip tool calls/system messages (unless specifically needed)
- Use `substr(content, 1, 200)` for previews to avoid dumping huge messages
- **Don't dump entire conversations raw** — summarize what you find for the user
- When presenting results, give a concise summary with key points, not a wall of text
- If a search returns too many results, narrow by date range or session
