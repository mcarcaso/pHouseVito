import express from "express";
import type { Router } from "express";
import type { Context } from "../context/Context.js";
import { dashboardLoginRequestSchema } from "../shared/schemas/dashboard-auth.js";
import type { RouterService } from "./RouterService.js";
import { xDashboardAuthService } from "../lib/x.js";
import { emptyRouteSchema, unknownRouteSchema, registerRoute } from "./register-route.js";
import { jsonResponseSchema } from "../shared/schemas/json.js";
export class DashboardAuthRouterService implements RouterService {
  async createRouter(x: Context): Promise<Router> {
    const router = express.Router();

    registerRoute(x, {
      router,
      method: "GET",
      path: "/check",
      auth: "public",
      schemas: {
        params: emptyRouteSchema,
        query: emptyRouteSchema,
        body: unknownRouteSchema,
      },
      responseSchema: jsonResponseSchema,
      handler: (routeX, { data: _input, req, res }) => {
        return xDashboardAuthService(routeX).getStatus(
          routeX,
          req.headers.cookie,
          req.headers.authorization,
        );
      },
    });

    registerRoute(x, {
      router,
      method: "POST",
      path: "/setup",
      auth: "public",
      schemas: {
        params: emptyRouteSchema,
        query: emptyRouteSchema,
        body: unknownRouteSchema,
      },
      responseSchema: jsonResponseSchema,
      handler: (routeX, { data: _input, req, res }) => {
        const result = xDashboardAuthService(routeX).setup(routeX, {
          host: req.headers.host,
        });
        if (result.status === "password_already_set") {
          res.status(400).json({ error: "Password already set. Use login instead." });
          return;
        }
        res.setHeader("Set-Cookie", result.cookie);
        return { ok: true, password: result.password, token: result.token };
      },
    });

    registerRoute(x, {
      router,
      method: "POST",
      path: "/login",
      auth: "public",
      schemas: {
        params: emptyRouteSchema,
        query: emptyRouteSchema,
        body: dashboardLoginRequestSchema,
      },
      responseSchema: jsonResponseSchema,
      handler: (routeX, { data: { body }, req, res }) => {
        const result = xDashboardAuthService(routeX).login(routeX, {
          password: body.password,
          ip: req.ip || req.socket.remoteAddress || "unknown",
          host: req.headers.host,
        });
        if (result.status === "rate_limited") {
          res.status(429).json({
            error: "Too many login attempts. Try again in 15 minutes.",
          });
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
        return { ok: true, token: result.token };
      },
    });

    registerRoute(x, {
      router,
      method: "POST",
      path: "/logout",
      auth: "public",
      schemas: {
        params: emptyRouteSchema,
        query: emptyRouteSchema,
        body: unknownRouteSchema,
      },
      responseSchema: jsonResponseSchema,
      handler: (routeX, { data: _input, req, res }) => {
        const cookie = xDashboardAuthService(routeX).logout(routeX, {
          cookieHeader: req.headers.cookie,
          authorizationHeader: req.headers.authorization,
          host: req.headers.host,
        });
        res.setHeader("Set-Cookie", cookie);
        return { ok: true };
      },
    });

    return router;
  }
}
