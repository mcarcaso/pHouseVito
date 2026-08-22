import express from "express";
import type { Router } from "express";
import type { Context } from "../context/Context.js";
import type { RouterService } from "./RouterService.js";
import { dashboardChatRequestSchema } from "../shared/schemas/dashboard-chat.js";
import { xDashboardChatService } from "../lib/x.js";
import { emptyRouteSchema, registerRoute } from "./register-route.js";
import { jsonResponseSchema } from "../shared/schemas/json.js";
export class DashboardChatRouterService implements RouterService {
  async createRouter(x: Context): Promise<Router> {
    const router = express.Router();

    registerRoute(x, {
      router,
      method: "POST",
      path: "/",
      auth: "dashboard",
      schemas: {
        params: emptyRouteSchema,
        query: emptyRouteSchema,
        body: dashboardChatRequestSchema,
      },
      responseSchema: jsonResponseSchema,
      handler: (routeX, { data: input, req: _req, res }) => {
        console.log(
          `[Dashboard] HTTP chat received: content=${input.body.content?.substring(0, 50)}`,
        );
        if (!xDashboardChatService(routeX).send(routeX, input.body)) {
          res.status(400).json({ error: "Invalid chat message or no handler" });
          return;
        }
        return { ok: true };
      },
    });

    return router;
  }
}
