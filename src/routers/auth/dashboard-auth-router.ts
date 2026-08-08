import express from "express";
import type { Router } from "express";
import { z } from "zod";
import type { Context } from "../../context/Context.js";
import { xDashboardAuthService } from "../../lib/x.js";
import {
  emptyRouteSchema,
  unknownRouteSchema,
  validatedRoute,
} from "../route.js";

const loginBodySchema = z.object({
  password: z.unknown().optional(),
}).passthrough();

export function createDashboardAuthRouter(x: Context): Router {
  const router = express.Router();

  router.get("/check", validatedRoute(
    x,
    { params: emptyRouteSchema, query: emptyRouteSchema, body: unknownRouteSchema },
    (routeX, _input, req, res) => {
      res.json(xDashboardAuthService(routeX).getStatus(routeX, req.headers.cookie));
    }
  ));

  router.post("/setup", validatedRoute(
    x,
    { params: emptyRouteSchema, query: emptyRouteSchema, body: unknownRouteSchema },
    (routeX, _input, req, res) => {
      const result = xDashboardAuthService(routeX).setup(routeX, {
        host: req.headers.host,
      });
      if (result.status === "password_already_set") {
        res.status(400).json({ error: "Password already set. Use login instead." });
        return;
      }
      res.setHeader("Set-Cookie", result.cookie);
      res.json({ ok: true, password: result.password });
    }
  ));

  router.post("/login", validatedRoute(
    x,
    { params: emptyRouteSchema, query: emptyRouteSchema, body: loginBodySchema },
    (routeX, { body }, req, res) => {
      const result = xDashboardAuthService(routeX).login(routeX, {
        password: body.password,
        ip: req.ip || req.socket.remoteAddress || "unknown",
        host: req.headers.host,
      });
      if (result.status === "rate_limited") {
        res.status(429).json({ error: "Too many login attempts. Try again in 15 minutes." });
        return;
      }
      if (result.status === "password_not_set") {
        res.status(400).json({ error: "No password set. Use setup first." });
        return;
      }
      if (result.status === "invalid_password") {
        res.status(401).json({ error: "Invalid password" });
        return;
      }
      res.setHeader("Set-Cookie", result.cookie);
      res.json({ ok: true });
    }
  ));

  router.post("/logout", validatedRoute(
    x,
    { params: emptyRouteSchema, query: emptyRouteSchema, body: unknownRouteSchema },
    (routeX, _input, req, res) => {
      const cookie = xDashboardAuthService(routeX).logout(routeX, {
        cookieHeader: req.headers.cookie,
        host: req.headers.host,
      });
      res.setHeader("Set-Cookie", cookie);
      res.json({ ok: true });
    }
  ));

  return router;
}
