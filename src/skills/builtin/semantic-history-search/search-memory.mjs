#!/usr/bin/env node

/**
 * CLI tool for searching long-term memory (embeddings).
 *
 * Usage:
 *   node src/skills/builtin/semantic-history-search/search-memory.mjs "what's Mike's mom's name"
 *   node src/skills/builtin/semantic-history-search/search-memory.mjs "DCA strategy" --limit 3
 *   node src/skills/builtin/semantic-history-search/search-memory.mjs "shoulder rehab" --session telegram:5473044160
 *   node src/skills/builtin/semantic-history-search/search-memory.mjs "Norma" --mode bm25
 *
 * Modes: hybrid (default), embedding, bm25
 *
 * This is a thin CLI wrapper around the shared searchMemory() function.
 */

import { searchMemory } from "../../../../dist/memory/search.js";

// ── Args ───────────────────────────────────────────────────

const args = process.argv.slice(2);
const query = args.find((a) => !a.startsWith("--"));
const limit = args.includes("--limit") ? parseInt(args[args.indexOf("--limit") + 1]) : 5;
const sessionFilter = args.includes("--session") ? args[args.indexOf("--session") + 1] : null;
const mode = args.includes("--mode") ? args[args.indexOf("--mode") + 1] : "hybrid";

if (!query) {
  console.log('Usage: node src/skills/builtin/semantic-history-search/search-memory.mjs "your search query" [--limit N] [--session id] [--mode hybrid|embedding|bm25]');
  process.exit(1);
}

// ── Main ───────────────────────────────────────────────────

async function main() {
  console.log(`🔍 Searching: "${query}" (mode: ${mode}, limit: ${limit})`);
  if (sessionFilter) console.log(`   Session filter: ${sessionFilter}`);
  console.log("");

  const results = await searchMemory(query, {
    limit,
    sessionFilter: sessionFilter || undefined,
    mode,
  });

  if (results.length === 0) {
    console.log("No results found.");
    return;
  }

  console.log(`📊 Found ${results.length} results:\n`);

  for (let i = 0; i < results.length; i++) {
    const r = results[i];

    const scoreDetail = mode === "hybrid"
      ? `RRF: ${r.rrfScore.toFixed(6)} | Emb: ${r.embeddingScore.toFixed(4)} (recency-adj) | BM25: ${r.bm25Score.toFixed(4)}`
      : mode === "embedding"
        ? `Similarity: ${r.embeddingScore.toFixed(4)} (recency-adjusted)`
        : `BM25: ${r.bm25Score.toFixed(4)}`;

    console.log(`━━━ #${i + 1} — ${scoreDetail} ━━━`);
    console.log(`📍 Session: ${r.sessionId} | Day: ${r.day} | Msgs: ${r.msgCount}`);
    if (r.context) console.log(`🧠 ${r.context}`);
    console.log(`\n${r.text.slice(0, 500)}${r.text.length > 500 ? "\n... (truncated)" : ""}\n`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
