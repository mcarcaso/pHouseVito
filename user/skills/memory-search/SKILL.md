---
name: semantic-history-search
description: Search past conversations by meaning using hybrid semantic + keyword search over embedded memory chunks
---

# Semantic History Search

Search all past conversations by **meaning**, not just exact words. Uses hybrid retrieval: semantic embeddings + FTS5 BM25 keyword search, merged via Reciprocal Rank Fusion. Backed by `user/embeddings.db`.

## When to Use

Use this skill when:
- You need to **recall what was discussed** about a topic — "what did we talk about regarding X?"
- The user says "remember when we..." or "what did we decide about..."
- Auto-recalled memories (`<recalled-memories>`) aren't enough and you need to **dig deeper**
- You need to find **decisions, context, or reasoning** from older conversations
- You're looking for something **conceptual** — you know the idea but not the exact words

**Don't use this for:** Exact timestamps, message counts, full session dumps, or structured queries — that's `keyword-history-search`.

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
- **Scores** — RRF (combined), Embedding (semantic), BM25 (keyword)
- **Session + Day** — where and when the conversation happened
- **Context** — AI-generated summary of the chunk's topic
- **Text** — the actual conversation transcript

## Tips

- **Hybrid mode** is best for most queries — catches both meaning and exact keywords
- **BM25 mode** is fastest and best for exact terms (names, technical terms, specific phrases)
- **Embedding mode** is best for fuzzy/conceptual queries where you don't know the exact words
- Each chunk covers ~8K chars (~30-50 messages) — results give solid context windows
- Higher RRF score = more relevant. Anything above 0.01 is a strong signal
