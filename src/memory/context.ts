import type { Queries } from "../db/queries.js";
import type { MessageRow, MemoryRow, VitoConfig } from "../types.js";
import { embed, findTopK } from "./embeddings.js";

function embeddingsEnabled(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

export interface AssembledContext {
  memoriesBlock: string;
  crossSessionBlock: string;
  currentSessionBlock: string;
}

/**
 * Build the 3-layer context for a given session.
 *
 * 1. [LONG-TERM MEMORIES] — semantic search over memory blobs
 * 2. [CROSS-SESSION SHORT-TERM] — recent messages from OTHER sessions
 * 3. [CURRENT SESSION SHORT-TERM] — recent messages from THIS session
 */
export async function assembleContext(
  queries: Queries,
  sessionId: string,
  config: VitoConfig
): Promise<AssembledContext> {
  const {
    currentSessionLimit,
    crossSessionLimit,
    memoriesLimit,
    includeToolsInCurrentSession = true,
    includeToolsInCrossSession = false,
  } = config.memory;

  // 1. Long-term memories (semantic search)
  const memoriesBlock = await buildMemoriesBlock(
    queries,
    sessionId,
    memoriesLimit
  );

  // 2. Cross-session messages
  const crossSessionMessages = queries.getCrossSessionMessages(
    sessionId,
    crossSessionLimit,
    includeToolsInCrossSession
  );
  const crossSessionBlock = formatCrossSessionMessages(crossSessionMessages);

  // 3. Current session messages
  const currentSessionMessages = queries.getRecentMessages(
    sessionId,
    currentSessionLimit,
    includeToolsInCurrentSession
  );
  const currentSessionBlock = formatCurrentSessionMessages(
    currentSessionMessages
  );

  return { memoriesBlock, crossSessionBlock, currentSessionBlock };
}

/** Build the full system prompt addition from assembled context */
export function formatContextForPrompt(ctx: AssembledContext): string {
  const parts: string[] = [];

  if (ctx.memoriesBlock) {
    parts.push(`[LONG-TERM MEMORIES]\n${ctx.memoriesBlock}`);
  }

  if (ctx.crossSessionBlock) {
    parts.push(`[CROSS-SESSION SHORT-TERM]\n${ctx.crossSessionBlock}`);
  }

  if (ctx.currentSessionBlock) {
    parts.push(`[CURRENT SESSION SHORT-TERM]\n${ctx.currentSessionBlock}`);
  }

  return parts.join("\n\n");
}

async function buildMemoriesBlock(
  queries: Queries,
  sessionId: string,
  limit: number
): Promise<string> {
  const allMemories = queries.getAllMemories();
  if (allMemories.length === 0) return "";

  // Get recent messages to extract query context
  const recentMessages = queries.getRecentMessages(sessionId, 5);
  if (recentMessages.length === 0) {
    return allMemories
      .slice(0, limit)
      .map((m) => `### ${m.title || "UNTITLED.md"}\n${m.content}`)
      .join("\n\n");
  }

  // Extract text from recent messages
  const recentTexts = recentMessages.map((m) => extractMessageText(m.content));
  const queryText = recentTexts.join(" ");

  // Semantic search if embeddings are available
  if (embeddingsEnabled()) {
    const withEmbeddings = allMemories.filter(
      (m) => m.embedding !== null
    ) as Array<{ id: number; title: string; content: string; embedding: Buffer }>;

    if (withEmbeddings.length > 0) {
      try {
        const queryEmbedding = await embed(queryText);
        const topK = findTopK(queryEmbedding, withEmbeddings, limit);
        // Find matching full memory rows to get titles
        return topK.map((m) => {
          const full = allMemories.find((am) => am.id === m.id);
          const title = full?.title || "UNTITLED.md";
          return `### ${title}\n${m.content}`;
        }).join("\n\n");
      } catch {
        // Fall through to keyword search
      }
    }
  }

  // Keyword search fallback — extract significant words from recent messages
  const stopWords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "can", "shall", "to", "of", "in", "for",
    "on", "with", "at", "by", "from", "as", "into", "about", "like",
    "through", "after", "over", "between", "out", "up", "down", "that",
    "this", "it", "i", "you", "he", "she", "we", "they", "me", "him",
    "her", "us", "them", "my", "your", "his", "its", "our", "their",
    "what", "which", "who", "when", "where", "how", "not", "no", "but",
    "and", "or", "if", "then", "so", "just", "also", "than", "too",
  ]);
  const keywords = queryText
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));
  const unique = [...new Set(keywords)].slice(0, 10);

  const results = queries.searchMemoriesByKeyword(unique, limit);
  return results.map((m) => `### ${m.title || "UNTITLED.md"}\n${m.content}`).join("\n\n");
}

/** Extract display text from a stored message, including attachment references */
function extractMessageText(raw: string): string {
  const content = JSON.parse(raw);
  if (typeof content === "string") return content;
  let text = content.text || "";
  if (Array.isArray(content.attachments)) {
    for (const a of content.attachments) {
      text += `\n[Attached ${a.type}: ${a.path}]`;
    }
  }
  return text;
}

function formatCrossSessionMessages(messages: MessageRow[]): string {
  if (messages.length === 0) return "";

  // Group by session
  const grouped = new Map<string, MessageRow[]>();
  for (const msg of messages) {
    const key = msg.session_id;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(msg);
  }

  const parts: string[] = [];
  for (const [sessionId, msgs] of grouped) {
    const lastActive = msgs[msgs.length - 1].timestamp;
    const ago = formatTimeAgo(lastActive);
    const channelInfo = msgs[0].channel || "unknown";

    parts.push(`[Session: ${channelInfo} ${sessionId} — last active ${ago}]`);
    for (const msg of msgs) {
      const time = formatTimestamp(msg.timestamp);
      const text = extractMessageText(msg.content);
      parts.push(`[${time}] ${msg.role}: ${text}`);
    }
  }

  return parts.join("\n");
}

function formatCurrentSessionMessages(messages: MessageRow[]): string {
  if (messages.length === 0) return "";

  return messages
    .map((msg) => {
      const time = formatTimestamp(msg.timestamp);
      if (msg.role === "tool") {
        return formatToolMessage(msg.content, time);
      }
      const text = extractMessageText(msg.content);
      return `[${time}] ${msg.role}: ${text}`;
    })
    .join("\n");
}

function formatToolMessage(raw: string, time: string): string {
  try {
    const content = JSON.parse(raw);
    const name = content.toolName || "unknown";
    if (content.phase === "start") {
      const args = content.args ? JSON.stringify(content.args) : "";
      return `[${time}] tool: ${name}(${args})`;
    }
    if (content.phase === "end") {
      const status = content.isError ? "ERROR" : "OK";
      const result = typeof content.result === "string"
        ? content.result.slice(0, 500)
        : JSON.stringify(content.result)?.slice(0, 500) || "";
      return `[${time}] tool: ${name} → [${status}] ${result}`;
    }
    return `[${time}] tool: ${name}`;
  } catch {
    return `[${time}] tool: ${raw}`;
  }
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
