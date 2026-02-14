import type { Queries } from "../db/queries.js";
import type { VitoConfig } from "../types.js";
import { embedBatch } from "./embeddings.js";

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
  const allUncompacted = queries.getAllUncompactedMessages();
  if (allUncompacted.length === 0) return;

  // Only compact the oldest half — keep the recent half in context
  const half = Math.ceil(allUncompacted.length / 2);
  const uncompacted = allUncompacted.slice(0, half);
  console.log(`[Compaction] Compacting oldest ${uncompacted.length} of ${allUncompacted.length} messages`);

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
      ? currentMemories.map((m) => `### ${m.title}\n${m.content}`).join("\n\n")
      : "(No existing memories)";

  const prompt = `You are managing your own long-term memory. Your memories are stored as markdown documents, each with a TITLE (like a filename, e.g. PLAYWRIGHT_SKILL.md) and a BODY (rich text with all the details).

Based on the short-term conversations below, update your memory documents:
- Create new documents for important topics worth remembering
- Update existing documents if new information refines or changes them
- Merge related documents if they cover the same topic
- Remove documents that are no longer relevant
- Each document should have a descriptive UPPERCASE_SNAKE_CASE.md title
- The body should be detailed — include specifics, not just summaries
- Group related information into the same document
- IMPORTANT: Keep the total number of documents to 10 or fewer. Merge aggressively if needed to stay within this limit.

Return ONLY the updated documents in this exact format (no other text):

### EXAMPLE_TITLE.md
Body text here with all the details...

### ANOTHER_TITLE.md
Another body with details...

=== CURRENT MEMORY DOCUMENTS ===
${memoriesSection}

=== RECENT CONVERSATIONS (SHORT-TERM) ===
${shortTermSection}

=== UPDATED MEMORY DOCUMENTS ===`;

  const response = await promptLLM(prompt);

  // Parse response into title/body pairs
  const newMemories: Array<{ title: string; content: string }> = [];
  const sections = response.split(/^### /m).filter((s) => s.trim().length > 0);
  for (const section of sections) {
    const lines = section.split("\n");
    const title = lines[0].trim();
    const body = lines.slice(1).join("\n").trim();
    if (title && body) {
      newMemories.push({ title, content: body });
    }
  }

  if (newMemories.length === 0) return;

  // Embed new memories if embeddings are configured (embed title + body together)
  const textsToEmbed = newMemories.map((m) => `${m.title}\n${m.content}`);
  let embeddings: (Buffer | null)[];
  if (process.env.OPENAI_API_KEY) {
    try {
      embeddings = await embedBatch(textsToEmbed, config.embeddings.model);
    } catch {
      embeddings = newMemories.map(() => null);
    }
  } else {
    embeddings = newMemories.map(() => null);
  }

  // Replace memories table
  const memoriesWithEmbeddings = newMemories.map((mem, i) => ({
    title: mem.title,
    content: mem.content,
    embedding: embeddings[i] || null,
  }));
  queries.replaceAllMemories(memoriesWithEmbeddings);

  // Mark all processed messages as compacted
  const ids = uncompacted.map((m) => m.id);
  queries.markCompacted(ids);
}
