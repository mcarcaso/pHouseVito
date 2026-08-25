import type { Context } from "../../context/Context.js";
import { xQuickCommandStore, xSecretService, xSessionStore } from "../../lib/x.js";
import type { QuickCommandRow } from "../../stores/quick-commands/QuickCommandStore.js";
import type { AskApiService } from "../ask/AskApiService.js";
import type { QuickCommandService } from "./QuickCommandService.js";

export class DefaultQuickCommandService implements QuickCommandService {
  constructor(private readonly askApiService: AskApiService) {}

  submit(
    x: Context,
    input: {
      id: string;
      audioBase64: string;
      mimeType: string;
      durationMs: number;
      session?: string;
    },
  ): QuickCommandRow {
    const store = xQuickCommandStore(x);
    const existing = store.get(x, input.id);
    if (existing) return existing;
    const now = Date.now();
    const row = store.create(x, {
      id: input.id,
      status: "queued",
      transcript: null,
      result: null,
      error: null,
      created_at: now,
      updated_at: now,
    });
    void this.process(x, input).catch((cause) => {
      store.update(x, input.id, {
        status: "failed",
        error: cause instanceof Error ? cause.message : "Quick command failed",
        updated_at: Date.now(),
      });
    });
    return row;
  }

  get(x: Context, id: string): QuickCommandRow | null {
    return xQuickCommandStore(x).get(x, id);
  }
  private async process(
    x: Context,
    input: {
      id: string;
      audioBase64: string;
      mimeType: string;
      durationMs: number;
      session?: string;
    },
  ): Promise<void> {
    const store = xQuickCommandStore(x);
    if (input.durationMs < 650 || Buffer.byteLength(input.audioBase64, "base64") < 1_000) {
      store.update(x, input.id, { status: "empty", updated_at: Date.now() });
      return;
    }
    store.update(x, input.id, { status: "transcribing", updated_at: Date.now() });
    const transcript = (await this.transcribe(x, input.audioBase64, input.mimeType)).trim();
    if (!transcript || /^[\s.?!,]*$/.test(transcript)) {
      store.update(x, input.id, {
        status: "empty",
        transcript: transcript || null,
        updated_at: Date.now(),
      });
      return;
    }
    store.update(x, input.id, { status: "processing", transcript, updated_at: Date.now() });
    const session = input.session || "quick-command:default";
    const result = await this.askApiService.ask(x, {
      question: transcript,
      session,
      author: "mcarcaso",
      timeoutMs: 600_000,
      relayToSession: false,
    });
    store.update(x, input.id, { status: "completed", result, updated_at: Date.now() });
    if (session === `quick-command:${input.id}`) {
      const existing = xSessionStore(x).list(x, { ids: [session], limit: 1 })[0];
      if (existing) {
        const alias = transcript.length > 64 ? `${transcript.slice(0, 61).trimEnd()}…` : transcript;
        xSessionStore(x).update(x, { id: session, changes: { alias } });
      }
    }
  }

  private async transcribe(x: Context, audioBase64: string, mimeType: string): Promise<string> {
    const secrets = xSecretService(x);
    const openAiKey = secrets.get(x, "OPENAI_API_KEY");
    const openRouterKey = secrets.get(x, "OPENROUTER_API_KEY");
    let openAiError: Error | null = null;

    if (openAiKey) {
      try {
        return await this.transcribeWithOpenAi(openAiKey, audioBase64, mimeType);
      } catch (cause) {
        openAiError = cause instanceof Error ? cause : new Error("OpenAI transcription failed");
        if (!openRouterKey) throw openAiError;
        console.warn(`[QuickCommand] ${openAiError.message}; falling back to OpenRouter STT`);
      }
    }

    if (openRouterKey)
      return await this.transcribeWithOpenRouter(openRouterKey, audioBase64, mimeType);
    if (openAiError) throw openAiError;
    throw new Error(
      "No transcription provider is configured: add OPENAI_API_KEY or OPENROUTER_API_KEY",
    );
  }

  private async transcribeWithOpenAi(
    key: string,
    audioBase64: string,
    mimeType: string,
  ): Promise<string> {
    const extension = this.audioExtension(mimeType);
    const form = new FormData();
    form.append("model", "gpt-4o-mini-transcribe");
    form.append(
      "file",
      new Blob([Buffer.from(audioBase64, "base64")], { type: mimeType }),
      `command.${extension}`,
    );
    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    if (!response.ok) throw new Error(`OpenAI transcription failed (${response.status})`);
    return await this.transcriptionText(response);
  }

  private async transcribeWithOpenRouter(
    key: string,
    audioBase64: string,
    mimeType: string,
  ): Promise<string> {
    const response = await fetch("https://openrouter.ai/api/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://theworstproductions.com",
        "X-Title": "Vito Quick Command",
      },
      body: JSON.stringify({
        model: "openai/whisper-large-v3",
        input_audio: { data: audioBase64, format: this.audioExtension(mimeType) },
      }),
    });
    if (!response.ok) throw new Error(`OpenRouter transcription failed (${response.status})`);
    return await this.transcriptionText(response);
  }

  private audioExtension(mimeType: string): "webm" | "wav" | "m4a" {
    return mimeType.includes("webm") ? "webm" : mimeType.includes("wav") ? "wav" : "m4a";
  }

  private async transcriptionText(response: Response): Promise<string> {
    const body = (await response.json()) as { text?: unknown };
    return typeof body.text === "string" ? body.text : "";
  }
}
