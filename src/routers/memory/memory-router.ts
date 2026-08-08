import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import express from "express";
import type { Router } from "express";
import { z } from "zod";
import type { Context } from "../../context/Context.js";
import { xMemoryService, xSessionStore, xUserDir } from "../../lib/x.js";
import {
  emptyRouteSchema,
  unknownRouteSchema,
  validatedRoute,
} from "../route.js";

const searchQuerySchema = z.object({
  q: z.string().min(1),
  mode: z.enum(["hybrid", "embedding", "bm25"]).default("hybrid"),
  limit: z.coerce.number().int().positive().max(100).default(10),
  session: z.string().min(1).optional(),
}).strict();

export function createMemoryRouter(x: Context): Router {
  const router = express.Router();

  router.get("/profile", validatedRoute(
    x,
    {
      params: emptyRouteSchema,
      query: emptyRouteSchema,
      body: unknownRouteSchema,
    },
    (routeX, _input, _req, res) => {
      const profilePath = join(xUserDir(routeX), "profile.md");
      res.json({
        content: existsSync(profilePath) ? readFileSync(profilePath, "utf-8") : null,
      });
    }
  ));

  router.get("/embeddings/stats", validatedRoute(
    x,
    {
      params: emptyRouteSchema,
      query: emptyRouteSchema,
      body: unknownRouteSchema,
    },
    (routeX, _input, _req, res) => {
      const stats = xMemoryService(routeX).getStats(routeX);
      const aliases = Object.fromEntries(
        xSessionStore(routeX)
          .list(routeX, { hasAlias: true })
          .map((session) => [session.id, session.alias])
      );
      res.json({
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
      });
    }
  ));

  router.get("/embeddings/search", validatedRoute(
    x,
    {
      params: emptyRouteSchema,
      query: searchQuerySchema,
      body: unknownRouteSchema,
    },
    async (routeX, { query }, _req, res) => {
      const start = Date.now();
      try {
        const results = await xMemoryService(routeX).search(routeX, query.q, {
          limit: query.limit,
          mode: query.mode,
          sessionFilter: query.session,
        });
        res.json({
          query: query.q,
          mode: query.mode,
          duration_ms: Date.now() - start,
          results: results.map((result) => ({
            id: result.id,
            session_id: result.sessionId,
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
        });
      } catch (error) {
        console.error("[Dashboard] Embeddings search error:", error);
        res.status(500).json({
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  ));

  return router;
}
