/**
 * INCREMENTAL EMBEDDINGS
 * 
 * Fires after every assistant message. Checks if there are enough
 * unembedded messages in the session to form a chunk (≥2K chars).
 * If so, chunks them (2-4K per chunk), generates a contextual sentence,
 * embeds, and stores in embeddings.db.
 * 
 * Chunking strategy:
 * - MIN_CHUNK_CHARS (2K): minimum buffer size before emitting a chunk
 * - MAX_CHUNK_CHARS (4K): hard cap — if adding a message would exceed this, emit first
 * - Typical chunk: 2-4K chars (~5-15 messages), topically focused
 * 
 * - Global lock ensures only one embedding job runs at a time
 * - Fire-and-forget — never blocks the response
 * - Uses the same chunking/embedding logic as the backfill scripts
 */

import { completeSimple, getModel } from "@earendil-works/pi-ai/compat";
import { AuthStorage } from "@earendil-works/pi-coding-agent";
import type { Context } from "../../context/Context.js";
import { xEmbeddingService, xEmbeddingStore, xMessageStore } from "../../lib/x.js";

// ── Config ─────────────────────────────────────────────────

const MIN_CHUNK_CHARS = 2000;  // Start chunking when buffer hits this
const MAX_CHUNK_CHARS = 4000;  // Hard cap per chunk
const ASSISTANT_LABEL = "assistant";
/** Default model used to write the per-chunk context sentence. */
const DEFAULT_CONTEXTUAL_MODEL = { provider: "openrouter", name: "openai/gpt-5.4-nano" };


// ── Message Formatting (mirrors chunker.mjs) ───────────────

