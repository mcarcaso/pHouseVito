import type { Queries } from "../db/queries.js";
import type { MessageRow, ResolvedSettings, VitoConfig } from "../types.js";
import { readdirSync, existsSync, readFileSync } from "fs";
import { join } from "path";

const MEMORIES_DIR = join(process.cwd(), "user", "memories");

export interface AssembledContext {
  memoriesBlock: string;
  crossSessionBlock: string;
  currentSessionBlock: string;
}

// ContextOptions interface removed — now using ResolvedSettings directly

/**
 * Build the 3-layer context for a given session.
 *
 * 1. Memory titles — lightweight list of .md files, read on demand with Read tool
 * 2. Cross-session — last N messages per other session (filtered by settings)
 * 3. Current session — recent messages from this session (filtered by settings)
 */
export async function assembleContext(
  queries: Queries,
  sessionId: string,
  config: VitoConfig,
  effectiveSettings?: ResolvedSettings
): Promise<AssembledContext> {
  // Use effective settings, with sensible defaults
  const currentContext = effectiveSettings?.currentContext ?? {
    limit: 100,
    includeThoughts: true,
    includeTools: true,
    includeArchived: false,
    includeCompacted: false,
  };
  const crossContext = effectiveSettings?.crossContext ?? {
    limit: 5,
    includeThoughts: false,
    includeTools: false,
    includeArchived: false,
    includeCompacted: false,
  };

  // 1. Long-term memories — just file titles from user/memories/
  const memoriesBlock = buildMemoriesTitlesBlock();

  // Load session aliases for human-readable display
  const aliases = queries.getSessionAliases();

  // 2. Cross-session messages — last N per session, filtered by settings
  const crossSessionMessages = queries.getCrossSessionMessagesPerSession(
    sessionId,
    crossContext.limit,
    crossContext.includeTools,
    crossContext.includeThoughts,
    crossContext.includeArchived,
    crossContext.includeCompacted
  );
  const crossSessionBlock = formatCrossSessionMessages(crossSessionMessages, aliases);

  // 3. Current session messages (filtered by settings)
  const currentSessionMessages = queries.getRecentMessages(
    sessionId,
    currentContext.limit,
    currentContext.includeTools,
    currentContext.includeThoughts,
    currentContext.includeArchived,
    currentContext.includeCompacted
  );
  const currentSessionBlock = formatCurrentSessionMessages(
    currentSessionMessages,
    sessionId,
    aliases[sessionId]
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
 * Parse YAML frontmatter from a memory file.
 * Returns the description if found, null otherwise.
 */
function parseMemoryDescription(filePath: string): string | null {
  try {
    const content = readFileSync(filePath, "utf-8");
    if (!content.startsWith("---")) return null;
    
    const endIndex = content.indexOf("---", 3);
    if (endIndex === -1) return null;
    
    const frontmatter = content.slice(3, endIndex);
    const match = frontmatter.match(/^description:\s*(.+)$/m);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

/**
 * Build a lightweight memory block — file titles with descriptions from user/memories/.
 * Each file can have YAML frontmatter with a description field.
 * The LLM can use the Read tool to pull full content when needed.
 */
function buildMemoriesTitlesBlock(): string {
  if (!existsSync(MEMORIES_DIR)) return "";

  const files = readdirSync(MEMORIES_DIR).filter((f) => f.endsWith(".md"));
  if (files.length === 0) return "";

  const entries = files.map((f) => {
    const desc = parseMemoryDescription(join(MEMORIES_DIR, f));
    return desc ? `- ${f} — ${desc}` : `- ${f}`;
  }).join("\n");
  
  return `Long-term memory documents:\n${entries}\nUse the Read tool on user/memories/<filename> to load full content when needed.`;
}

/** Extract display text from a stored message, including attachment references */
function extractMessageText(raw: string): string {
  const content = JSON.parse(raw);
  if (typeof content === "string") return content;
  let text = content.text || "";
  if (Array.isArray(content.attachments)) {
    for (const a of content.attachments) {
      // Use path, filename, or url — whatever's available
      const ref = a.path || a.filename || a.url || "(attachment)";
      text += `\n[Attached ${a.type}: ${ref}]`;
    }
  }
  return text;
}

/** Map internal type to display role for context */
function typeToRole(type: string): string {
  switch (type) {
    case "user": return "user";
    case "thought": return "assistant";
    case "assistant": return "assistant";
    case "tool_start": return "tool";
    case "tool_end": return "tool";
    default: return type;
  }
}

function formatCrossSessionMessages(messages: MessageRow[], aliases?: Record<string, string>): string {
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
    const displayName = aliases?.[sessionId] || sessionId;

    parts.push(`[Session: ${displayName} — last active ${ago}]`);
    for (const msg of msgs) {
      const time = formatTimestamp(msg.timestamp);
      const text = extractMessageText(msg.content);
      parts.push(`[${time}] ${typeToRole(msg.type)}: ${text}`);
    }
  }

  return parts.join("\n");
}

function formatCurrentSessionMessages(messages: MessageRow[], sessionId: string, alias?: string): string {
  if (messages.length === 0) return "";

  const displayName = alias || sessionId;
  const header = `[Session: ${displayName}]`;
  const body = messages
    .map((msg) => {
      const time = formatTimestamp(msg.timestamp);
      if (msg.type === "tool_start" || msg.type === "tool_end") {
        return formatToolMessage(msg.content, time, msg.type);
      }
      const text = extractMessageText(msg.content);
      return `[${time}] ${typeToRole(msg.type)}: ${text}`;
    })
    .join("\n");
  
  return `${header}\n${body}`;
}

function formatToolMessage(raw: string, time: string, type: string): string {
  try {
    const content = JSON.parse(raw);
    const name = content.toolName || "unknown";
    if (type === "tool_start") {
      const args = content.args ? JSON.stringify(content.args) : "";
      return `[${time}] tool: ${name}(${args})`;
    }
    if (type === "tool_end") {
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
