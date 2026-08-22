import express from "express";
import type { Router } from "express";
import { z } from "zod";
import type { Context } from "../context/Context.js";
import type { RouterService } from "./RouterService.js";
import { piSessionRecordIdSchema } from "../shared/schemas/pi-session.js";
import { xPiSessionStore, xSessionStore } from "../lib/x.js";
import { emptyRouteSchema, unknownRouteSchema, registerRoute } from "./register-route.js";
import { jsonResponseSchema } from "../shared/schemas/json.js";
const wildcardPathSchema = z
  .object({
    rel: z
      .union([z.string(), z.array(z.string())])
      .transform((value) => (Array.isArray(value) ? value.join("/") : value))
      .pipe(piSessionRecordIdSchema),
  })
  .strict();

export class PiSessionRouterService implements RouterService {
  async createRouter(x: Context): Promise<Router> {
    const router = express.Router();

    registerRoute(x, {
      router,
      method: "GET",
      path: "/",
      auth: "dashboard",
      schemas: {
        params: emptyRouteSchema,
        query: emptyRouteSchema,
        body: unknownRouteSchema,
      },
      responseSchema: jsonResponseSchema,
      handler: (routeX, { data: _input, req: _req, res }) => {
        const aliases = new Map(
          xSessionStore(routeX)
            .list(routeX, { hasAlias: true })
            .flatMap((session) => (session.alias ? [[session.id, session.alias]] : [])),
        );
        const files = xPiSessionStore(routeX).list(routeX, {
          order: "recent",
        });
        return {
          files: files.map((session) => ({
            rel: session.id,
            size: session.size,
            mtime: session.updatedAt,
            vitoSessionId: session.vitoSessionId,
            alias: aliases.get(session.vitoSessionId) ?? null,
            piSessionId: session.piSessionId,
            piTimestamp: session.piTimestamp,
            piCwd: session.cwd,
            messageCount: session.messageCount,
            lastModel: session.lastModel,
            lastUserMessage: session.lastUserMessage,
          })),
        };
      },
    });

    registerRoute(x, {
      router,
      method: "GET",
      path: "/*rel",
      auth: "dashboard",
      schemas: {
        params: wildcardPathSchema,
        query: emptyRouteSchema,
        body: unknownRouteSchema,
      },
      responseSchema: jsonResponseSchema,
      handler: (routeX, { data: { params }, req: _req, res }) => {
        const session = xPiSessionStore(routeX).list(routeX, {
          ids: [params.rel],
          includeLines: true,
          limit: 1,
        })[0];
        if (!session) {
          res.status(404).json({ error: "Pi session not found" });
          return;
        }
        return {
          rel: session.id,
          format: "jsonl",
          lines: session.lines ?? [],
        };
      },
    });

    registerRoute(x, {
      router,
      method: "DELETE",
      path: "/*rel",
      auth: "dashboard",
      schemas: {
        params: wildcardPathSchema,
        query: emptyRouteSchema,
        body: unknownRouteSchema,
      },
      responseSchema: jsonResponseSchema,
      handler: (routeX, { data: { params }, req: _req, res }) => {
        const deleted = xPiSessionStore(routeX).delete(routeX, {
          ids: [params.rel],
        });
        if (deleted === 0) {
          res.status(404).json({ error: "Pi session not found" });
          return;
        }
        return { success: true, deleted: params.rel };
      },
    });

    registerRoute(x, {
      router,
      method: "DELETE",
      path: "/",
      auth: "dashboard",
      schemas: {
        params: emptyRouteSchema,
        query: emptyRouteSchema,
        body: unknownRouteSchema,
      },
      responseSchema: jsonResponseSchema,
      handler: (routeX, { data: _input, req: _req, res }) => {
        const store = xPiSessionStore(routeX);
        const ids = store.list(routeX, {}).map((session) => session.id);
        return { success: true, deleted: store.delete(routeX, { ids }) };
      },
    });

    return router;
  }
}
