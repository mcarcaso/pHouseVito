import express from "express";
import type { Router } from "express";
import { z } from "zod";
import type { Context } from "../context/Context.js";
import type { RouterService } from "./RouterService.js";
import { piSessionRecordIdSchema } from "../shared/contracts/pi-session.js";
import { xPiSessionStore, xSessionStore } from "../lib/x.js";
import {
  emptyRouteSchema,
  unknownRouteSchema,
  createRawRoute,
} from "./createRoute.js";

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

    router.get(
      "/",
      createRawRoute(x, {
        auth: "dashboard",
        schemas: {
          params: emptyRouteSchema,
          query: emptyRouteSchema,
          body: unknownRouteSchema,
        },
        handler: (routeX, _input, _req, res) => {
          const aliases = new Map(
            xSessionStore(routeX)
              .list(routeX, { hasAlias: true })
              .flatMap((session) =>
                session.alias ? [[session.id, session.alias]] : [],
              ),
          );
          const files = xPiSessionStore(routeX).list(routeX, {
            order: "recent",
          });
          res.json({
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
          });
        },
      }),
    );

    router.get(
      "/*rel",
      createRawRoute(x, {
        auth: "dashboard",
        schemas: {
          params: wildcardPathSchema,
          query: emptyRouteSchema,
          body: unknownRouteSchema,
        },
        handler: (routeX, { params }, _req, res) => {
          const session = xPiSessionStore(routeX).list(routeX, {
            ids: [params.rel],
            includeLines: true,
            limit: 1,
          })[0];
          if (!session) {
            res.status(404).json({ error: "Pi session not found" });
            return;
          }
          res.json({
            rel: session.id,
            format: "jsonl",
            lines: session.lines ?? [],
          });
        },
      }),
    );

    router.delete(
      "/*rel",
      createRawRoute(x, {
        auth: "dashboard",
        schemas: {
          params: wildcardPathSchema,
          query: emptyRouteSchema,
          body: unknownRouteSchema,
        },
        handler: (routeX, { params }, _req, res) => {
          const deleted = xPiSessionStore(routeX).delete(routeX, {
            ids: [params.rel],
          });
          if (deleted === 0) {
            res.status(404).json({ error: "Pi session not found" });
            return;
          }
          res.json({ success: true, deleted: params.rel });
        },
      }),
    );

    router.delete(
      "/",
      createRawRoute(x, {
        auth: "dashboard",
        schemas: {
          params: emptyRouteSchema,
          query: emptyRouteSchema,
          body: unknownRouteSchema,
        },
        handler: (routeX, _input, _req, res) => {
          const store = xPiSessionStore(routeX);
          const ids = store.list(routeX, {}).map((session) => session.id);
          res.json({ success: true, deleted: store.delete(routeX, { ids }) });
        },
      }),
    );

    return router;
  }
}
