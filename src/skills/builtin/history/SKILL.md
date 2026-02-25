---
name: keyword-history-search
description: Search and retrieve exact messages from the conversation database using SQL queries — timestamps, keywords, sessions, counts
---

# Keyword History Search

Direct SQL queries against the messages database (`user/vito.db`). Use this for **precise, exact** lookups — not fuzzy meaning-based recall.

## When to Use

Use this skill when:
- You need messages from a **specific date or time range**
- You need an **exact keyword or phrase** match
- You need to **count** messages, sessions, or activity
- You need to **browse a full session** transcript chronologically
- You need to **look up a specific session ID** or channel
- You need **structured data** (aggregations, groupings, date breakdowns)

**Don't use this for:** "What did we talk about regarding X?" — that's `semantic-history-search`.

## Database Schema

### messages table
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Auto-increment primary key |
| session_id | TEXT | e.g. `dashboard:default`, `telegram:123456789` |
| channel | TEXT | `dashboard`, `telegram`, or `discord` |
| channel_target | TEXT | `default`, telegram chat ID, or discord channel ID |
| timestamp | INTEGER | Unix epoch in **milliseconds** |
| role | TEXT | `user`, `assistant`, `system`, or `tool` |
| content | JSON | Message content (JSON string — use `json_extract` or just cast) |
| compacted | INTEGER | 1 = compacted (knowledge extracted to memory docs) |
| archived | INTEGER | 1 = archived (old session, fully processed) |

### sessions table
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | Session ID (e.g. `dashboard:default`) |
| channel | TEXT | `dashboard`, `telegram`, or `discord` |
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

## How to Execute

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
- **content is a JSON string** — for user/assistant messages it's typically just a quoted string
- Filter `role IN ('user', 'assistant')` to skip tool calls/system messages
- Use `substr(content, 1, 200)` for previews to avoid dumping huge messages
- **Summarize results** for the user — don't dump raw SQL output
