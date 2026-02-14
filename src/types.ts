// Shared types for Vito

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
}

export interface Attachment {
  type: "image" | "file" | "audio" | "video";
  url?: string;
  path?: string;
  buffer?: Buffer;
  mimeType?: string;
  filename?: string;
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

export interface VitoConfig {
  model: {
    provider: string;
    name: string;
  };
  memory: {
    currentSessionLimit: number;
    crossSessionLimit: number;
    compactionThreshold: number;
    includeToolsInCurrentSession?: boolean;
    includeToolsInCrossSession?: boolean;
    showArchivedInCrossSession?: boolean;
  };
  channels: Record<string, ChannelConfig>;
  cron: {
    jobs: CronJobConfig[];
  };
}

export interface ChannelConfig {
  enabled: boolean;
  streamMode?: StreamMode;
  [key: string]: any;
}

export interface CronJobConfig {
  name: string;
  schedule: string;
  timezone?: string;
  session: string;
  prompt: string;
  oneTime?: boolean; // If true, job will be removed from config after firing
}

// ── DB row types ──

export interface MessageRow {
  id: number;
  session_id: string;
  channel: string | null;
  channel_target: string | null;
  timestamp: number;
  role: "user" | "assistant" | "system" | "tool";
  content: string; // JSON string
  compacted: number; // 0 or 1
  archived: number; // 0 or 1
}

export interface SessionConfig {
  streamMode?: StreamMode;
  model?: {
    provider: string;
    name: string;
  };
}

export interface SessionRow {
  id: string;
  channel: string | null;
  channel_target: string | null;
  created_at: number;
  last_active_at: number;
  config: string; // JSON string of SessionConfig
}

// ── Trace types ──

export interface TraceRow {
  id: number;
  session_id: string;
  channel: string | null;
  timestamp: number;
  user_message: string;
  system_prompt: string;
}

// ── Skill types ──

export interface SkillMeta {
  name: string;
  description: string;
  path: string; // path to SKILL.md
  isBuiltin?: boolean; // true if skill is in src/skills/builtin/
}
