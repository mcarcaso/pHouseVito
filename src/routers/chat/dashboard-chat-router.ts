import express from "express";
import type { Router } from "express";
import type { Context } from "../../context/Context.js";
import type { RouterService } from "../RouterService.js";
import { dashboardChatRequestSchema } from "../../shared/contracts/dashboard-chat.js";
import { xDashboardChatService } from "../../lib/x.js";
import { emptyRouteSchema, createRawRoute } from "../route.js";

export class DashboardChatRouterService implements RouterService {
  async createRouter(x: Context): Promise<Router> {
    const router = express.Router();

    router.post(
      "/",
      createRawRoute(x, {
        auth: "dashboard",
        schemas: {
          params: emptyRouteSchema,
          query: emptyRouteSchema,
          body: dashboardChatRequestSchema,
        },
        handler: (routeX, input, _req, res) => {
          console.log(
            `[Dashboard] HTTP chat received: content=${input.body.content?.substring(0, 50)}`,
          );
          if (!xDashboardChatService(routeX).send(routeX, input.body)) {
            res
              .status(400)
              .json({ error: "Invalid chat message or no handler" });
            return;
          }
          res.json({ ok: true });
        },
      }),
    );

    return router;
  }
}
