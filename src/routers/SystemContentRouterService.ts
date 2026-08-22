import express from "express";
import type { Router } from "express";
import type { Context } from "../context/Context.js";
import type { RouterService } from "./RouterService.js";
import { systemContentUpdateSchema } from "../shared/schemas/system-content.js";
import { xVitoService } from "../lib/x.js";
import { emptyRouteSchema, unknownRouteSchema, registerRoute } from "./register-route.js";
import { jsonResponseSchema } from "../shared/schemas/json.js";
export class SystemContentRouterService implements RouterService {
  async createRouter(x: Context): Promise<Router> {
    const router = express.Router();

    registerRoute(x, {
      router,
      method: "GET",
      path: "/jobs",
      auth: "dashboard",
      schemas: {
        params: emptyRouteSchema,
        query: emptyRouteSchema,
        body: unknownRouteSchema,
      },
      responseSchema: jsonResponseSchema,
      handler: (routeX, { data: _input, req: _req, res }) => {
        return xVitoService(routeX).getConfiguredJobs(routeX);
      },
    });

    registerRoute(x, {
      router,
      method: "GET",
      path: "/soul",
      auth: "dashboard",
      schemas: {
        params: emptyRouteSchema,
        query: emptyRouteSchema,
        body: unknownRouteSchema,
      },
      responseSchema: jsonResponseSchema,
      handler: (routeX, { data: _input, req: _req, res }) => {
        return { content: xVitoService(routeX).getSoul(routeX) };
      },
    });

    registerRoute(x, {
      router,
      method: "PUT",
      path: "/soul",
      auth: "dashboard",
      schemas: {
        params: emptyRouteSchema,
        query: emptyRouteSchema,
        body: systemContentUpdateSchema,
      },
      responseSchema: jsonResponseSchema,
      handler: (routeX, { data: input, req: _req, res }) => {
        xVitoService(routeX).saveSoul(routeX, input.body.content);
        return { content: input.body.content };
      },
    });

    registerRoute(x, {
      router,
      method: "GET",
      path: "/system-prompt",
      auth: "dashboard",
      schemas: {
        params: emptyRouteSchema,
        query: emptyRouteSchema,
        body: unknownRouteSchema,
      },
      responseSchema: jsonResponseSchema,
      handler: (routeX, { data: _input, req: _req, res }) => {
        return { content: xVitoService(routeX).getSystemPrompt(routeX) };
      },
    });

    router.all("/system-prompt", (_req, res) => {
      res.setHeader("allow", "GET");
      res.status(405).json({ error: "System prompt is read-only" });
    });

    return router;
  }
}
