import type { Queries } from "../db/queries.js";
import type { MessageRow, VitoConfig } from "../types.js";
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, unlinkSync } from "fs";
import { join } from "path";

const MEMORIES_DIR = join(process.cwd(), "user", "memories");

/**
 * Check if compaction should be triggered.
 * Returns true when un-compacted message count exceeds threshold.
 */
export function shouldCompact(queries: Queries, config: VitoConfig): boolean {
  const count = queries.countUncompacted();
  return count > config.memory.compactionThreshold;
}

/** Read all memory docs from user/memories/*.md */
function readMemoryFiles(): Array<{ title: string; content: string }> {
  if (!existsSync(MEMORIES_DIR)) return [];
  const files = readdirSync(MEMORIES_DIR).filter((f) => f.endsWith(".md"));
  return files.map((f) => ({
    title: f,
    content: readFileSync(join(MEMORIES_DIR, f), "utf-8"),
  }));
}

/** Write memory docs to user/memories/ — replaces all existing files */
function writeMemoryFiles(memories: Array<{ title: string; content: string }>): void {
  mkdirSync(MEMORIES_DIR, { recursive: true });

  // Remove existing .md files
  if (existsSync(MEMORIES_DIR)) {
    const existing = readdirSync(MEMORIES_DIR).filter((f) => f.endsWith(".md"));
    for (const f of existing) {
      unlinkSync(join(MEMORIES_DIR, f));
    }
  }

  // Write new files
  for (const mem of memories) {
    writeFileSync(join(MEMORIES_DIR, mem.title), mem.content);
  }
}

/**
 * Core compaction logic — takes a set of messages, current memory files,
 * and produces updated memory docs as files. Marks processed messages as compacted.
 *
 * This is the shared engine used by both:
 * - Global threshold-based compaction (oldest half of all un-compacted)
 * - Session-scoped compaction via /new (all un-compacted in a session)
 */
async function compactMessages(
  queries: Queries,
  messages: MessageRow[],
  promptLLM: (prompt: string) => Promise<string>
): Promise<void> {
  if (messages.length === 0) return;

  const currentMemories = readMemoryFiles();

  // Build the compaction prompt
  const shortTermSection = messages
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

  // Write memory docs as files (no embeddings, no DB)
  writeMemoryFiles(newMemories);

  // Mark all processed messages as compacted
  const ids = messages.map((m) => m.id);
  queries.markCompacted(ids);
}

/**
 * Run global threshold-based compaction.
 * Takes the oldest half of all un-compacted messages across all sessions.
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
  const toCompact = allUncompacted.slice(0, half);
  console.log(`[Compaction] Compacting oldest ${toCompact.length} of ${allUncompacted.length} messages`);

  await compactMessages(queries, toCompact, promptLLM);
}

/**
 * Run session-scoped compaction (used by /new command).
 * Compacts all un-compacted messages in a specific session.
 */
export async function runSessionCompaction(
  queries: Queries,
  sessionId: string,
  promptLLM: (prompt: string) => Promise<string>
): Promise<void> {
  const uncompacted = queries.getUncompactedMessagesForSession(sessionId);
  if (uncompacted.length === 0) return;

  console.log(`[Compaction] Session compaction: ${uncompacted.length} messages for ${sessionId}`);
  await compactMessages(queries, uncompacted, promptLLM);
}
