import express from "express";
import { z } from "zod";
import type { Router } from "express";
import type { Context } from "../context/Context.js";
import { xSecretService } from "../lib/x.js";
import type { RouterService } from "./RouterService.js";
import { emptyRouteSchema, registerRoute, unknownRouteSchema } from "./register-route.js";

const providerSchema = z.enum(["openai", "elevenlabs", "openrouter"]);
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
const voiceSchema = z.object({ id: z.string(), name: z.string() });

async function ensureResponse(response: Response, provider: string): Promise<Response> {
  if (response.ok) return response;
  const detail = (await response.text()).slice(0, 500);
  throw new Error(`${provider} speech request failed (${response.status}): ${detail}`);
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
      responseSchema: z.object({ configured: z.boolean(), voices: z.array(voiceSchema) }),
      handler: async (routeX, { data: { query } }) => {
        const secrets = xSecretService(routeX);
        const keyName =
          query.provider === "openai"
            ? "OPENAI_API_KEY"
            : query.provider === "elevenlabs"
              ? "ELEVEN_LABS_API_KEY"
              : "OPENROUTER_API_KEY";
        const key = secrets.get(routeX, keyName);
        if (!key) return { configured: false, voices: [] };
        if (query.provider !== "elevenlabs") {
          return {
            configured: true,
            voices: commonVoices.map((voice) => ({
              id: voice,
              name: voice[0].toUpperCase() + voice.slice(1),
            })),
          };
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
      responseSchema: z.object({ data: z.string(), mimeType: z.literal("audio/mpeg") }),
      handler: async (routeX, { data: { body } }) => {
        const secrets = xSecretService(routeX);
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
