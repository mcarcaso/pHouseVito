import express from "express";
import type { Router } from "express";
import type { Context } from "../context/Context.js";
import {
  factSearchQuerySchema,
  memoryAnswerRequestSchema,
  memorySearchQuerySchema,
} from "../shared/schemas/memory-api.js";
import type { RouterService } from "./RouterService.js";
import { xFactService, xMemoryService, xSessionStore } from "../lib/x.js";
import { emptyRouteSchema, unknownRouteSchema, registerRoute } from "./register-route.js";
import { jsonResponseSchema } from "../shared/schemas/json.js";
export class MemoryRouterService implements RouterService {
  async createRouter(x: Context): Promise<Router> {
    const router = express.Router();

    registerRoute(x, {
      router,
      method: "GET",
      path: "/profile",
      auth: "dashboard",
      schemas: {
        params: emptyRouteSchema,
        query: emptyRouteSchema,
        body: unknownRouteSchema,
      },
      responseSchema: jsonResponseSchema,
      handler: (routeX, { data: _input, req: _req, res }) => {
        return { content: xMemoryService(routeX).getProfile(routeX) };
      },
    });

    registerRoute(x, {
      router,
      method: "GET",
      path: "/embeddings/stats",
      auth: "dashboard",
      schemas: {
        params: emptyRouteSchema,
        query: emptyRouteSchema,
        body: unknownRouteSchema,
      },
      responseSchema: jsonResponseSchema,
      handler: (routeX, { data: _input, req: _req, res }) => {
        const stats = xMemoryService(routeX).getStats(routeX);
        const aliases = Object.fromEntries(
          xSessionStore(routeX)
            .list(routeX, { hasAlias: true })
            .map((session) => [session.id, session.alias]),
        );
        return {
          totalChunks: stats.totalChunks,
          totalSessions: stats.totalSessions,
          totalDays: stats.totalDays,
          oldestDay: stats.oldestDay,
          newestDay: stats.newestDay,
          sessions: stats.sessions.map((session) => ({
            session_id: session.sessionId,
            count: session.count,
            first_day: session.firstDay,
            last_day: session.lastDay,
            alias: aliases[session.sessionId] || null,
          })),
        };
      },
    });

    registerRoute(x, {
      router,
      method: "GET",
      path: "/embeddings/search",
      auth: "dashboard",
      schemas: {
        params: emptyRouteSchema,
        query: memorySearchQuerySchema,
        body: unknownRouteSchema,
      },
      responseSchema: jsonResponseSchema,
      handler: async (routeX, { data: { query }, req: _req, res }) => {
        const start = Date.now();
        try {
          const aliases = Object.fromEntries(
            xSessionStore(routeX)
              .list(routeX, { hasAlias: true })
              .map((session) => [session.id, session.alias]),
          );
          const results = await xMemoryService(routeX).search(routeX, query.q, {
            limit: query.limit,
            mode: query.mode,
            sessionFilter: query.session,
          });
          return {
            query: query.q,
            mode: query.mode,
            duration_ms: Date.now() - start,
            results: results.map((result) => ({
              id: result.id,
              session_id: result.sessionId,
              alias: aliases[result.sessionId] || null,
              day: result.day,
              chunk_index: result.chunkIndex,
              text: result.text,
              context: result.context,
              msg_count: result.msgCount,
              rrfScore: result.rrfScore,
              embeddingScore: result.embeddingScore,
              rawEmbeddingScore: result.rawEmbeddingScore,
              recencyFactor: result.recencyFactor,
              daysAgo: result.daysAgo,
              bm25Score: result.bm25Score,
            })),
          };
        } catch (error) {
          console.error("[Dashboard] Embeddings search error:", error);
          res.status(500).json({
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    });

    registerRoute(x, {
      router,
      method: "GET",
      path: "/facts/search",
      auth: "dashboard",
      schemas: {
        params: emptyRouteSchema,
        query: factSearchQuerySchema,
        body: unknownRouteSchema,
      },
      responseSchema: jsonResponseSchema,
      handler: async (routeX, { data: { query } }) => {
        const start = Date.now();
        const results = await xFactService(routeX).search(routeX, query.q, {
          limit: query.limit,
          currentOnly: query.current === "true",
          asOf: query.asOf,
        });
        return { query: query.q, duration_ms: Date.now() - start, results };
      },
    });

    registerRoute(x, {
      router,
      method: "POST",
      path: "/answer",
      auth: "dashboard",
      schemas: {
        params: emptyRouteSchema,
        query: emptyRouteSchema,
        body: memoryAnswerRequestSchema,
      },
      responseSchema: jsonResponseSchema,
      handler: async (routeX, { data: { body } }) => {
        const result = await xMemoryService(routeX).answer(routeX, body.query, {
          currentOnly: body.currentOnly,
          asOf: body.asOf,
          depth: "deep",
        });
        return {
          answer: result.answer,
          citations: result.citations,
          duration_ms: result.durationMs,
          provider_counts: {
            profile: result.recall.profile.length,
            facts: result.recall.facts.length,
            transcripts: result.recall.transcripts.length,
          },
        };
      },
    });

    return router;
  }
}
