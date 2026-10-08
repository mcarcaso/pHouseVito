import express from "express";
import { z } from "zod";
import type { Context } from "../context/Context.js";
import type { RouterService } from "./RouterService.js";
import { xMcpService, xMcpStore, xMcpOAuthService } from "../lib/x.js";
import { mcpNameSchema, mcpSaveSchema } from "../shared/schemas/mcp.js";
import { jsonResponseSchema } from "../shared/schemas/json.js";
import {
  emptyRouteSchema,
  unknownRouteSchema,
  registerRoute,
  registerStreamRoute,
} from "./register-route.js";
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
    const params = z.object({ name: mcpNameSchema });
    registerRoute(x, {
      router,
      method: "POST",
      path: "/:name/oauth/start",
      auth: "dashboard",
      schemas: { params, query: emptyRouteSchema, body: emptyRouteSchema },
      responseSchema: jsonResponseSchema,
      handler: (routeX, { data }) => xMcpOAuthService(routeX).start(routeX, data.params.name),
    });
    registerRoute(x, {
      router,
      method: "POST",
      path: "/:name/oauth/disconnect",
      auth: "dashboard",
      schemas: { params, query: emptyRouteSchema, body: emptyRouteSchema },
      responseSchema: jsonResponseSchema,
      handler: (routeX, { data }) => {
        xMcpOAuthService(routeX).disconnect(routeX, data.params.name);
        return xMcpService(routeX).overview(routeX);
      },
    });
    registerStreamRoute(x, {
      router,
      method: "GET",
      path: "/oauth/callback",
      auth: "mcp-auth",
      schemas: {
        params: emptyRouteSchema,
        query: z
          .object({
            state: z.string().min(1).max(256),
            code: z.string().max(4096).optional(),
            error: z.string().max(256).optional(),
          })
          .passthrough(),
        body: unknownRouteSchema,
      },
      handler: async (routeX, data, _req, res) => {
        const ok = await xMcpOAuthService(routeX).finish(routeX, data.query);
        res.set({
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
          "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
        });
        res
          .status(ok ? 200 : 400)
          .type("html")
          .send(
            `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MCP authorization</title><body><h1>${ok ? "MCP connected" : "Authorization unsuccessful"}</h1><p>${ok ? "You can close this tab and return to Vito." : "The request expired, was cancelled, or could not be verified. Start Connect again in Vito."}</p><a href="/operation/mcp">Return to MCP settings</a></body></html>`,
          );
      },
    });
    registerRoute(x, {
      router,
      method: "GET",
      path: "/oauth/client-metadata",
      auth: "mcp-auth",
      schemas: { params: emptyRouteSchema, query: emptyRouteSchema, body: unknownRouteSchema },
      responseSchema: jsonResponseSchema,
      handler: (routeX) => xMcpOAuthService(routeX).clientMetadata(routeX),
    });
    return router;
  }
}
