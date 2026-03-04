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

import Database from "better-sqlite3";
import OpenAI from "openai";
import { readFileSync } from "fs";
import { join, resolve } from "path";
import { EMBEDDING_MODEL } from "./models.js";

// ── Config ─────────────────────────────────────────────────

const ROOT = resolve(process.cwd());
const VITO_DB_PATH = join(ROOT, "user", "vito.db");
const EMBEDDINGS_DB_PATH = join(ROOT, "user", "embeddings.db");
const MIN_CHUNK_CHARS = 2000;  // Start chunking when buffer hits this
const MAX_CHUNK_CHARS = 4000;  // Hard cap per chunk
const ASSISTANT_LABEL = "assistant";
const CONTEXTUAL_MODEL = "openai/gpt-4o-mini";

let openrouterApiKey: string | null = null;

function getOpenRouterKey(): string {
  if (!openrouterApiKey) {
    const secrets = JSON.parse(readFileSync(join(ROOT, "user", "secrets.json"), "utf-8"));
    openrouterApiKey = secrets.OPENROUTER_API_KEY;
  }
  return openrouterApiKey!;
}

// ── Global Lock ────────────────────────────────────────────

let isRunning = false;

// ── DB Initialization ──────────────────────────────────────

let embDB: ReturnType<typeof Database> | null = null;

function getEmbeddingsDB(): ReturnType<typeof Database> {
  if (!embDB) {
    embDB = new Database(EMBEDDINGS_DB_PATH);
    embDB.pragma("journal_mode = WAL");
    
    // Create schema if needed (same as the standalone scripts)
    embDB.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        day TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        text TEXT NOT NULL,
        context TEXT,
        embedded_text TEXT,
        msg_id_start INTEGER,
        msg_id_end INTEGER,
        msg_count INTEGER,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        UNIQUE(session_id, day, chunk_index)
      );

      CREATE TABLE IF NOT EXISTS embeddings (
        chunk_id INTEGER PRIMARY KEY,
        vector BLOB NOT NULL,
        FOREIGN KEY (chunk_id) REFERENCES chunks(id)
      );

      CREATE INDEX IF NOT EXISTS idx_chunks_session_day ON chunks(session_id, day);
      CREATE INDEX IF NOT EXISTS idx_chunks_day ON chunks(day);

      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
        text,
        content='chunks',
        content_rowid='id'
      );

      CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
        INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
      END;
      CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
        INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES('delete', old.id, old.text);
      END;
      CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
        INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES('delete', old.id, old.text);
        INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
      END;
    `);
  }
  return embDB;
}

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

async function generateContext(currentText: string, previousText: string | null): Promise<string> {
  const openai = new OpenAI({ 
    apiKey: getOpenRouterKey(),
    baseURL: "https://openrouter.ai/api/v1",
  });

  const prevSection = previousText
    ? `<previous_chunk>\n${previousText}\n</previous_chunk>\n\n`
    : "";

  const prompt = `${prevSection}<current_chunk>\n${currentText}\n</current_chunk>

Write a short, succinct context (1-2 sentences max) to situate this conversation chunk for search retrieval purposes. The context should capture:
- What topics are being discussed
- Any key decisions, facts, or preferences mentioned
- How this relates to the previous chunk (if provided)

