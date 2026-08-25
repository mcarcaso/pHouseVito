import { createHash } from "node:crypto";
import express from "express";
import { z } from "zod";
import type { Router } from "express";
import type { Context } from "../context/Context.js";
import { xPushNotificationService } from "../lib/x.js";
import type { RouterService } from "./RouterService.js";
import { emptyRouteSchema, registerRoute } from "./register-route.js";

export class PushNotificationRouterService implements RouterService {
  async createRouter(x: Context): Promise<Router> {
    const service = xPushNotificationService(x);
    service.start(x);
    const router = express.Router();
    registerRoute(x, {
      router,
      method: "POST",
      path: "/devices",
      auth: "dashboard",
      schemas: {
        params: emptyRouteSchema,
        query: emptyRouteSchema,
        body: z.object({
          deviceId: z
            .string()
            .regex(/^[a-zA-Z0-9_-]{8,100}$/)
            .optional(),
          token: z.string().startsWith("ExponentPushToken[").max(300),
          platform: z.enum(["ios", "android"]),
          appId: z.string().min(1).max(100).optional(),
          showPreview: z.boolean().optional(),
        }),
      },
      responseSchema: z.object({ ok: z.literal(true) }),
      handler: async (routeX, { data: { body } }) => {
        const deviceId =
          body.deviceId ||
          `device_${createHash("sha256").update(body.token).digest("hex").slice(0, 32)}`;
        await xPushNotificationService(routeX).registerDevice(routeX, { ...body, deviceId });
        return { ok: true as const };
      },
    });
    return router;
  }
}
