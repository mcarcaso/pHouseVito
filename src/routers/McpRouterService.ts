import express from "express";
import { z } from "zod";
import type { Context } from "../context/Context.js";
import type { RouterService } from "./RouterService.js";
import { xMcpService, xMcpStore } from "../lib/x.js";
import { mcpNameSchema, mcpSaveSchema } from "../shared/schemas/mcp.js";
import { jsonResponseSchema } from "../shared/schemas/json.js";
import { emptyRouteSchema, unknownRouteSchema, registerRoute } from "./register-route.js";
export class McpRouterService implements RouterService {
  async createRouter(x: Context) {
    const router = express.Router();
    registerRoute(x, {
      router,
      method: "GET",
      path: "/",
      auth: "dashboard",
      schemas: { params: emptyRouteSchema, query: emptyRouteSchema, body: unknownRouteSchema },
      responseSchema: jsonResponseSchema,
      handler: (routeX) => xMcpService(routeX).overview(routeX),
    });
    registerRoute(x, {
      router,
      method: "PUT",
      path: "/",
      auth: "dashboard",
      schemas: { params: emptyRouteSchema, query: emptyRouteSchema, body: mcpSaveSchema },
      responseSchema: jsonResponseSchema,
      handler: (routeX, { data }) => {
        xMcpStore(routeX).save(routeX, data.body.name, data.body.server);
        return xMcpService(routeX).overview(routeX);
      },
    });
    registerRoute(x, {
      router,
      method: "DELETE",
      path: "/:name",
      auth: "dashboard",
      schemas: {
        params: z.object({ name: mcpNameSchema }),
        query: emptyRouteSchema,
        body: unknownRouteSchema,
      },
      responseSchema: jsonResponseSchema,
      handler: (routeX, { data }) => {
        xMcpStore(routeX).remove(routeX, data.params.name);
        return xMcpService(routeX).overview(routeX);
      },
    });
    registerRoute(x, {
      router,
      method: "POST",
      path: "/:name/test",
      auth: "dashboard",
      schemas: {
        params: z.object({ name: mcpNameSchema }),
        query: emptyRouteSchema,
        body: emptyRouteSchema,
      },
      responseSchema: jsonResponseSchema,
      handler: (routeX, { data }) => xMcpService(routeX).test(routeX, data.params.name),
    });
    return router;
  }
}
