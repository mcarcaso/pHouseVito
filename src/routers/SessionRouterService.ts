import express from "express";
import type { Router } from "express";
import { z } from "zod";
import type { Context } from "../context/Context.js";
import type { RouterService } from "./RouterService.js";
import {
  sessionAliasUpdateSchema,
  sessionIdSchema,
  sessionMessagesQuerySchema,
} from "../shared/contracts/session-api.js";
import {
  settingsPatchSchema,
  settingsSchema,
} from "../shared/contracts/vito-config.js";
import { xMessageStore, xSessionStore, xVitoService } from "../lib/x.js";
import {
  emptyRouteSchema,
  unknownRouteSchema,
  createRawRoute,
} from "./createRoute.js";

const sessionParamsSchema = z.object({ id: sessionIdSchema });

export class SessionRouterService implements RouterService {
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
          res.json(xSessionStore(routeX).list(routeX, {}));
        },
      }),
    );

    router.get(
      "/:id/messages",
      createRawRoute(x, {
        auth: "dashboard",
        schemas: {
          params: sessionParamsSchema,
          query: sessionMessagesQuerySchema,
          body: unknownRouteSchema,
        },
        handler: (routeX, { params, query }, _req, res) => {
          const messageStore = xMessageStore(routeX);
          const excludeTypes = [
            ...(query.hideThoughts ? ["thought" as const] : []),
            ...(query.hideTools
              ? ["tool_start" as const, "tool_end" as const]
              : []),
          ];
          const filter = {
            sessionIds: [params.id],
            excludeTypes,
          };
          const newestFirst = query.after === undefined;
          const messages = messageStore.list(routeX, {
            ...filter,
            limit: query.limit,
            beforeId: query.before,
            afterId: query.after,
            order: newestFirst ? "newest" : "oldest",
          });
          if (newestFirst) messages.reverse();
          const total = messageStore.count(routeX, filter);
          res.json({ messages, total });
        },
      }),
    );

    router.delete(
      "/:id/messages",
      createRawRoute(x, {
        auth: "dashboard",
        schemas: {
          params: sessionParamsSchema,
          query: emptyRouteSchema,
          body: unknownRouteSchema,
        },
        handler: (routeX, { params }, _req, res) => {
          const deleted = xMessageStore(routeX).delete(routeX, {
            sessionIds: [params.id],
          });
          res.json({ ok: true, deleted });
        },
      }),
    );

    router.get(
      "/:id/config",
      createRawRoute(x, {
        auth: "dashboard",
        schemas: {
          params: sessionParamsSchema,
          query: emptyRouteSchema,
          body: unknownRouteSchema,
        },
        handler: (routeX, { params }, _req, res) => {
          if (
            !xSessionStore(routeX).list(routeX, {
              ids: [params.id],
              limit: 1,
            })[0]
          ) {
            res.status(404).json({ error: "Session not found" });
            return;
          }

          const config = xVitoService(routeX).getConfig(routeX);
          res.json(config.sessions?.[params.id] ?? {});
        },
      }),
    );

    router.put(
      "/:id/config",
      createRawRoute(x, {
        auth: "dashboard",
        schemas: {
          params: sessionParamsSchema,
          query: emptyRouteSchema,
          body: settingsPatchSchema,
        },
        handler: (routeX, { params, body }, _req, res) => {
          if (
            !xSessionStore(routeX).list(routeX, {
              ids: [params.id],
              limit: 1,
            })[0]
          ) {
            res.status(404).json({ error: "Session not found" });
            return;
          }

          const vitoService = xVitoService(routeX);
          const config = vitoService.getConfig(routeX);
          const candidate: Record<string, unknown> = {
            ...(config.sessions?.[params.id] ?? {}),
          };
          for (const [key, value] of Object.entries(body)) {
            if (value === null) {
              delete candidate[key];
            } else {
              candidate[key] = value;
            }
          }

          const updated = settingsSchema.parse(candidate);
          const sessions = { ...config.sessions };
          if (Object.keys(updated).length === 0) {
            delete sessions[params.id];
          } else {
            sessions[params.id] = updated;
          }
          config.sessions = sessions;
          vitoService.saveConfig(routeX, config);
          res.json(updated);
        },
      }),
    );

    router.put(
      "/:id/alias",
      createRawRoute(x, {
        auth: "dashboard",
        schemas: {
          params: sessionParamsSchema,
          query: emptyRouteSchema,
          body: sessionAliasUpdateSchema,
        },
        handler: (routeX, { params, body }, _req, res) => {
          if (
            !xSessionStore(routeX).list(routeX, {
              ids: [params.id],
              limit: 1,
            })[0]
          ) {
            res.status(404).json({ error: "Session not found" });
            return;
          }

          const alias = body.alias?.trim() || null;
          xSessionStore(routeX).update(routeX, {
            id: params.id,
            changes: { alias },
          });
          res.json({ id: params.id, alias });
        },
      }),
    );

    return router;
  }
}
