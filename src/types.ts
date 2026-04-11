// Shared types

// ── Channel types ──

export interface Channel {
  name: string;

  capabilities: {
    typing: boolean;
    reactions: boolean;
    attachments: boolean;
    streaming: boolean;
  };

  start(): Promise<void>;
  stop(): Promise<void>;

  listen(onEvent: (event: InboundEvent) => void): Promise<() => void>;
  createHandler(event: InboundEvent): OutputHandler;
  getSessionKey(event: InboundEvent): string;
  getCustomPrompt?(): string;
}

export interface InboundEvent {
  sessionKey: string;
  channel: string;
  target: string;
  author: string;
  timestamp: number;
  content: string;
  attachments?: Attachment[];
  replyTo?: string;
  raw: any;
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

export interface OutputHandler {
  relay(msg: OutboundMessage): Promise<void>;
  /** Send a structured agent event (tool calls, thinking, etc.) to the UI */
  relayEvent?(event: AgentActivityEvent): Promise<void>;
  startTyping?(): Promise<void>;
  stopTyping?(): Promise<void>;
  /** Signal that a complete assistant message has ended — flush any buffer */
  endMessage?(): Promise<void>;
  startReaction?(emoji?: string): Promise<void>;
  stopReaction?(): Promise<void>;
}

export interface AgentActivityEvent {
  kind: "tool_start" | "tool_end" | "thinking";
  toolName?: string;
  toolCallId?: string;
  args?: any;
  result?: any;
  isError?: boolean;
  content?: string;
}

// Channels receive plain text; they handle MEDIA: prefixes themselves
export type OutboundMessage = string;

// ── Stream modes ──

export type StreamMode = "stream" | "bundled" | "final";

// ── Config types ──

// ── Harness config types ──

export interface PiHarnessConfig {
  model: {
    provider: string;
    name: string;
  };
  thinkingLevel?: "off" | "low" | "medium" | "high";
}

// Add more harness configs here as we add harnesses
// export interface OpenAIHarnessConfig { ... }
// export interface LocalLlamaHarnessConfig { ... }

// ── Unified Settings Type ──
// This is the cascading settings type: Global → Channel → Session
// Each level can override any setting. More specific wins.

/** Context window settings for current or cross-session */
export interface ContextSettings {
  /** Number of messages to include */
  limit?: number;
  /** Include thought messages */
  includeThoughts?: boolean;
  /** Include tool_start/tool_end messages */
  includeTools?: boolean;
  /** Include archived messages */
  includeArchived?: boolean;
  /** Max number of sessions to include for cross-session context (cross-session only) */
  maxSessions?: number;
}

/** Memory recall settings for semantic search */
export interface MemorySettings {
  /** Max number of memory chunks to inject (default 3) */
  recalledMemoryLimit?: number;
  /** Minimum RRF score to include (default 0.005) */
  recalledMemoryThreshold?: number;
  /** Number of recent messages to include as context for profile updates (default 2) */
  profileUpdateContext?: number;
}

/** A single candidate model the auto classifier can choose between. */
export interface ModelChoice {
  provider: string;
  name: string;
  /** Human-readable description shown to the classifier — tell it when to pick this one. */
  description: string;
}

/**
 * Per-field auto-selection flags. When a field is true, a cheap LLM classifier
 * decides the value for that field on every turn (overriding the configured value).
 * Cascades through Global → Channel → Session like other settings.
 */
export interface AutoFlags {
  currentContext?: {
    limit?: boolean;
    includeThoughts?: boolean;
    includeTools?: boolean;
  };
  memory?: {
    recalledMemoryLimit?: boolean;
  };
  "pi-coding-agent"?: {
    /** If true, a classifier picks the pi-coding-agent model per turn from modelChoices. */
    model?: boolean;
    /** Candidate models for the classifier to pick between. Defaults to DEFAULT_PI_MODEL_CHOICES. */
    modelChoices?: ModelChoice[];
  };
  /** Which LLM the classifier itself runs on. Defaults to anthropic/claude-haiku-4-5. */
  classifierModel?: { provider: string; name: string };
}

export interface Settings {
  /** Which harness to use */
  harness?: string;
  /** How to deliver responses: stream (real-time), bundled (chunks), final (single message) */
  streamMode?: StreamMode;
  /** Custom instructions injected into the system prompt — cascades Global → Channel → Session (most specific wins) */
  customInstructions?: string;
  /** Current session context settings */
  currentContext?: ContextSettings;
  /** Cross-session context settings */
  crossContext?: ContextSettings;
  /** Memory recall settings */
  memory?: MemorySettings;
  /** Require @mention to respond (Discord/Telegram) — still logs all messages */
  requireMention?: boolean;
  /** Log message_update raw events to trace files (noisy). Default false */
  traceMessageUpdates?: boolean;
  /** Timezone for cron jobs and datetime display (e.g., "America/Toronto"). Defaults to America/Toronto */
  timezone?: string;
  /** Pi Coding Agent harness overrides */
  "pi-coding-agent"?: Partial<PiHarnessConfig>;
  /** Per-field auto-selection flags — cascades like other settings */
  auto?: AutoFlags;
}

/** Resolved context settings with all fields required */
export interface ResolvedContextSettings {
  limit: number;
  includeThoughts: boolean;
  includeTools: boolean;
  includeArchived: boolean;
  /** Max sessions to include for cross-session (only used by crossContext) */
  maxSessions: number;
}

/** Resolved memory settings with all fields required */
export interface ResolvedMemorySettings {
  recalledMemoryLimit: number;
  recalledMemoryThreshold: number;
  profileUpdateContext: number;
}

/** Resolved auto flags — all fields present, defaulting to false */
export interface ResolvedAutoFlags {
  currentContext: {
    limit: boolean;
    includeThoughts: boolean;
    includeTools: boolean;
  };
  memory: {
    recalledMemoryLimit: boolean;
  };
  "pi-coding-agent": {
    model: boolean;
    /** Fully-resolved list of candidate models (always populated — from config or default). */
    modelChoices: ModelChoice[];
  };
  /** Fully-resolved classifier model (always populated — from config or default). */
  classifierModel: { provider: string; name: string };
}

/** Deep merge helper type for settings resolution */
export type ResolvedSettings = Required<Pick<Settings, "harness" | "streamMode">> & {
  customInstructions?: string;
  currentContext: ResolvedContextSettings;
  crossContext: ResolvedContextSettings;
  memory: ResolvedMemorySettings;
  requireMention?: boolean;
  traceMessageUpdates?: boolean;
  "pi-coding-agent"?: Partial<PiHarnessConfig>;
  auto: ResolvedAutoFlags;
};

export interface VitoConfig {
  /** Bot identity — used for @mention normalization across channels */
  bot?: {
    name: string;  // @mentions get normalized to @{name}
  };
  /** Global default settings — baseline for all channels and sessions */
  settings: Settings;
  /** Global harness configurations (full configs, not overrides) */
  harnesses: {
    "pi-coding-agent"?: PiHarnessConfig;
  };
  /** Per-channel configuration */
  channels: Record<string, ChannelConfig>;
  /** Per-session overrides (keyed by session ID, e.g., "telegram:123456789") */
  sessions?: Record<string, Settings>;
  /** Cron job configuration */
  cron: {
    jobs: CronJobConfig[];
  };
}

export interface ChannelConfig {
  enabled: boolean;
  /** Channel-specific settings overrides */
  settings?: Settings;
  /** Allow any additional channel-specific config (e.g., allowedChatIds for Telegram) */
  [key: string]: any;
}

export interface CronJobConfig {
  name: string;
  schedule: string;
  timezone?: string;
  session: string;
  prompt: string;
  oneTime?: boolean; // If true, job will be removed from config after firing
  sendCondition?: string; // If set, response is only sent if condition is met (must NOT contain "NO_REPLY")
}

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

// SessionConfig is now just Settings — keeping the alias for backward compat
// (some code may still reference SessionConfig)
export type SessionConfig = Settings;

export interface SessionRow {
  id: string;
  channel: string | null;
  channel_target: string | null;
  created_at: number;
  last_active_at: number;
  config: string; // JSON string of SessionConfig
  alias: string | null;
}

// ── Trace types ──

export interface TraceRow {
  id: number;
  session_id: string;
  channel: string | null;
  timestamp: number;
  user_message: string;
  system_prompt: string;
  model: string | null;
}

// ── Skill types ──

export interface SkillMeta {
  name: string;
  description: string;
  path: string; // path to SKILL.md
  isBuiltin?: boolean; // true if skill is in src/skills/builtin/
}
