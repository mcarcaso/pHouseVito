import express from "express";
import { z } from "zod";
import type { Router } from "express";
import type { Context } from "../context/Context.js";
import { xSecretService } from "../lib/x.js";
import type { RouterService } from "./RouterService.js";
import { emptyRouteSchema, registerRoute, unknownRouteSchema } from "./register-route.js";

const providerSchema = z.enum(["gemini", "openai", "elevenlabs", "openrouter"]);
const commonVoices = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "nova",
  "onyx",
  "sage",
  "shimmer",
  "verse",
];
const geminiVoices = [
  "Zephyr",
  "Puck",
  "Charon",
  "Kore",
  "Fenrir",
  "Leda",
  "Orus",
  "Aoede",
  "Callirrhoe",
  "Autonoe",
  "Enceladus",
  "Iapetus",
  "Umbriel",
  "Algieba",
  "Despina",
  "Erinome",
  "Algenib",
  "Rasalgethi",
  "Laomedeia",
  "Achernar",
  "Alnilam",
  "Schedar",
  "Gacrux",
  "Pulcherrima",
  "Achird",
  "Zubenelgenubi",
  "Vindemiatrix",
  "Sadachbia",
  "Sadaltager",
  "Sulafat",
];
const voiceSchema = z.object({ id: z.string(), name: z.string() });
const speechModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  voices: z.array(voiceSchema),
});

function voiceName(id: string): string {
  return id
    .replace(/^(?:flux|aura)-/, "")
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => (part.length <= 3 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1)))
    .join(" ");
}

async function ensureResponse(response: Response, provider: string): Promise<Response> {
  if (response.ok) return response;
  const detail = (await response.text()).slice(0, 500);
  throw new Error(`${provider} speech request failed (${response.status}): ${detail}`);
}

function pcmToWav(pcm: Buffer, sampleRate: number, channels: number): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * 2;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function geminiAudio(body: unknown): { data: string; sampleRate: number; channels: number } {
  if (!body || typeof body !== "object" || !("steps" in body))
    throw new Error("Gemini speech response did not contain audio");
  const steps = (body as { steps?: unknown }).steps;
  if (!Array.isArray(steps)) throw new Error("Gemini speech response did not contain audio");
  for (const step of steps) {
    if (!step || typeof step !== "object" || !("content" in step)) continue;
    const content = (step as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const item of content) {
      if (!item || typeof item !== "object") continue;
      const audio = item as {
        type?: unknown;
        data?: unknown;
        sample_rate?: unknown;
        channels?: unknown;
      };
      if (audio.type === "audio" && typeof audio.data === "string") {
        return {
          data: audio.data,
          sampleRate: typeof audio.sample_rate === "number" ? audio.sample_rate : 24_000,
          channels: typeof audio.channels === "number" ? audio.channels : 1,
        };
      }
    }
  }
  throw new Error("Gemini speech response did not contain audio");
}