Do NOT summarize the full conversation. Just provide enough context so that if someone searches for related topics, this chunk can be found. Respond with ONLY the context sentence(s), nothing else.`;

  const response = await openai.chat.completions.create({
    model: CONTEXTUAL_MODEL,
    max_tokens: 200,
    messages: [{ role: "user", content: prompt }],
  });

  return response.choices[0].message.content?.trim() || "";
}

async function embedText(text: string): Promise<Float32Array> {
  const openai = new OpenAI({ 
    apiKey: getOpenRouterKey(),
    baseURL: "https://openrouter.ai/api/v1",
  });

  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });

  return new Float32Array(response.data[0].embedding);
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
}

/**
 * Check if a session has enough unembedded messages to form a chunk,
 * and if so, embed them. Called after every assistant message.
 * 
 * Returns a result object for trace reporting.
 */
export async function maybeEmbedNewChunks(
  sessionId: string,
  options: EmbedOptions = {}
): Promise<EmbeddingResult> {
  const start = Date.now();

  // Global lock — if another embedding is running, skip
  if (isRunning) {
    return { skipped: "lock_held", chunks_created: 0, chunks: [], unembedded_messages: 0, unembedded_chars: 0, duration_ms: Date.now() - start };
  }
  isRunning = true;

  try {
    return await _doEmbedding(sessionId, start, options);
  } catch (err) {
    console.error(`[Embeddings] Error during incremental embedding for ${sessionId}:`, err);
    return { skipped: `error: ${err instanceof Error ? err.message : String(err)}`, chunks_created: 0, chunks: [], unembedded_messages: 0, unembedded_chars: 0, duration_ms: Date.now() - start };
  } finally {
    isRunning = false;
  }
}

async function _doEmbedding(
  sessionId: string,
  start: number,
  options: EmbedOptions
): Promise<EmbeddingResult> {
  const db = getEmbeddingsDB();

  // Find the highest message ID we've already embedded for this session
  const lastEmbedded = db.prepare(
    "SELECT MAX(msg_id_end) as last_id FROM chunks WHERE session_id = ?"
  ).get(sessionId) as { last_id: number | null };

  const afterId = lastEmbedded?.last_id ?? 0;

  // Query vito.db for unembedded messages in this session
  const vitoDB = new Database(VITO_DB_PATH, { readonly: true });
  
  const unembeddedMessages = vitoDB.prepare(`
    SELECT id, session_id, timestamp, type, content, author
    FROM messages
    WHERE session_id = ?
      AND type IN ('user', 'assistant')
      AND id > ?
    ORDER BY timestamp ASC
  `).all(sessionId, afterId) as RawMessage[];

  vitoDB.close();

  if (unembeddedMessages.length === 0) {
    return { skipped: "no_unembedded_messages", chunks_created: 0, chunks: [], unembedded_messages: 0, unembedded_chars: 0, duration_ms: Date.now() - start };
  }

  // Check total formatted size — quick bail if under threshold
  let totalChars = 0;
  for (const msg of unembeddedMessages) {
    totalChars += formatMessageLine(msg).length + 1; // +1 for newline
  }
  // Add approximate header size per day
  totalChars += 30; // "Tue Feb 25 2026\n" etc.

  if (!options.force && totalChars < MIN_CHUNK_CHARS) {
    // Not enough to form a full chunk yet — bail
    return { skipped: "below_threshold", chunks_created: 0, chunks: [], unembedded_messages: unembeddedMessages.length, unembedded_chars: totalChars, duration_ms: Date.now() - start };
  }

  // Get existing chunk counts per day for this session (to set chunk_index correctly)
  const existingCounts = new Map<string, number>();
  const countRows = db.prepare(
    "SELECT day, MAX(chunk_index) + 1 as next_idx FROM chunks WHERE session_id = ? GROUP BY day"
  ).all(sessionId) as Array<{ day: string; next_idx: number }>;
  for (const row of countRows) {
    existingCounts.set(row.day, row.next_idx);
  }

  // Produce complete chunks (only those that fill the threshold)
  const chunks = produceCompleteChunks(unembeddedMessages, existingCounts, options.force === true);

  if (chunks.length === 0) {
    return { skipped: "no_complete_chunks", chunks_created: 0, chunks: [], unembedded_messages: unembeddedMessages.length, unembedded_chars: totalChars, duration_ms: Date.now() - start };
  }

  console.log(`[Embeddings] Processing ${chunks.length} new chunk(s) for session ${sessionId}`);
  const createdChunks: EmbeddingResult["chunks"] = [];

  // Prepared statements
  const insertChunk = db.prepare(`
    INSERT OR REPLACE INTO chunks (session_id, day, chunk_index, text, context, embedded_text, msg_id_start, msg_id_end, msg_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertEmbedding = db.prepare(`
    INSERT OR REPLACE INTO embeddings (chunk_id, vector) VALUES (?, ?)
  `);

  // Get previous chunk for contextual embedding
  const getPrevChunk = db.prepare(`
    SELECT text FROM chunks 
    WHERE session_id = ? 
    ORDER BY id DESC 
    LIMIT 1
  `);

  for (const chunk of chunks) {
    try {
      // Get previous chunk text for context
      const prevRow = getPrevChunk.get(sessionId) as { text: string } | undefined;
      const prevText = prevRow?.text ?? null;

      // Generate contextual sentence
      const context = await generateContext(chunk.text, prevText);

      // Combine for embedding
      const embeddedText = `${context}\n\n${chunk.text}`;

      // Embed
      const vector = await embedText(embeddedText);

      // Store chunk
      const msgIdStart = chunk.messages[0].id;
      const msgIdEnd = chunk.messages[chunk.messages.length - 1].id;

      const result = insertChunk.run(
        sessionId,
        chunk.day,
        chunk.chunkIndex,
        chunk.text,
        context,
        embeddedText,
        msgIdStart,
        msgIdEnd,
        chunk.messages.length
      );
      const chunkId = result.lastInsertRowid;

      // Store embedding vector
      const buffer = Buffer.from(vector.buffer);
      insertEmbedding.run(chunkId, buffer);

      createdChunks.push({
        day: chunk.day,
        chunk_index: chunk.chunkIndex,
        msg_count: chunk.messages.length,
        char_count: chunk.text.length,
        context,
      });

      console.log(`[Embeddings] ✅ Chunk #${chunk.chunkIndex} for ${chunk.day} — ${chunk.messages.length} msgs, ${chunk.text.length} chars`);
    } catch (err) {
      console.error(`[Embeddings] ❌ Failed to embed chunk for ${chunk.day}#${chunk.chunkIndex}:`, err);
      // Continue with next chunk — don't let one failure block the rest
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
