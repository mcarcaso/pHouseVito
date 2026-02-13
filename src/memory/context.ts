import type { Queries } from "../db/queries.js";
import type { MessageRow, MemoryRow, VitoConfig } from "../types.js";
import { embed, findTopK } from "./embeddings.js";

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
  const { currentSessionLimit, crossSessionLimit, memoriesLimit } =
    config.memory;

  // 1. Long-term memories (semantic search)
  const memoriesBlock = await buildMemoriesBlock(
    queries,
    sessionId,
    memoriesLimit
  );

  // 2. Cross-session messages
  const crossSessionMessages = queries.getCrossSessionMessages(
    sessionId,
    crossSessionLimit
  );
  const crossSessionBlock = formatCrossSessionMessages(crossSessionMessages);

  // 3. Current session messages
  const currentSessionMessages = queries.getRecentMessages(
    sessionId,
    currentSessionLimit
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

  // Get recent messages to build a query embedding
  const recentMessages = queries.getRecentMessages(sessionId, 5);
  if (recentMessages.length === 0) {
    // No recent messages, return all memories (up to limit)
    return allMemories
      .slice(0, limit)
      .map((m) => `- ${m.content}`)
      .join("\n");
  }

  // Build query from recent messages
  const queryText = recentMessages
    .map((m) => {
      const content = JSON.parse(m.content);
      return typeof content === "string" ? content : content.text || "";
    })
    .join(" ");

  // Filter memories that have embeddings
  const withEmbeddings = allMemories.filter(
    (m) => m.embedding !== null
  ) as Array<{ id: number; content: string; embedding: Buffer }>;

  if (withEmbeddings.length === 0) {
    return allMemories
      .slice(0, limit)
      .map((m) => `- ${m.content}`)
      .join("\n");
  }

  try {
    const queryEmbedding = await embed(queryText);
    const topK = findTopK(queryEmbedding, withEmbeddings, limit);
    return topK.map((m) => `- ${m.content}`).join("\n");
  } catch {
    // Fallback: return most recent memories if embedding fails
    return allMemories
      .slice(-limit)
      .map((m) => `- ${m.content}`)
      .join("\n");
  }
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
      const content = JSON.parse(msg.content);
      const text = typeof content === "string" ? content : content.text || "";
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
      const content = JSON.parse(msg.content);
      const text = typeof content === "string" ? content : content.text || "";
      return `[${time}] ${msg.role}: ${text}`;
    })
    .join("\n");
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
