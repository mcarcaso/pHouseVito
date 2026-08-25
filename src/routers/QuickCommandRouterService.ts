import express from "express";
import type { Router } from "express";
import { z } from "zod";
import type { Context } from "../context/Context.js";
import { xQuickCommandService } from "../lib/x.js";
import type { RouterService } from "./RouterService.js";
import { emptyRouteSchema, registerRoute, unknownRouteSchema } from "./register-route.js";

const idSchema = z
  .string()
  .min(8)
  .max(120)
  .regex(/^[a-zA-Z0-9_-]+$/);
const commandSchema = z.object({
  id: idSchema,
  audioBase64: z.string().min(1).max(25_000_000),
  mimeType: z.enum(["audio/m4a", "audio/mp4", "audio/x-m4a", "audio/webm", "audio/wav"]),
  durationMs: z
    .number()
    .int()
    .min(0)
    .max(30 * 60 * 1000),
  session: z.string().min(1).max(300).optional(),
});
const rowSchema = z.object({
  id: z.string(),
  status: z.enum(["queued", "transcribing", "processing", "completed", "empty", "failed"]),
  transcript: z.string().nullable(),
  result: z.string().nullable(),
  error: z.string().nullable(),
  created_at: z.number(),
  updated_at: z.number(),
});

export class QuickCommandRouterService implements RouterService {
  async createRouter(x: Context): Promise<Router> {
    const router = express.Router();
    registerRoute(x, {
      router,
      method: "POST",
      path: "/",
      auth: "dashboard",
      jsonLimit: "35mb",
      schemas: { params: emptyRouteSchema, query: emptyRouteSchema, body: commandSchema },
      responseSchema: rowSchema,
      handler: (routeX, { data: { body } }) => xQuickCommandService(routeX).submit(routeX, body),
    });
    registerRoute(x, {
      router,
      method: "GET",
      path: "/:id",
      auth: "dashboard",
      schemas: {
        params: z.object({ id: idSchema }),
        query: emptyRouteSchema,
        body: unknownRouteSchema,
      },
      responseSchema: rowSchema.nullable(),
      handler: (routeX, { data: { params } }) =>
        xQuickCommandService(routeX).get(routeX, params.id),
    });
    registerRoute(x, {
      router,
      method: "POST",
      path: "/devices",
      auth: "dashboard",
      schemas: {
        params: emptyRouteSchema,
        query: emptyRouteSchema,
        body: z.object({
          token: z.string().startsWith("ExponentPushToken[").max(300),
          platform: z.enum(["ios", "android"]),
        }),
      },
      responseSchema: z.object({ ok: z.literal(true) }),
      handler: (routeX, { data: { body } }) => {
        xQuickCommandService(routeX).registerPushDevice(routeX, body);
        return { ok: true as const };
      },
    });
    return router;
  }
}
