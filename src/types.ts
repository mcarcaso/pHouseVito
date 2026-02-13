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
  startTyping?(): Promise<void>;
  stopTyping?(): Promise<void>;
  startReaction?(emoji?: string): Promise<void>;
  stopReaction?(): Promise<void>;
}

export interface OutboundMessage {
  text?: string;
  attachments?: Attachment[];
  replyTo?: string;
}

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
    memoriesLimit: number;
    compactionThreshold: number;
  };
  embeddings: {
    provider: string;
    model: string;
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
  type?: "message" | "task";
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
}

export interface MemoryRow {
  id: number;
  timestamp: number;
  content: string;
  embedding: Buffer | null;
}

export interface SessionRow {
  id: string;
  channel: string | null;
  channel_target: string | null;
  created_at: number;
  last_active_at: number;
}

// ── Skill types ──

export interface SkillMeta {
  name: string;
  description: string;
  path: string; // path to SKILL.md
}
