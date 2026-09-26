import express from "express";
import type { Router } from "express";
import { z } from "zod";
import type { Context } from "../context/Context.js";
import { xOrchestratorService } from "../lib/x.js";
import type { RouterService } from "./RouterService.js";
import { emptyRouteSchema, registerRoute, unknownRouteSchema } from "./register-route.js";

const runSchema = z.object({
  sessionKey: z.string(),
  channel: z.string(),
  author: z.string(),
  preview: z.string(),
  status: z.enum(["active", "queued"]),
  timestamp: z.number(),
  id: z.string().optional(),
});

export class RunRouterService implements RouterService {
  async createRouter(x: Context): Promise<Router> {
    const router = express.Router();
    registerRoute(x, {
      router,
      method: "GET",
      path: "/",
      auth: "dashboard",
      schemas: { params: emptyRouteSchema, query: emptyRouteSchema, body: unknownRouteSchema },
      responseSchema: z.array(runSchema),
      handler: (routeX) => xOrchestratorService(routeX).listRuns(routeX),
    });
    registerRoute(x, {
      router,
      method: "POST",
      path: "/steer",
      auth: "dashboard",
      schemas: {
        params: emptyRouteSchema,
        query: emptyRouteSchema,
        body: z.object({ sessionKey: z.string().min(1), id: z.string().min(1) }),
      },
      responseSchema: z.object({
        result: z.enum(["steered", "expired", "forbidden", "ineligible"]),
      }),
      handler: async (routeX, { data }) => {
        const orchestrator = xOrchestratorService(routeX);
        const { sessionKey, id } = data.body;
        // The dashboard may address a Discord/Telegram-named session, but it
        // may steer only its own queued messages, never a platform user's.
        const dashboardQueued = orchestrator
          .listRuns(routeX)
          .some(
            (run) =>
              run.sessionKey === sessionKey &&
              run.id === id &&
              run.status === "queued" &&
              run.channel === "dashboard",
          );
        return {
          result: dashboardQueued
            ? await orchestrator.steerQueued(routeX, sessionKey, id, "owner")
            : ("forbidden" as const),
        };
      },
    });
    return router;
  }
}
