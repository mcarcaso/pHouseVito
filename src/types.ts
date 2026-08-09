// Shared types

// ── Channel event types ──

export interface InboundEvent {
  sessionKey: string;
  channel: string;
  target: string;
  author: string;
  timestamp: number;
  content: string;
  attachments?: Attachment[];
  replyTo?: string;
  raw: unknown;
  /** Whether the bot was @mentioned in this message (channels set this, orchestrator decides what to do) */
  hasMention?: boolean;
}

export interface Attachment {
  type: "image" | "file" | "audio" | "video";
  url?: string;
  path?: string;
  buffer?: Buffer;
  mimeType?: string;
  filename?: string;
}

/**
 * Build a human-readable prompt string from a message's text + attachments.
 * Shared by the orchestrator (for the LLM prompt) and the classifier (for tracing).
 *
 * Uses the MEDIA: prefix for file references — the universal format across
 * the system (DB storage, channel rendering, LLM prompts).
 *
 * Output format:
 *   [senderName]: message text
 *
 *   MEDIA:/path/to/file.jpg
 */
export function buildPromptText(
  content: string,
  opts?: { author?: string; attachments?: Attachment[] }
): string {
  let text = content || "";

  const sender = opts?.author;
  if (sender && sender !== "user" && sender !== "system") {
    text = `[${sender}]: ${text}`;
  }

  if (opts?.attachments?.length) {
    const refs = opts.attachments
      .map((a) => `MEDIA:${a.path || a.filename || "(attachment)"}`)
      .join("\n");
    text = text ? `${text}\n\n${refs}` : refs;
  }

  return text;
}

// Compatibility re-exports. New code should import from output/OutputHandler.
export type { AgentActivityEvent, OutboundMessage, OutputHandler } from "./output/OutputHandler.js";

// ── Stream modes ──

export type StreamMode = "stream" | "bundled" | "final";

// ── Config types ──
// Runtime schemas and their inferred types live together at the config boundary.
export type {
  ChannelConfig,
  CronJobConfig,
  PiRuntimeConfig,
  ResolvedSettings,
  Settings,
  VitoConfig,
} from "./shared/contracts/vito-config.js";


// ── DB row types ──

/**
 * Unified message type — replaces separate 'role' and 'message_type' columns.
 * - user: User message
 * - thought: Assistant intermediate response (mid-agentic-loop)
 * - assistant: Assistant final response (end of turn)
 * - tool_start: Tool execution request
 * - tool_end: Tool execution result
 */
export type MsgType = "user" | "thought" | "assistant" | "tool_start" | "tool_end";

export interface MessageRow {
  id: number;
  session_id: string;
  channel: string | null;
  channel_target: string | null;
  timestamp: number;
  type: MsgType;
  content: string; // JSON string
  archived: number; // 0 or 1
  author: string | null; // username/tag of the sender (for user messages)
}

export interface SessionRow {
  id: string;
  channel: string | null;
  channel_target: string | null;
  created_at: number;
  last_active_at: number;
  config: string; // JSON string of Settings
  alias: string | null;
}
