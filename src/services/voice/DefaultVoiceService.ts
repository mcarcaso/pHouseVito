import { randomUUID } from "node:crypto";
import type { Context } from "../../context/Context.js";
import {
  xMemoryService,
  xMessageStore,
  xSecretService,
  xSessionStore,
  xVitoService,
  xVoiceTaskStore,
} from "../../lib/x.js";
import type { VoiceTaskRow } from "../../stores/voice/VoiceTaskStore.js";
import type { AskApiService } from "../ask/AskApiService.js";
import type { SearchResult } from "../memory/MemoryService.js";
import type {
  RealtimeVoice,
  VoiceEventKind,
  VoiceService,
  VoiceSessionDetail,
} from "./VoiceService.js";

export class DefaultVoiceService implements VoiceService {
  constructor(private readonly askApiService: AskApiService) {}

  async createRealtimeSecret(x: Context, voice: RealtimeVoice): Promise<unknown> {
    const apiKey = xSecretService(x).get(x, "OPENAI_API_KEY");
    if (!apiKey) throw new Error("OpenAI API key is not configured");
    const today = new Date().toLocaleDateString("en-CA");
    const soul = xVitoService(x).getSoul(x).trim();
    const personality = soul ? `\n\n<personality>\n${soul}\n</personality>` : "";
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
          model: "gpt-realtime-2.1",
          instructions: `You are Vito, Mike Carcasole's concise personal voice assistant. Today is ${today}. Speak naturally, warmly, and directly. Keep answers brief unless Mike asks for detail. Use the available Vito tools when personal context, memory, or durable reasoning is needed. For references such as yesterday, last night, last time, or an explicit date, resolve the local date and pass the narrowest appropriate startDate/endDate range so candidates are constrained before ranking. Omit date ranges for durable facts such as names, relationships, identity, or preferences. Keep the query faithful to Mike's words; do not inject guessed subjects such as health anxiety unless he mentioned them. For stable personal facts such as names, relationships, preferences, or identity, use get_vito_context first. Mike is the authenticated owner; answer personal facts from his profile or memory directly rather than refusing merely because they are personal. If Mike corrects or narrows the subject, search again rather than relying on the previous result. For ambiguous personal-history questions that require connecting related entities, recommendations, or actions across separate conversations, skip repeated shallow searches and call ask_vito_async immediately. For other personal-history questions, never conclude that no memory exists merely because one or two searches were inconclusive. Before giving up, call ask_vito_async with Mike's original question plus the failed search terms so authoritative Vito can inspect exact message history, semantic memory, related entities, and available tools. Tell Mike briefly that you are doing a deeper check. Do not poll or cancel the task; the companion will automatically deliver its completed result back into the conversation. Before using tools, give at most one short acknowledgment. If additional tool calls are needed, perform them silently without repeating phrases such as 'let me check' or narrating each search. Never infer a personal fact from an unrelated result, and never claim a tool result before receiving it.${personality}`,
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
                "Search Vito's durable conversation memory. Use date ranges only when Mike asks about a particular time; omit them for durable personal facts.",
              parameters: {
                type: "object",
                properties: {
                  query: {
                    type: "string",
                    description: "Mike's question, preserving his actual subject terms.",
                  },
                  startDate: {
                    type: "string",
                    description:
                      "Optional inclusive local start date in YYYY-MM-DD. Use for explicit or relative time questions.",
                  },
                  endDate: {
                    type: "string",
                    description:
                      "Optional inclusive local end date in YYYY-MM-DD. For one day, equal startDate.",
                  },
                  mode: {
                    type: "string",
                    enum: ["hybrid", "semantic", "exact"],
                    description:
                      "Optional retrieval mode. Hybrid is the default; exact favors literal terms.",
                  },
                  limit: {
                    type: "integer",
                    minimum: 1,
                    maximum: 10,
                    description: "Optional result count; defaults to 5.",
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
                "Escalate to authoritative Vito for deeper reasoning, exact message-history lookup, related-entity inference, or tool work. Required before declaring that personal history cannot be found after inconclusive memory searches.",
              parameters: {
                type: "object",
                properties: { question: { type: "string" } },
                required: ["question"],
                additionalProperties: false,
              },
            },
          ],
          audio: {
            input: {
              transcription: { model: "gpt-4o-mini-transcribe" },
              turn_detection: { type: "semantic_vad" },
            },
            output: { voice },
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
    options: {
      mode?: "hybrid" | "semantic" | "exact";
      startDate?: string;
      endDate?: string;
      limit?: number;
    } = {},
  ): Promise<SearchResult[]> {
    const results = await xMemoryService(x).search(x, query, {
      limit: Math.min(Math.max(options.limit ?? 5, 1), 10),
      dayStart: options.startDate,
      dayEnd: options.endDate,
      mode:
        options.mode === "semantic" ? "embedding" : options.mode === "exact" ? "bm25" : "hybrid",
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
        question: `Voice escalation from Mike. Investigate before answering: search semantic memory and exact message history as needed, follow related entities rather than requiring the same words to appear together, and distinguish what was recommended from what Mike confirmed doing.\n\n${question}`,
        session: "voice-investigator:default",
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
