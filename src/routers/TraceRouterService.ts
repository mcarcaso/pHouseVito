import express from "express";
import type { Router } from "express";
import { z } from "zod";
import type { Context } from "../context/Context.js";
import type { RouterService } from "./RouterService.js";
import { xSessionStore, xTraceEventStore, xTraceStore } from "../lib/x.js";
import { emptyRouteSchema, unknownRouteSchema, registerRoute } from "./register-route.js";
import { jsonResponseSchema } from "../shared/schemas/json.js";
const listQuerySchema = z
  .object({
    limit: z.coerce.number().int().positive().max(500).default(50),
    offset: z.coerce.number().int().nonnegative().default(0),
  })
  .strict();

const traceParamsSchema = z
  .object({
    id: z.string().min(1),
  })
  .strict();

export class TraceRouterService implements RouterService {
  async createRouter(x: Context): Promise<Router> {
    const router = express.Router();

    registerRoute(x, {
      router,
      method: "GET",
      path: "/",
      auth: "dashboard",
      schemas: {
        params: emptyRouteSchema,
        query: listQuerySchema,
        body: unknownRouteSchema,
      },
      responseSchema: jsonResponseSchema,
      handler: (routeX, { data: { query }, req: _req, res }) => {
        const store = xTraceStore(routeX);
        const aliases = new Map(
          xSessionStore(routeX)
            .list(routeX, { hasAlias: true })
            .flatMap((session) => (session.alias ? [[session.id, session.alias]] : [])),
        );
        const traces = store.list(routeX, {
          limit: query.limit,
          offset: query.offset,
          order: "recent",
        });
        return {
          files: traces.map((trace) => ({
            filename: trace.id,
            timestamp: trace.updatedAt,
            size: trace.size,
            preview: trace.preview,
            format: "jsonl",
            sessionId: trace.sessionId ?? "",
            alias: trace.sessionId ? (aliases.get(trace.sessionId) ?? null) : null,
            hasEmbedding: trace.hasEmbedding,
            userMessage: trace.userMessage,
            traceType: trace.traceType,
            cost: trace.cost,
          })),
          totalCount: store.count(routeX, {}),
          offset: query.offset,
          limit: query.limit,
        };
      },
    });

    registerRoute(x, {
      router,
      method: "GET",
      path: "/:id",
      auth: "dashboard",
      schemas: {
        params: traceParamsSchema,
        query: emptyRouteSchema,
        body: unknownRouteSchema,
      },
      responseSchema: jsonResponseSchema,
      handler: (routeX, { data: { params }, req: _req, res }) => {
        const trace = xTraceStore(routeX).list(routeX, {
          ids: [params.id],
          limit: 1,
        })[0];
        if (!trace) {
          res.status(404).json({ error: "Log not found" });
          return;
        }

        const events = xTraceEventStore(routeX).list(routeX, {
          traceIds: [trace.id],
          order: "oldest",
        });
        return {
          filename: trace.id,
          format: "jsonl",
          lines: [
            {
              type: "header",
              timestamp: new Date(trace.createdAt).toISOString(),
              session_id: trace.sessionId ?? "",
              channel: trace.channel ?? "",
              target: trace.target ?? "",
              model: trace.model ?? "",
              harness: trace.harness ?? "",
            },
            ...events.map((event) => event.data),
          ],
        };
      },
    });

    registerRoute(x, {
      router,
      method: "DELETE",
      path: "/:id",
      auth: "dashboard",
      schemas: {
        params: traceParamsSchema,
        query: emptyRouteSchema,
        body: unknownRouteSchema,
      },
      responseSchema: jsonResponseSchema,
      handler: (routeX, { data: { params }, req: _req, res }) => {
        const deleted = xTraceStore(routeX).delete(routeX, {
          ids: [params.id],
        });
        if (deleted === 0) {
          res.status(404).json({ error: "Log not found" });
          return;
        }
        return { success: true, deleted: params.id };
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
        const store = xTraceStore(routeX);
        const ids = store.list(routeX, {}).map((trace) => trace.id);
        return { success: true, deleted: store.delete(routeX, { ids }) };
      },
    });

    return router;
  }
}
