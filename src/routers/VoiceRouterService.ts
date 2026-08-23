import express from "express";
import type { Router } from "express";
import { z } from "zod";
import type { Context } from "../context/Context.js";
import { xMessageStore, xSecretService, xSessionStore } from "../lib/x.js";
import type { RouterService } from "./RouterService.js";
import { emptyRouteSchema, registerRoute, unknownRouteSchema } from "./register-route.js";

const voiceEventSchema = z.object({
  sessionId: z.string().startsWith("voice:").max(120),
  kind: z.enum(["user", "assistant", "usage"]),
  content: z.string().min(1).max(100_000),
});

const realtimeClientSecretSchema = z
  .object({
    value: z.string().min(1),
    expires_at: z.number().optional(),
  })
  .passthrough();

export class VoiceRouterService implements RouterService {
  async createRouter(x: Context): Promise<Router> {
    const router = express.Router();

    registerRoute(x, {
      router,
      method: "POST",
      path: "/realtime-token",
      auth: "dashboard",
      schemas: {
        params: emptyRouteSchema,
        query: emptyRouteSchema,
        body: unknownRouteSchema,
      },
      responseSchema: realtimeClientSecretSchema,
      handler: async (routeX) => {
        const apiKey = xSecretService(routeX).get(routeX, "OPENAI_API_KEY");
        if (!apiKey) throw new Error("OpenAI API key is not configured");

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
              instructions:
                "You are Vito, Mike Carcasole's concise personal voice assistant. Speak naturally, warmly, and directly. Keep answers brief unless Mike asks for detail. Do not claim to have used tools or memory in this initial voice test.",
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
        if (!response.ok)
          throw new Error(`OpenAI Realtime token request failed (${response.status})`);
        return realtimeClientSecretSchema.parse(await response.json());
      },
    });

    registerRoute(x, {
      router,
      method: "POST",
      path: "/event",
      auth: "dashboard",
      schemas: {
        params: emptyRouteSchema,
        query: emptyRouteSchema,
        body: voiceEventSchema,
      },
      responseSchema: z.object({ ok: z.literal(true) }),
      handler: (routeX, { data: { body } }) => {
        const now = Date.now();
        const sessions = xSessionStore(routeX).list(routeX, { ids: [body.sessionId] });
        if (sessions.length === 0) {
          xSessionStore(routeX).create(routeX, {
            id: body.sessionId,
            channel: "voice",
            channel_target: body.sessionId.slice("voice:".length),
            created_at: now,
            last_active_at: now,
            config: "{}",
            alias: `Voice — ${new Date(now).toLocaleString("en-CA")}`,
          });
        } else {
          xSessionStore(routeX).update(routeX, {
            id: body.sessionId,
            changes: { last_active_at: now },
          });
        }
        xMessageStore(routeX).create(routeX, {
          session_id: body.sessionId,
          channel: "voice",
          channel_target: body.sessionId.slice("voice:".length),
          timestamp: now,
          type:
            body.kind === "user" ? "user" : body.kind === "assistant" ? "assistant" : "tool_end",
          content: body.content,
          archived: 0,
          author: body.kind === "user" ? "mcarcaso" : "Vito Voice",
        });
        return { ok: true as const };
      },
    });

    return router;
  }
}
