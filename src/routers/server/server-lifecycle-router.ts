import express from "express";
import type { Router } from "express";
import type { Context } from "../../context/Context.js";
import { xServerLifecycleService } from "../../lib/x.js";
import { emptyRouteSchema, unknownRouteSchema, validatedRoute } from "../route.js";

export function createServerLifecycleRouter(x: Context): Router {
  const router = express.Router();

  router.get("/health", validatedRoute(
    x,
    { params: emptyRouteSchema, query: emptyRouteSchema, body: unknownRouteSchema },
    (routeX, _input, _req, res) => {
      res.json(xServerLifecycleService(routeX).getHealth(routeX));
    }
  ));

  router.get("/server/status", validatedRoute(
    x,
    { params: emptyRouteSchema, query: emptyRouteSchema, body: unknownRouteSchema },
    (routeX, _input, _req, res) => {
      res.json(xServerLifecycleService(routeX).getStatus(routeX));
    }
  ));

  router.post("/server/restart", validatedRoute(
    x,
    { params: emptyRouteSchema, query: emptyRouteSchema, body: unknownRouteSchema },
    (routeX, _input, req, res) => {
      const forwardedFor = req.headers["x-forwarded-for"];
      const clientIp = forwardedFor
        ? String(forwardedFor)
        : req.socket.remoteAddress;
      const userAgent = String(req.headers["user-agent"] ?? "unknown");
      xServerLifecycleService(routeX).requestRestart(routeX, {
        clientIp,
        userAgent,
      });
      res.json({
        ok: true,
        message: "Rebuilding dashboard and restarting server...",
      });
    }
  ));

  return router;
}
