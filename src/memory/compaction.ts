import type { Queries } from "../db/queries.js";
import type { VitoConfig } from "../types.js";
import { embed, embedBatch } from "./embeddings.js";

/**
 * Check if compaction should be triggered.
 * Returns true when un-compacted message count exceeds threshold.
 */
export function shouldCompact(queries: Queries, config: VitoConfig): boolean {
  const count = queries.countUncompacted();
  return count > config.memory.compactionThreshold;
}

/**
 * Run LLM-driven memory compaction.
 *
 * 1. Gather all un-compacted messages (short-term across all sessions)
 * 2. Gather all current long-term memories
 * 3. Ask LLM to produce an updated set of memories
 * 4. Replace memories table with new set (re-embed each)
 * 5. Mark processed messages as compacted
 *
 * @param promptLLM - function that sends a prompt to the LLM and returns text response
 */
export async function runCompaction(
  queries: Queries,
  config: VitoConfig,
  promptLLM: (prompt: string) => Promise<string>
): Promise<void> {
  const uncompacted = queries.getAllUncompactedMessages();
  if (uncompacted.length === 0) return;

  const currentMemories = queries.getAllMemories();

  // Build the compaction prompt
  const shortTermSection = uncompacted
    .map((m) => {
      const content = JSON.parse(m.content);
      const text = typeof content === "string" ? content : content.text || "";
      return `[${m.session_id}] ${m.role}: ${text}`;
    })
    .join("\n");

  const memoriesSection =
    currentMemories.length > 0
      ? currentMemories.map((m, i) => `${i + 1}. ${m.content}`).join("\n")
      : "(No existing memories)";

  const prompt = `You are managing your own long-term memory. Below are recent conversations (short-term) and your current long-term memories.

Based on what you see in the short-term conversations, update your long-term memories:
- Add new memories for important information worth remembering
- Update existing memories if new information refines or changes them
- Merge related memories if appropriate
- Remove memories that are no longer relevant
- Keep memories as concise text blobs

Return ONLY the updated list of memories, one per line, prefixed with "- ". No other text.

=== CURRENT LONG-TERM MEMORIES ===
${memoriesSection}

=== RECENT CONVERSATIONS (SHORT-TERM) ===
${shortTermSection}

=== UPDATED MEMORIES ===`;

  const response = await promptLLM(prompt);

  // Parse response into memory strings
  const newMemories = response
    .split("\n")
    .map((line) => line.replace(/^-\s*/, "").trim())
    .filter((line) => line.length > 0);

  if (newMemories.length === 0) return;

  // Embed all new memories
  let embeddings: Buffer[];
  try {
    embeddings = await embedBatch(newMemories, config.embeddings.model);
  } catch {
    // If embedding fails, store without embeddings
    embeddings = newMemories.map(() => null as any);
  }

  // Replace memories table
  const memoriesWithEmbeddings = newMemories.map((content, i) => ({
    content,
    embedding: embeddings[i] || null,
  }));
  queries.replaceAllMemories(memoriesWithEmbeddings);

  // Mark all processed messages as compacted
  const ids = uncompacted.map((m) => m.id);
  queries.markCompacted(ids);
}
