import type { Queries } from "../db/queries.js";
import type { MessageRow, VitoConfig } from "../types.js";
import { readdirSync, existsSync } from "fs";
import { join } from "path";

const MEMORIES_DIR = join(process.cwd(), "user", "memories");

export interface AssembledContext {
  memoriesBlock: string;
  crossSessionBlock: string;
  currentSessionBlock: string;
}

/**
 * Build the 3-layer context for a given session.
 *
 * 1. Memory titles — lightweight list of .md files, read on demand with Read tool
 * 2. Cross-session — last N messages per other session (excludes archived)
 * 3. Current session — recent messages from this session
 */
export async function assembleContext(
  queries: Queries,
  sessionId: string,
  config: VitoConfig
): Promise<AssembledContext> {
  const {
    currentSessionLimit,
    crossSessionLimit,
    includeToolsInCurrentSession = true,
    includeToolsInCrossSession = false,
    showArchivedInCrossSession = false,
  } = config.memory;

  // 1. Long-term memories — just file titles from user/memories/
  const memoriesBlock = buildMemoriesTitlesBlock();

  // 2. Cross-session messages — last N per session, exclude archived
  const crossSessionMessages = queries.getCrossSessionMessagesPerSession(
    sessionId,
    crossSessionLimit,
    includeToolsInCrossSession
  );
  const crossSessionBlock = formatCrossSessionMessages(crossSessionMessages);

  // 3. Current session messages (everything not archived, compacted or not)
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
    parts.push(`<memories>\n${ctx.memoriesBlock}\n</memories>`);
  }

  if (ctx.crossSessionBlock) {
    parts.push(`<cross-session>\n${ctx.crossSessionBlock}\n</cross-session>`);
  }

  if (ctx.currentSessionBlock) {
    parts.push(`<current-session>\n${ctx.currentSessionBlock}\n</current-session>`);
  }

  return parts.join("\n\n");
}

/**
 * Build a lightweight memory block — just file titles from user/memories/.
 * The LLM can use the Read tool to pull full content when needed.
 */
function buildMemoriesTitlesBlock(): string {
  if (!existsSync(MEMORIES_DIR)) return "";

  const files = readdirSync(MEMORIES_DIR).filter((f) => f.endsWith(".md"));
  if (files.length === 0) return "";

  const titles = files.map((f) => `- ${f}`).join("\n");
  return `Long-term memory documents (titles only — content loaded on demand during compaction):\n${titles}\nUse the Read tool on user/memories/<filename> to load any document when you need details.`;
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
