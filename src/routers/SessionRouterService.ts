import express from "express";
import type { Router } from "express";
import { z } from "zod";
import type { Context } from "../context/Context.js";
import type { RouterService } from "./RouterService.js";
import {
  sessionAliasUpdateSchema,
  sessionIdSchema,
  sessionMessagesQuerySchema,
} from "../shared/schemas/session-api.js";
import { settingsPatchSchema, settingsSchema } from "../shared/schemas/vito-config.js";
import { xMessageStore, xSessionStore, xVitoService } from "../lib/x.js";
import { emptyRouteSchema, unknownRouteSchema, registerRoute } from "./register-route.js";
import { jsonResponseSchema } from "../shared/schemas/json.js";
const sessionParamsSchema = z.object({ id: sessionIdSchema });

export class SessionRouterService implements RouterService {
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
        return xSessionStore(routeX).list(routeX, {});
      },
    });

    registerRoute(x, {
      router,
      method: "GET",
      path: "/:id/messages",
      auth: "dashboard",
      schemas: {
        params: sessionParamsSchema,
        query: sessionMessagesQuerySchema,
        body: unknownRouteSchema,
      },
      responseSchema: jsonResponseSchema,
      handler: (routeX, { data: { params, query }, req: _req, res }) => {
        const messageStore = xMessageStore(routeX);
        const excludeTypes = [
          ...(query.hideThoughts ? ["thought" as const] : []),
          ...(query.hideTools ? ["tool_start" as const, "tool_end" as const] : []),
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
        return { messages, total };
      },
    });

    registerRoute(x, {
      router,
      method: "DELETE",
      path: "/:id/messages",
      auth: "dashboard",
      schemas: {
        params: sessionParamsSchema,
        query: emptyRouteSchema,
        body: unknownRouteSchema,
      },
      responseSchema: jsonResponseSchema,
      handler: (routeX, { data: { params }, req: _req, res }) => {
        const deleted = xMessageStore(routeX).delete(routeX, {
          sessionIds: [params.id],
        });
        return { ok: true, deleted };
      },
    });

    registerRoute(x, {
      router,
      method: "GET",
      path: "/:id/config",
      auth: "dashboard",
      schemas: {
        params: sessionParamsSchema,
        query: emptyRouteSchema,
        body: unknownRouteSchema,
      },
      responseSchema: jsonResponseSchema,
      handler: (routeX, { data: { params }, req: _req, res }) => {
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
        return config.sessions?.[params.id] ?? {};
      },
    });

    registerRoute(x, {
      router,
      method: "PUT",
      path: "/:id/config",
      auth: "dashboard",
      schemas: {
        params: sessionParamsSchema,
        query: emptyRouteSchema,
        body: settingsPatchSchema,
      },
      responseSchema: jsonResponseSchema,
      handler: (routeX, { data: { params, body }, req: _req, res }) => {
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
        return updated;
      },
    });

    registerRoute(x, {
      router,
      method: "PUT",
      path: "/:id/alias",
      auth: "dashboard",
      schemas: {
        params: sessionParamsSchema,
        query: emptyRouteSchema,
        body: sessionAliasUpdateSchema,
      },
      responseSchema: jsonResponseSchema,
      handler: (routeX, { data: { params, body }, req: _req, res }) => {
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
        return { id: params.id, alias };
      },
    });

    return router;
  }
}