export class SpeechRouterService implements RouterService {
  async createRouter(x: Context): Promise<Router> {
    const router = express.Router();
    registerRoute(x, {
      router,
      method: "GET",
      path: "/voices",
      auth: "dashboard",
      schemas: {
        params: emptyRouteSchema,
        query: z.object({ provider: providerSchema }),
        body: unknownRouteSchema,
      },
      responseSchema: z.object({
        configured: z.boolean(),
        voices: z.array(voiceSchema),
        models: z.array(speechModelSchema),
      }),
      handler: async (routeX, { data: { query } }) => {
        const secrets = xSecretService(routeX);
        const keyName =
          query.provider === "gemini"
            ? "GOOGLE_GENERATIVE_AI_API_KEY"
            : query.provider === "openai"
              ? "OPENAI_API_KEY"
              : query.provider === "elevenlabs"
                ? "ELEVEN_LABS_API_KEY"
                : "OPENROUTER_API_KEY";
        const key = secrets.get(routeX, keyName);
        if (!key) return { configured: false, voices: [], models: [] };
        if (query.provider === "openai" || query.provider === "gemini") {
          const availableVoices = query.provider === "gemini" ? geminiVoices : commonVoices;
          return {
            configured: true,
            voices: availableVoices.map((voice) => ({
              id: voice,
              name: voice[0].toUpperCase() + voice.slice(1),
            })),
            models: [],
          };
        }
        if (query.provider === "openrouter") {
          const response = await ensureResponse(
            await fetch("https://openrouter.ai/api/v1/models?output_modalities=speech", {
              headers: { Authorization: `Bearer ${key}` },
            }),
            "OpenRouter",
          );
          const body = (await response.json()) as {
            data?: Array<{
              id?: unknown;
              name?: unknown;
              supported_voices?: unknown;
            }>;
          };
          const models = (body.data ?? []).flatMap((model) => {
            if (
              typeof model.id !== "string" ||
              typeof model.name !== "string" ||
              !Array.isArray(model.supported_voices)
            )
              return [];
            const voices = model.supported_voices.flatMap((voice) =>
              typeof voice === "string" ? [{ id: voice, name: voiceName(voice) }] : [],
            );
            return voices.length > 0 ? [{ id: model.id, name: model.name, voices }] : [];
          });
          return { configured: true, voices: [], models };
        }
        const response = await ensureResponse(
          await fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": key } }),
          "ElevenLabs",
        );
        const body = (await response.json()) as {
          voices?: Array<{ voice_id?: unknown; name?: unknown }>;
        };
        return {
          configured: true,
          voices: (body.voices ?? []).flatMap((voice) =>
            typeof voice.voice_id === "string" && typeof voice.name === "string"
              ? [{ id: voice.voice_id, name: voice.name }]
              : [],
          ),
          models: [],
        };
      },
    });
    registerRoute(x, {
      router,
      method: "POST",
      path: "/synthesize",
      auth: "dashboard",
      jsonLimit: "1mb",
      schemas: {
        params: emptyRouteSchema,
        query: emptyRouteSchema,
        body: z.object({
          provider: providerSchema,
          voice: z.string().min(1).max(200),
          text: z.string().min(1).max(20_000),
          model: z.string().min(1).max(200).optional(),
        }),
      },
      responseSchema: z.object({
        data: z.string(),
        mimeType: z.enum(["audio/mpeg", "audio/wav"]),
      }),
      handler: async (routeX, { data: { body } }) => {
        const secrets = xSecretService(routeX);
        if (body.provider === "gemini") {
          const key = secrets.get(routeX, "GOOGLE_GENERATIVE_AI_API_KEY");
          if (!key) throw new Error("Google AI API key is not configured");
          const response = await ensureResponse(
            await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": key,
                "Api-Revision": "2026-05-20",
              },
              body: JSON.stringify({
                model: body.model || "gemini-3.1-flash-tts-preview",
                input: `Read the following text exactly. Speak with a natural, understated New York wiseguy cadence and Italian-American energy. Keep it confident, subtle, and believable rather than exaggerated or cartoonish.\n\n${body.text}`,
                response_format: { type: "audio" },
                generation_config: { speech_config: [{ voice: body.voice }] },
              }),
            }),
            "Gemini",
          );
          const audio = geminiAudio(await response.json());
          const wav = pcmToWav(Buffer.from(audio.data, "base64"), audio.sampleRate, audio.channels);
          return { data: wav.toString("base64"), mimeType: "audio/wav" as const };
        }
        let response: Response;
        if (body.provider === "elevenlabs") {
          const key = secrets.get(routeX, "ELEVEN_LABS_API_KEY");
          if (!key) throw new Error("ElevenLabs API key is not configured");
          response = await fetch(
            `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(body.voice)}?output_format=mp3_44100_128`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json", "xi-api-key": key },
              body: JSON.stringify({
                text: body.text,
                model_id: body.model || "eleven_multilingual_v2",
              }),
            },
          );
        } else {
          const openRouter = body.provider === "openrouter";
          const key = secrets.get(routeX, openRouter ? "OPENROUTER_API_KEY" : "OPENAI_API_KEY");
          if (!key)
            throw new Error(`${openRouter ? "OpenRouter" : "OpenAI"} API key is not configured`);
          response = await fetch(
            openRouter
              ? "https://openrouter.ai/api/v1/audio/speech"
              : "https://api.openai.com/v1/audio/speech",
            {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
              body: JSON.stringify({
                model:
                  body.model ||
                  (openRouter ? "openai/gpt-4o-mini-tts-2025-12-15" : "gpt-4o-mini-tts"),
                input: body.text,
                voice: body.voice,
                instructions:
                  "Speak with a natural, understated New York wiseguy cadence and Italian-American mobster energy. Keep it believable, confident, and subtle rather than exaggerated or cartoonish.",
                response_format: "mp3",
              }),
            },
          );
        }
        await ensureResponse(response, body.provider);
        return {
          data: Buffer.from(await response.arrayBuffer()).toString("base64"),
          mimeType: "audio/mpeg" as const,
        };
      },
    });
    return router;
  }
}
