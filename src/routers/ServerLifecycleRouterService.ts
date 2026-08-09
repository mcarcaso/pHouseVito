import express from "express";
import type { Router } from "express";
import type { Context } from "../context/Context.js";
import { xServerLifecycleService } from "../lib/x.js";
import {
  serverHealthResponseSchema,
  serverRestartResponseSchema,
  serverStatusResponseSchema,
} from "../shared/contracts/server-api.js";
import type { RouterService } from "./RouterService.js";
import { createRoute, emptyRouteSchema, unknownRouteSchema } from "./createRoute.js";

const emptyRequestSchemas = {
  params: emptyRouteSchema,
  query: emptyRouteSchema,
  body: unknownRouteSchema,
};

export class ServerLifecycleRouterService implements RouterService {
  async createRouter(x: Context): Promise<Router> {
    const router = express.Router();

    router.get(
      "/health",
      createRoute(x, {
        auth: "public",
        schemas: emptyRequestSchemas,
        responseSchema: serverHealthResponseSchema,
        handler: (routeX) => xServerLifecycleService(routeX).getHealth(routeX),
      }),
    );

    router.get(
      "/server/status",
      createRoute(x, {
        auth: "dashboard",
        schemas: emptyRequestSchemas,
        responseSchema: serverStatusResponseSchema,
        handler: (routeX) => xServerLifecycleService(routeX).getStatus(routeX),
      }),
    );

    router.post(
      "/server/restart",
      createRoute(x, {
        auth: "dashboard",
        schemas: emptyRequestSchemas,
        responseSchema: serverRestartResponseSchema,
        handler: (routeX, { req }) => {
          const forwardedFor = req.headers["x-forwarded-for"];
          const clientIp = forwardedFor
            ? String(forwardedFor)
            : req.socket.remoteAddress;
          const userAgent = String(req.headers["user-agent"] ?? "unknown");
          xServerLifecycleService(routeX).requestRestart(routeX, {
            clientIp,
            userAgent,
          });
          return {
            ok: true as const,
            message: "Rebuilding dashboard and restarting server...",
          };
        },
      }),
    );

    return router;
  }
}
