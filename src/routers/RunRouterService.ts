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
    return router;
  }
}
