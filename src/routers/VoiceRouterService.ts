import express from "express";
import type { Router } from "express";
import { z } from "zod";
import type { Context } from "../context/Context.js";
import { xVoiceService } from "../lib/x.js";
import type { RouterService } from "./RouterService.js";
import { emptyRouteSchema, registerRoute, unknownRouteSchema } from "./register-route.js";

const sessionIdSchema = z.string().startsWith("voice:").max(120);
const voiceEventSchema = z.object({
  sessionId: sessionIdSchema,
  kind: z.enum(["user", "assistant", "usage", "session_end"]),
  content: z.string().min(1).max(100_000),
});
const realtimeVoiceSchema = z.enum([
  "alloy",
  "ash",
  "ballad",
  "cedar",
  "coral",
  "echo",
  "marin",
  "sage",
  "shimmer",
  "verse",
]);
const realtimeClientSecretSchema = z
  .object({ value: z.string().min(1), expires_at: z.number().optional() })
  .passthrough();
const taskSchema = z.object({
  id: z.string(),
  voice_session_id: sessionIdSchema,
  question: z.string(),
  status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
  result: z.string().nullable(),
  error: z.string().nullable(),
  created_at: z.number(),
  updated_at: z.number(),
});

export class VoiceRouterService implements RouterService {
  async createRouter(x: Context): Promise<Router> {
    const router = express.Router();
    const route = <T extends Parameters<typeof registerRoute>[1]>(definition: T) =>
      registerRoute(x, definition);

    route({
      router,
      method: "POST",
      path: "/realtime-token",
      auth: "dashboard",
      schemas: {
        params: emptyRouteSchema,
        query: emptyRouteSchema,
        body: z.object({ voice: realtimeVoiceSchema.default("marin") }),
      },
      responseSchema: realtimeClientSecretSchema,
      handler: async (routeX, { data: { body } }) =>
        realtimeClientSecretSchema.parse(
          await xVoiceService(routeX).createRealtimeSecret(routeX, body.voice),
        ),
    });

    route({
      router,
      method: "POST",
      path: "/event",
      auth: "dashboard",
      schemas: { params: emptyRouteSchema, query: emptyRouteSchema, body: voiceEventSchema },
      responseSchema: z.object({ ok: z.literal(true) }),
      handler: (routeX, { data: { body } }) => {
        xVoiceService(routeX).recordEvent(routeX, body);
        return { ok: true as const };
      },
    });

    route({
      router,
      method: "GET",
      path: "/sessions",
      auth: "dashboard",
      schemas: { params: emptyRouteSchema, query: emptyRouteSchema, body: unknownRouteSchema },
      responseSchema: unknownRouteSchema,
      handler: (routeX) => xVoiceService(routeX).listSessions(routeX),
    });

    route({
      router,
      method: "GET",
      path: "/sessions/:sessionId",
      auth: "dashboard",
      schemas: {
        params: z.object({ sessionId: sessionIdSchema }),
        query: emptyRouteSchema,
        body: unknownRouteSchema,
      },
      responseSchema: unknownRouteSchema,
      handler: (routeX, { data: { params } }) =>
        xVoiceService(routeX).getSession(routeX, params.sessionId),
    });

    route({
      router,
      method: "GET",
      path: "/context",
      auth: "dashboard",
      schemas: { params: emptyRouteSchema, query: emptyRouteSchema, body: unknownRouteSchema },
      responseSchema: unknownRouteSchema,
      handler: (routeX) => xVoiceService(routeX).getContext(routeX),
    });

    route({
      router,
      method: "POST",
      path: "/memory-search",
      auth: "dashboard",
      schemas: {
        params: emptyRouteSchema,
        query: emptyRouteSchema,
        body: z.object({
          query: z.string().min(1).max(2_000),
          mode: z.enum(["hybrid", "semantic", "exact"]).default("hybrid"),
          day: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
        }),
      },
      responseSchema: unknownRouteSchema,
      handler: async (routeX, { data: { body } }) =>
        await xVoiceService(routeX).searchMemory(routeX, body.query, body.mode, body.day),
    });

    route({
      router,
      method: "POST",
      path: "/tasks",
      auth: "dashboard",
      schemas: {
        params: emptyRouteSchema,
        query: emptyRouteSchema,
        body: z.object({ sessionId: sessionIdSchema, question: z.string().min(1).max(20_000) }),
      },
      responseSchema: taskSchema,
      handler: (routeX, { data: { body } }) =>
        xVoiceService(routeX).askAsync(routeX, body.sessionId, body.question),
    });

    route({
      router,
      method: "GET",
      path: "/tasks/:id",
      auth: "dashboard",
      schemas: {
        params: z.object({ id: z.string().uuid() }),
        query: emptyRouteSchema,
        body: unknownRouteSchema,
      },
      responseSchema: taskSchema.nullable(),
      handler: (routeX, { data: { params } }) => xVoiceService(routeX).getTask(routeX, params.id),
    });

    route({
      router,
      method: "POST",
      path: "/tasks/:id/cancel",
      auth: "dashboard",
      schemas: {
        params: z.object({ id: z.string().uuid() }),
        query: emptyRouteSchema,
        body: unknownRouteSchema,
      },
      responseSchema: taskSchema,
      handler: (routeX, { data: { params } }) =>
        xVoiceService(routeX).cancelTask(routeX, params.id),
    });

    return router;
  }
}
