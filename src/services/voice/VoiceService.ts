import type { Context } from "../../context/Context.js";
import type { MessageRow } from "../../stores/messages/MessageStore.js";
import type { SessionRow } from "../../stores/sessions/SessionStore.js";
import type { VoiceTaskRow } from "../../stores/voice/VoiceTaskStore.js";
import type { SearchResult } from "../memory/MemoryService.js";

export type VoiceEventKind = "user" | "assistant" | "usage" | "session_end";

export interface VoiceSessionDetail {
  session: SessionRow;
  messages: MessageRow[];
  durationMs: number | null;
  usage: unknown[];
}

export interface VoiceService {
  createRealtimeSecret(x: Context): Promise<unknown>;
  recordEvent(
    x: Context,
    event: { sessionId: string; kind: VoiceEventKind; content: string },
  ): void;
  listSessions(x: Context, limit?: number): SessionRow[];
  getSession(x: Context, sessionId: string): VoiceSessionDetail | null;
  getContext(x: Context): { profile: string | null; recentVoiceSessions: SessionRow[] };
  searchMemory(
    x: Context,
    query: string,
    mode: "hybrid" | "semantic" | "exact",
  ): Promise<SearchResult[]>;
  askAsync(x: Context, voiceSessionId: string, question: string): VoiceTaskRow;
  getTask(x: Context, id: string): VoiceTaskRow | null;
  cancelTask(x: Context, id: string): VoiceTaskRow;
}
