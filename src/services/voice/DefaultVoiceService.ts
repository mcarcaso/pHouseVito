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
  RealtimeModel,
  RealtimeVoice,
  VoiceEventKind,
  VoiceService,
  VoiceSessionDetail,
} from "./VoiceService.js";

function voiceInstructions(x: Context): string {
  const today = new Date().toLocaleDateString("en-CA");
  const vito = xVitoService(x);
  const agentName = vito.getConfig(x).bot?.name?.trim() || "the user's agent";
  const soul = vito.getSoul(x).trim();
  const profile = xMemoryService(x).getProfile(x)?.trim() ?? "";
  const personality = soul ? `\n\n<personality>\n${soul}\n</personality>` : "";
  const userProfile = profile ? `\n\n<user_profile>\n${profile}\n</user_profile>` : "";
  return `You are ${agentName}, the user's concise personal voice companion. Today is ${today}. Speak naturally, warmly, and directly while following the personality instructions below. Keep answers brief unless the user asks for detail. Treat very short greetings or fragments as tentative openings: respond with one short line, avoid stacking multiple questions, and leave room for the user to continue. Stable knowledge of the user is provided in user_profile; answer directly from it when possible. For anything requiring conversation history, uncertain recall, deeper reasoning, current information, a skill, or an external action, create an agent task using the user's complete natural-language request. Creating a task returns immediately so conversation can continue. Acknowledge it once, never poll automatically, and never claim an action completed from a queued response. The companion monitors task status, adds completed results to your context, and may prompt you at a natural quiet opening to announce a result proactively. When prompted, briefly say the task finished and deliver the useful result without calling a tool or repeating the request. Only call get_vito_task when the user explicitly asks you to check a task. Completed task responses contain the final answer or verified result only; do not ask for private reasoning or intermediate tool chatter. The user is the authenticated owner and may ask about their own profile. Consequential communication with real people still requires explicit confirmation before creating the task. Never fabricate memory, tool use, or completion.${personality}${userProfile}`;
}

const voiceToolDeclarations = [
  {
    name: "create_vito_task",
    description:
      "Create background authoritative Vito reasoning or tool work—including memory research and external actions—and immediately return a task ID so conversation can continue.",
    parameters: {
      type: "object",
      properties: { question: { type: "string" } },
      required: ["question"],
    },
  },
  {
    name: "get_vito_task",
    description:
      "Get a task's status or final response. Call only when the user explicitly asks to check that task.",
    parameters: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
] as const;

export class DefaultVoiceService implements VoiceService {
  constructor(private readonly askApiService: AskApiService) {}

  getStatus(x: Context) {
    const providers = {
      openai: Boolean(xSecretService(x).get(x, "OPENAI_API_KEY")),
      gemini: Boolean(xSecretService(x).get(x, "GOOGLE_GENERATIVE_AI_API_KEY")),
    };
    const provider = providers.gemini
      ? ("gemini" as const)
      : providers.openai
        ? ("openai" as const)
        : null;
    return {
      available: provider !== null,
      provider,
      reason: provider ? null : "Live Voice requires an OpenAI or Google AI API key.",
      providers,
    };
  }

  async createRealtimeSecret(
    x: Context,
    voice: RealtimeVoice,
    model: RealtimeModel,
  ): Promise<unknown> {
    const apiKey = xSecretService(x).get(x, "OPENAI_API_KEY");
    if (!apiKey) throw new Error("OpenAI API key is not configured");
    const instructions = voiceInstructions(x);
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
          model,
          instructions,
          tools: [
            {
              type: "function",
              name: "create_vito_task",
              description:
                "Create background authoritative Vito reasoning or tool work—including memory research and external actions—and immediately return a task ID so conversation can continue.",
              parameters: {
                type: "object",
                properties: { question: { type: "string" } },
                required: ["question"],
                additionalProperties: false,
              },
            },
            {
              type: "function",
              name: "get_vito_task",
              description:
                "Get a task's status or final response. Call only when the user explicitly asks to check that task.",
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
              turn_detection: { type: "semantic_vad", eagerness: "medium" },
            },
            output: { voice },
          },
        },
      }),
    });
    if (!response.ok) throw new Error(`OpenAI Realtime token request failed (${response.status})`);
    return await response.json();
  }

  async createGeminiRealtimeSecret(x: Context, voice: string): Promise<unknown> {
    const apiKey = xSecretService(x).get(x, "GOOGLE_GENERATIVE_AI_API_KEY");
    if (!apiKey) throw new Error("Google AI API key is not configured");
    const now = Date.now();
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/auth_tokens", {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        uses: 1,
        expireTime: new Date(now + 30 * 60_000).toISOString(),
        newSessionExpireTime: new Date(now + 60_000).toISOString(),
      }),
    });
    if (!response.ok) {
      throw new Error(`Gemini Live token request failed (${response.status})`);
    }
    const token = (await response.json()) as { name?: unknown };
    if (typeof token.name !== "string" || !token.name) {
      throw new Error("Gemini Live token response was invalid");
    }
    return {
      value: token.name,
      model: "gemini-3.1-flash-live-preview",
      voice,
      instructions: voiceInstructions(x),
      tools: voiceToolDeclarations,
    };
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
        alias:
          event.kind === "user"
            ? event.content.slice(0, 80)
            : `Voice — ${new Date(now).toLocaleString("en-CA")}`,
      });
    } else {
      const current = sessions.list(x, { ids: [event.sessionId] })[0];
      sessions.update(x, {
        id: event.sessionId,
        changes: {
          last_active_at: now,
          ...(event.kind === "user" && current?.alias?.startsWith("Voice —")
            ? { alias: event.content.slice(0, 80) }
            : {}),
        },
      });
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
    return {
      session,
      messages,
      durationMs,
      usage,
      tasks: xVoiceTaskStore(x).listBySession(x, sessionId),
    };
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
        question,
        // A dedicated Vito session gives every delegated task its own orchestrator
        // queue and Pi runtime, so independent voice work can execute in parallel.
        session: `voice-investigator:${id}`,
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
