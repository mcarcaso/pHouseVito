---
name: memory-search
description: Search long-term memory (conversation history embeddings) with hybrid semantic + keyword search
---

# Memory Search

Search Vito's long-term memory — all past conversations stored as embedded chunks in `user/embeddings.db`. Uses hybrid retrieval: semantic embeddings + FTS5 BM25 keyword search, merged via Reciprocal Rank Fusion.

## When to Use

Use this skill when:
- You need to recall a past conversation about a specific topic
- The user asks "what did we discuss about X?" or "remember when we talked about Y?"
- Auto-recalled memories (injected via `<recalled-memories>`) aren't enough and you need to dig deeper
- You need to find specific details, decisions, or context from older sessions
- Cross-session snippets don't go far enough back

**Note:** This skill complements the automatic memory search that runs on every message. The auto-search injects top 3 results passively. Use this skill for targeted, deeper searches with more control over parameters.

## Usage

```bash
node user/scripts/search-memory.mjs "your search query" [--limit N] [--session id] [--mode hybrid|embedding|bm25]
```

**Arguments:**
- First arg: Search query (required) — natural language works best
- `--limit N`: Number of results (optional, default: 5)
- `--session id`: Filter to a specific session (e.g., `discord:general`, `telegram:5473044160`)
- `--mode`: Search mode (optional, default: `hybrid`)
  - `hybrid` — combines semantic + keyword (best for most queries)
  - `embedding` — pure semantic similarity (good for conceptual/fuzzy queries)
  - `bm25` — pure keyword match (good for exact names, terms, identifiers)

## Examples

```bash
# Find conversations about shoulder rehab
node user/scripts/search-memory.mjs "shoulder rehab exercises"

# Search for a specific person
node user/scripts/search-memory.mjs "Norma" --mode bm25

# Deep dig into a topic with more results
node user/scripts/search-memory.mjs "DCA investment strategy QQQ" --limit 10

# Search within a specific channel
node user/scripts/search-memory.mjs "workout programming" --session discord:fitness

# Conceptual search (no exact keywords needed)
node user/scripts/search-memory.mjs "that time we built the phone calling feature" --mode embedding
```

## Output

Returns ranked results with:
- **Scores** — RRF (combined), Embedding (semantic similarity), BM25 (keyword relevance)
- **Session + Day** — where and when the conversation happened
- **Context** — AI-generated summary of the chunk's topic
- **Text** — the actual conversation transcript (truncated to 500 chars in CLI output)

## Tips

- **Hybrid mode** is best for most queries — it catches both semantic meaning and exact keyword matches
- **BM25 mode** is fastest and best when you know the exact term (names, technical terms, specific phrases)
- **Embedding mode** is best for fuzzy/conceptual queries where you don't know the exact words used
- Results are scored — higher RRF = more relevant. Anything above 0.01 is a strong signal
- Each chunk covers ~8K chars of conversation (~30-50 messages), so results give you solid context windows