function formatDateHeader(ts: number): string {
  const d = new Date(ts);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${days[d.getDay()]} ${months[d.getMonth()]} ${d.getDate()} ${d.getFullYear()}`;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function extractText(contentRaw: string): string {
  try {
    const content = JSON.parse(contentRaw);
    if (typeof content === "string") return content;
    let text = content.text || "";
    if (Array.isArray(content.attachments)) {
      for (const a of content.attachments) {
        const ref = a.path || a.filename || a.url || "(attachment)";
        text += `\n[Attached ${a.type}: ${ref}]`;
      }
    }
    return text;
  } catch {
    return String(contentRaw);
  }
}

interface RawMessage {
  id: number;
  session_id: string;
  timestamp: number;
  type: string;
  content: string;
  author: string | null;
}

function formatMessageLine(msg: RawMessage): string {
  const time = formatTime(msg.timestamp);
  const role = msg.type === "assistant" ? ASSISTANT_LABEL : "user";
  const authorPrefix = msg.type === "user" && msg.author ? `${msg.author}: ` : "";
  const text = extractText(msg.content);
  return `[${time}] ${role}: ${authorPrefix}${text}`;
}

// ── Chunking Logic ─────────────────────────────────────────

interface ChunkCandidate {
  text: string;
  messages: RawMessage[];
  day: string;
  chunkIndex: number;
}

/**
 * Given a list of messages (already sorted by timestamp), produce chunks.
 * Groups by day, then splits using MIN/MAX char thresholds:
 *   - If adding a message would exceed MAX_CHUNK_CHARS (4K), emit the current buffer
 *   - After all messages, emit the remaining buffer if it's >= MIN_CHUNK_CHARS (2K)
 *   - Leftover messages under MIN are left dangling for next time
 */
function produceCompleteChunks(
  messages: RawMessage[],
  existingChunkCount: Map<string, number>,
  forceEmitRemainder = false
): ChunkCandidate[] {
  if (messages.length === 0) return [];

  // Group by day
  const dayGroups = new Map<string, RawMessage[]>();
  for (const msg of messages) {
    const day = new Date(msg.timestamp).toLocaleDateString("en-CA"); // YYYY-MM-DD
    if (!dayGroups.has(day)) dayGroups.set(day, []);
    dayGroups.get(day)!.push(msg);
  }

  const chunks: ChunkCandidate[] = [];

  for (const [day, dayMessages] of dayGroups) {
    const headerLine = formatDateHeader(dayMessages[0].timestamp) + "\n";

    // Figure out the next chunk_index for this session+day
    const dayKey = day;
    let chunkIndex = existingChunkCount.get(dayKey) ?? 0;

    let currentLines = [headerLine];
    let currentLength = headerLine.length;
    let currentMessages: RawMessage[] = [];

    for (const msg of dayMessages) {
      const line = formatMessageLine(msg) + "\n";

      // If adding this message would exceed MAX and we have content, emit first
      if (currentLength + line.length > MAX_CHUNK_CHARS && currentMessages.length > 0) {
        chunks.push({
          text: currentLines.join("").trimEnd(),
          messages: [...currentMessages],
          day,
          chunkIndex: chunkIndex++,
        });

        // Start new chunk with header
        currentLines = [headerLine];
        currentLength = headerLine.length;
        currentMessages = [];
      }

      currentLines.push(line);
      currentLength += line.length;
      currentMessages.push(msg);
    }

    // Emit remaining buffer if it meets the MIN threshold.
    // If under MIN, leave dangling — picked up next time (unless forced).
    if (currentMessages.length > 0 && (currentLength >= MIN_CHUNK_CHARS || forceEmitRemainder)) {
      chunks.push({
        text: currentLines.join("").trimEnd(),
        messages: [...currentMessages],
        day,
        chunkIndex: chunkIndex++,
      });
    }
  }

  // Update the counts for next time
  for (const chunk of chunks) {
    const dayKey = chunk.day;
    existingChunkCount.set(dayKey, (existingChunkCount.get(dayKey) ?? 0) + 1);
  }

  return chunks;
}

// ── OpenAI Calls ───────────────────────────────────────────

interface ContextualizerModel {
  provider: string;
  name: string;
}

async function generateContext(
  currentText: string,
  previousText: string | null,
  modelConfig: ContextualizerModel,
): Promise<string> {

  const prevSection = previousText
    ? `<previous_chunk>\n${previousText}\n</previous_chunk>\n\n`
    : "";

  const prompt = `${prevSection}<current_chunk>\n${currentText}\n</current_chunk>

Write a short, succinct context (1-2 sentences max) to situate this conversation chunk for search retrieval purposes. The context should capture:
- What topics are being discussed
- Any key decisions, facts, or preferences mentioned
- How this relates to the previous chunk (if provided)

Do NOT summarize the full conversation. Just provide enough context so that if someone searches for related topics, this chunk can be found. Respond with ONLY the context sentence(s), nothing else.`;

  const authStorage = AuthStorage.create();
  const apiKey = await authStorage.getApiKey(modelConfig.provider);
  if (!apiKey) throw new Error(`No credentials found for contextualizer provider: ${modelConfig.provider}`);

  const model = getModel(modelConfig.provider as any, modelConfig.name as any);
  const response = await completeSimple(
    model,
    { messages: [{ role: "user", content: prompt, timestamp: Date.now() }] },
    { apiKey, maxTokens: 200, reasoning: "minimal" },
  );
  if (response.stopReason === "error") {
    throw new Error(response.errorMessage || `Contextualizer request failed for ${modelConfig.provider}/${modelConfig.name}`);
  }

  return response.content
    .filter((part): part is Extract<(typeof response.content)[number], { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("")
    .trim();
}


// ── Main Entry Point ───────────────────────────────────────

// ── Result type for trace reporting ────────────────────────

export interface EmbeddingResult {
  /** Whether embedding was skipped and why */
  skipped?: string;
  /** Number of chunks created this run */
  chunks_created: number;
  /** Details of each chunk created */
  chunks: Array<{
    day: string;
    chunk_index: number;
    msg_count: number;
    char_count: number;
    context: string;
  }>;
  /** How many unembedded messages were in the buffer */
  unembedded_messages: number;
  /** Total chars of unembedded messages */
  unembedded_chars: number;
  /** Duration in ms */
  duration_ms: number;
}

export interface EmbedOptions {
  /** Force emitting a final chunk even if below MIN_CHUNK_CHARS */
  force?: boolean;
  /** Provider/model used to write the per-chunk context sentence. */
  contextualizerModel?: ContextualizerModel;
}

/**
 * Check if a session has enough unembedded messages to form a chunk,
 * and if so, embed them. Called after every assistant message.
 * 
 * Returns a result object for trace reporting.
 */
export async function embedNewChunks(
  x: Context,
  sessionId: string,
  options: EmbedOptions = {}
): Promise<EmbeddingResult> {
  const start = Date.now();
  try {
    return await doEmbedding(x, sessionId, start, options);
  } catch (error) {
    console.error(`[Embeddings] Error during incremental embedding for ${sessionId}:`, error);
    return {
      skipped: `error: ${error instanceof Error ? error.message : String(error)}`,
      chunks_created: 0,
      chunks: [],
      unembedded_messages: 0,
      unembedded_chars: 0,
      duration_ms: Date.now() - start,
    };
  }
}

async function doEmbedding(
  x: Context,
  sessionId: string,
  start: number,
  options: EmbedOptions
): Promise<EmbeddingResult> {
  const embeddingStore = xEmbeddingStore(x);
  const afterId = embeddingStore.getLastEmbeddedMessageId(x, sessionId);
  const unembeddedMessages: RawMessage[] = xMessageStore(x)
    .list(x, {
      sessionIds: [sessionId],
      afterId,
      excludeTypes: ["thought", "tool_start", "tool_end"],
      order: "oldest",
    })
    .filter((message) => message.type === "user" || message.type === "assistant")
    .map((message) => ({
      id: message.id,
      session_id: message.session_id,
      timestamp: message.timestamp,
      type: message.type,
      content: message.content,
      author: message.author,
    }));

  if (unembeddedMessages.length === 0) {
    return { skipped: "no_unembedded_messages", chunks_created: 0, chunks: [], unembedded_messages: 0, unembedded_chars: 0, duration_ms: Date.now() - start };
  }

  let totalChars = 30;
  for (const message of unembeddedMessages) {
    totalChars += formatMessageLine(message).length + 1;
  }
  if (!options.force && totalChars < MIN_CHUNK_CHARS) {
    return { skipped: "below_threshold", chunks_created: 0, chunks: [], unembedded_messages: unembeddedMessages.length, unembedded_chars: totalChars, duration_ms: Date.now() - start };
  }

  const existingCounts = embeddingStore.getNextChunkIndices(x, sessionId);
  const chunks = produceCompleteChunks(
    unembeddedMessages,
    existingCounts,
    options.force === true
  );
  if (chunks.length === 0) {
    return { skipped: "no_complete_chunks", chunks_created: 0, chunks: [], unembedded_messages: unembeddedMessages.length, unembedded_chars: totalChars, duration_ms: Date.now() - start };
  }

  console.log(`[Embeddings] Processing ${chunks.length} new chunk(s) for session ${sessionId}`);
  const createdChunks: EmbeddingResult["chunks"] = [];
  for (const chunk of chunks) {
    try {
      const previousText = embeddingStore.getPreviousChunkText(x, sessionId);
      const context = await generateContext(
        chunk.text,
        previousText,
        options.contextualizerModel ?? DEFAULT_CONTEXTUAL_MODEL
      );
      const embeddedText = `${context}\n\n${chunk.text}`;
      const vector = await xEmbeddingService(x).create(x, embeddedText);
      embeddingStore.createChunk(x, {
        sessionId,
        day: chunk.day,
        chunkIndex: chunk.chunkIndex,
        text: chunk.text,
        context,
        embeddedText,
        messageIdStart: chunk.messages[0].id,
        messageIdEnd: chunk.messages[chunk.messages.length - 1].id,
        messageCount: chunk.messages.length,
        vector,
      });
      createdChunks.push({
        day: chunk.day,
        chunk_index: chunk.chunkIndex,
        msg_count: chunk.messages.length,
        char_count: chunk.text.length,
        context,
      });
      console.log(`[Embeddings] ✅ Chunk #${chunk.chunkIndex} for ${chunk.day} — ${chunk.messages.length} msgs, ${chunk.text.length} chars`);
    } catch (error) {
      console.error(`[Embeddings] ❌ Failed to embed chunk for ${chunk.day}#${chunk.chunkIndex}:`, error);
    }
  }

  return {
    chunks_created: createdChunks.length,
    chunks: createdChunks,
    unembedded_messages: unembeddedMessages.length,
    unembedded_chars: totalChars,
    duration_ms: Date.now() - start,
  };
}
