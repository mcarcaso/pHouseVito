import express from "express";
import type { Router } from "express";
import { z } from "zod";
import type { Context } from "../context/Context.js";
import { xSecretService } from "../lib/x.js";
import type { RouterService } from "./RouterService.js";
import { emptyRouteSchema, registerRoute, unknownRouteSchema } from "./register-route.js";

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

    return router;
  }
}
