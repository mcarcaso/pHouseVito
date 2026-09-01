import { spawn } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import express from "express";
import type { Router } from "express";
import type { Context } from "../context/Context.js";
import {
  factSearchQuerySchema,
  memoryAnswerRequestSchema,
  memoryRecentQuerySchema,
  memorySearchQuerySchema,
} from "../shared/schemas/memory-api.js";
import type { RouterService } from "./RouterService.js";
import {
  xEmbeddingDb,
  xEmbeddingStore,
  xFactService,
  xFactStore,
  xMemoryService,
  xPiSessionStore,
  xProjectDir,
  xSessionStore,
  xUserDir,
  xVitoService,
} from "../lib/x.js";
import { emptyRouteSchema, unknownRouteSchema, registerRoute } from "./register-route.js";
import { jsonResponseSchema } from "../shared/schemas/json.js";
import { FACT_EXTRACTOR_VERSION } from "../services/facts/PiFactExtractor.js";
import {
  FACT_CURATOR_VITO_SESSION_ID,
  PERSISTENT_FACT_EXTRACTOR_VERSION,
} from "../services/facts/PersistentPiFactExtractor.js";

function activeBackfill(x: Context): {
  active: boolean;
  pid: number | null;
  startedAt: number | null;
} {
  const marker = join(xUserDir(x), "logs", "fact-backfill-active.pid");
  if (!existsSync(marker)) return { active: false, pid: null, startedAt: null };
  const pid = Number(readFileSync(marker, "utf-8").trim());
  if (Number.isInteger(pid) && pid > 0) {
    try {
      process.kill(pid, 0);
      return { active: true, pid, startedAt: statSync(marker).mtimeMs };
    } catch {
      // Remove stale process markers below.
    }
  }
  rmSync(marker, { force: true });
  return { active: false, pid: null, startedAt: null };
}

function curatorStatus(x: Context) {
  const enabled =
    xVitoService(x).getConfig(x).settings.memory?.factIngestionMode === "persistent-pi";
  const session = xPiSessionStore(x).list(x, {
    vitoSessionIds: [FACT_CURATOR_VITO_SESSION_ID],
    order: "recent",
    limit: 1,
  })[0];
  return {
    enabled,
    extractorVersion: PERSISTENT_FACT_EXTRACTOR_VERSION,
    vitoSessionId: FACT_CURATOR_VITO_SESSION_ID,
    sessionRecordId: session?.id ?? null,
    updatedAt: session?.updatedAt ?? null,
    lastModel: session?.lastModel ?? null,
    messageCount: session?.messageCount ?? null,
  };
}

function backfillStatus(x: Context) {
  const db = xEmbeddingDb(x);
  const totalChunks = (db.prepare("SELECT COUNT(*) count FROM chunks").get() as { count: number })
    .count;
  const runs = db
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) completed,
         SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) processing,
         SUM(CASE WHEN status = 'failed' AND attempts >= 3 THEN 1 ELSE 0 END) failed
       FROM fact_chunk_runs
       WHERE extractor_version = ?`,
    )
    .get(FACT_EXTRACTOR_VERSION) as {
    completed: number | null;
    processing: number | null;
    failed: number | null;
  };
  const embeddedFacts = (
    db.prepare("SELECT COUNT(*) count FROM fact_embeddings").get() as { count: number }
  ).count;
  const process = activeBackfill(x);
  const completedChunks = runs.completed ?? 0;
  return {
    ...process,
    curator: curatorStatus(x),
    totalChunks,
    completedChunks,
    pendingChunks: Math.max(0, totalChunks - completedChunks),
    processingChunks: runs.processing ?? 0,
    failedChunks: runs.failed ?? 0,
    totalFacts: xFactStore(x).count(x, {}),
    embeddedFacts,
    percent: totalChunks > 0 ? Math.round((completedChunks / totalChunks) * 10_000) / 100 : 100,
  };
}

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
      path: "/embeddings/recent",
      auth: "dashboard",
      schemas: {
        params: emptyRouteSchema,
        query: memoryRecentQuerySchema,
        body: unknownRouteSchema,
      },
      responseSchema: jsonResponseSchema,
      handler: (routeX, { data: { query } }) => {
        const aliases = Object.fromEntries(
          xSessionStore(routeX)
            .list(routeX, { hasAlias: true })
            .map((session) => [session.id, session.alias]),
        );
        return {
          duration_ms: 0,
          mode: "recent",
          results: xEmbeddingStore(routeX)
            .listRecentChunks(routeX, query.limit)
            .map((chunk) => ({
              id: chunk.id,
              session_id: chunk.sessionId,
              alias: aliases[chunk.sessionId] || null,
              day: chunk.day,
              chunk_index: chunk.chunkIndex,
              text: chunk.text,
              context: chunk.context,
              msg_count: chunk.messageCount,
              rrfScore: 0,
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
      path: "/facts/recent",
      auth: "dashboard",
      schemas: {
        params: emptyRouteSchema,
        query: memoryRecentQuerySchema,
        body: unknownRouteSchema,
      },
      responseSchema: jsonResponseSchema,
      handler: (routeX, { data: { query } }) => ({
        duration_ms: 0,
        mode: "recent",
        results: xFactStore(routeX)
          .list(routeX, {
            limit: query.limit,
            order: "recent",
            statuses: query.current === "true" ? ["active", "disputed"] : undefined,
          })
          .map((fact) => ({ fact, score: 0, conflicts: [] })),
      }),
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
      method: "GET",
      path: "/facts/backfill/status",
      auth: "dashboard",
      schemas: {
        params: emptyRouteSchema,
        query: emptyRouteSchema,
        body: unknownRouteSchema,
      },
      responseSchema: jsonResponseSchema,
      handler: (routeX) => backfillStatus(routeX),
    });

    registerRoute(x, {
      router,
      method: "POST",
      path: "/facts/backfill/start",
      auth: "dashboard",
      schemas: { params: emptyRouteSchema, query: emptyRouteSchema, body: emptyRouteSchema },
      responseSchema: jsonResponseSchema,
      handler: (routeX, { res }) => {
        const status = backfillStatus(routeX);
        if (status.active) return status;
        const projectDir = xProjectDir(routeX);
        const logPath = join(xUserDir(routeX), "logs", "fact-backfill-v3.log");
        const output = openSync(logPath, "a");
        const child = spawn(join(projectDir, "vito"), ["memory", "backfill-facts", "--all"], {
          cwd: projectDir,
          detached: true,
          stdio: ["ignore", output, output],
        });
        closeSync(output);
        child.unref();
        res.status(202);
        return { ...status, starting: true, pid: child.pid ?? null };
      },
    });

    registerRoute(x, {
      router,
      method: "POST",
      path: "/facts/backfill/stop",
      auth: "dashboard",
      schemas: { params: emptyRouteSchema, query: emptyRouteSchema, body: emptyRouteSchema },
      responseSchema: jsonResponseSchema,
      handler: (routeX) => {
        const status = activeBackfill(routeX);
        if (status.active && status.pid) process.kill(status.pid, "SIGTERM");
        return { stopping: status.active, pid: status.pid };
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
