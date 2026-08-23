import { randomUUID } from "node:crypto";
import type { Context } from "../../context/Context.js";
import {
  xMemoryService,
  xMessageStore,
  xSecretService,
  xSessionStore,
  xVoiceTaskStore,
} from "../../lib/x.js";
import type { VoiceTaskRow } from "../../stores/voice/VoiceTaskStore.js";
import type { AskApiService } from "../ask/AskApiService.js";
import type { SearchResult } from "../memory/MemoryService.js";
import type { VoiceEventKind, VoiceService, VoiceSessionDetail } from "./VoiceService.js";

export class DefaultVoiceService implements VoiceService {
  constructor(private readonly askApiService: AskApiService) {}

  async createRealtimeSecret(x: Context): Promise<unknown> {
    const apiKey = xSecretService(x).get(x, "OPENAI_API_KEY");
    if (!apiKey) throw new Error("OpenAI API key is not configured");
    const today = new Date().toLocaleDateString("en-CA");
    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "OpenAI-Safety-Identifier": "vito-owner",
      },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model: "gpt-realtime-2.1-mini",
          instructions: `You are Vito, Mike Carcasole's concise personal voice assistant. Today is ${today}. Speak naturally, warmly, and directly. Keep answers brief unless Mike asks for detail. Use the available Vito tools when personal context, memory, or durable reasoning is needed. For references such as yesterday, last time, or earlier, search memory and include the explicit date plus all clarified nouns in the query. If Mike corrects or narrows the subject, search again rather than relying on the previous result. Before using tools, give at most one short acknowledgment. If additional tool calls are needed, perform them silently without repeating phrases such as 'let me check' or narrating each search. Never infer a personal fact from an unrelated result, and never claim a tool result before receiving it.`,
          tools: [
            {
              type: "function",
              name: "get_vito_context",
              description: "Load Mike's durable profile and recent voice sessions.",
              parameters: { type: "object", properties: {}, additionalProperties: false },
            },
            {
              type: "function",
              name: "search_memory",
              description:
                "Search Vito's durable conversation memory. Include explicit dates and clarified subject terms for time-relative questions.",
              parameters: {
                type: "object",
                properties: {
                  query: { type: "string" },
                  mode: { type: "string", enum: ["hybrid", "semantic", "exact"] },
                  day: {
                    type: "string",
                    description: "Optional exact local calendar day in YYYY-MM-DD format.",
                  },
                },
                required: ["query"],
                additionalProperties: false,
              },
            },
            {
              type: "function",
              name: "ask_vito_async",
              description:
                "Start durable Vito reasoning or tool work without blocking the conversation.",
              parameters: {
                type: "object",
                properties: { question: { type: "string" } },
                required: ["question"],
                additionalProperties: false,
              },
            },
            {
              type: "function",
              name: "get_task",
              description: "Check an asynchronous Vito task.",
              parameters: {
                type: "object",
                properties: { id: { type: "string" } },
                required: ["id"],
                additionalProperties: false,
              },
            },
            {
              type: "function",
              name: "cancel_task",
              description: "Cancel an asynchronous Vito task.",
              parameters: {
                type: "object",
                properties: { id: { type: "string" } },
                required: ["id"],
                additionalProperties: false,
              },
            },
          ],
          audio: {
            input: {
              transcription: { model: "gpt-4o-mini-transcribe" },
              turn_detection: { type: "semantic_vad" },
            },
            output: { voice: "marin" },
          },
        },
      }),
    });
    if (!response.ok) throw new Error(`OpenAI Realtime token request failed (${response.status})`);
    return await response.json();
  }

  recordEvent(
    x: Context,
    event: { sessionId: string; kind: VoiceEventKind; content: string },
  ): void {
    const now = Date.now();
    const sessions = xSessionStore(x);
    if (!sessions.list(x, { ids: [event.sessionId] }).length) {
      sessions.create(x, {
        id: event.sessionId,
        channel: "voice",
        channel_target: event.sessionId.slice(6),
        created_at: now,
        last_active_at: now,
        config: "{}",
        alias: `Voice — ${new Date(now).toLocaleString("en-CA")}`,
      });
    } else {
      sessions.update(x, { id: event.sessionId, changes: { last_active_at: now } });
    }
    xMessageStore(x).create(x, {
      session_id: event.sessionId,
      channel: "voice",
      channel_target: event.sessionId.slice(6),
      timestamp: now,
      type: event.kind === "user" ? "user" : event.kind === "assistant" ? "assistant" : "tool_end",
      content: event.content,
      archived: 0,
      author: event.kind === "user" ? "mcarcaso" : "Vito Voice",
    });
  }

  listSessions(x: Context, limit = 25) {
    return xSessionStore(x).list(x, { channels: ["voice"], order: "recent", limit });
  }

  getSession(x: Context, sessionId: string): VoiceSessionDetail | null {
    const session = xSessionStore(x).list(x, { ids: [sessionId] })[0];
    if (!session || session.channel !== "voice") return null;
    const messages = xMessageStore(x).list(x, { sessionIds: [sessionId], order: "oldest" });
    const metadata = messages.filter((message) => message.type === "tool_end");
    const usage: unknown[] = [];
    let durationMs: number | null = null;
    for (const message of metadata) {
      try {
        const value = JSON.parse(message.content) as unknown;
        if (value && typeof value === "object" && "durationMs" in value) {
          const duration = (value as { durationMs?: unknown }).durationMs;
          if (typeof duration === "number") durationMs = duration;
        } else usage.push(value);
      } catch {
        // Retain malformed historical metadata only in the raw message list.
      }
    }
    return { session, messages, durationMs, usage };
  }

  getContext(x: Context) {
    const profile = xMemoryService(x).getProfile(x);
    return {
      // Realtime data channels and conversational context both benefit from a
      // small curated payload. Full-profile retrieval belongs behind search.
      currentDate: new Date().toLocaleDateString("en-CA"),
      profile: profile?.slice(0, 8_000) ?? null,
      recentVoiceSessions: this.listSessions(x, 5),
    };
  }

  async searchMemory(
    x: Context,
    query: string,
    mode: "hybrid" | "semantic" | "exact",
    day?: string,
  ): Promise<SearchResult[]> {
    const lowered = query.toLowerCase();
    const targetDay =
      day ??
      (lowered.includes("yesterday")
        ? new Date(Date.now() - 86_400_000).toLocaleDateString("en-CA")
        : lowered.includes("today")
          ? new Date().toLocaleDateString("en-CA")
          : undefined);
    const results = await xMemoryService(x).search(x, query, {
      limit: 5,
      dayFilter: targetDay,
      mode: mode === "semantic" ? "embedding" : mode === "exact" ? "bm25" : "hybrid",
    });
    return results.map((result) => ({
      ...result,
      text: result.text.slice(0, 1_600),
      context: result.context?.slice(0, 500) ?? null,
    }));
  }

  askAsync(x: Context, voiceSessionId: string, question: string): VoiceTaskRow {
    const now = Date.now();
    const task = xVoiceTaskStore(x).create(x, {
      id: randomUUID(),
      voice_session_id: voiceSessionId,
      question,
      status: "queued",
      result: null,
      error: null,
      created_at: now,
      updated_at: now,
    });
    void this.runTask(x, task.id, question);
    return task;
  }

  getTask(x: Context, id: string): VoiceTaskRow | null {
    return xVoiceTaskStore(x).get(x, id);
  }

  cancelTask(x: Context, id: string): VoiceTaskRow {
    const task = xVoiceTaskStore(x).get(x, id);
    if (!task) throw new Error("Voice task not found");
    if (task.status === "completed" || task.status === "failed") return task;
    return xVoiceTaskStore(x).update(x, id, { status: "cancelled", updated_at: Date.now() });
  }

  private async runTask(x: Context, id: string, question: string): Promise<void> {
    const store = xVoiceTaskStore(x);
    store.update(x, id, { status: "running", updated_at: Date.now() });
    try {
      const result = await this.askApiService.ask(x, {
        question,
        session: `voice-task:${id}`,
        author: "mcarcaso",
        timeoutMs: 600_000,
        relayToSession: false,
      });
      if (store.get(x, id)?.status === "cancelled") return;
      store.update(x, id, { status: "completed", result, updated_at: Date.now() });
    } catch {
      if (store.get(x, id)?.status === "cancelled") return;
      store.update(x, id, {
        status: "failed",
        error: "Vito could not complete this task",
        updated_at: Date.now(),
      });
    }
  }
}
