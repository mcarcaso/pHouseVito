import express from "express";
import type { Router } from "express";
import type { Context } from "../context/Context.js";
import type { RouterService } from "./RouterService.js";
import { dashboardChatRequestSchema } from "../shared/schemas/dashboard-chat.js";
import { xDashboardChatService, xSessionStore } from "../lib/x.js";
import { emptyRouteSchema, registerRoute } from "./register-route.js";
import { jsonResponseSchema } from "../shared/schemas/json.js";
function makeChatTitle(value: string): string {
  const title = value.replace(/\s+/g, " ").trim() || "New chat";
  return title.length > 60 ? `${title.slice(0, 59).trimEnd()}…` : title;
}

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
        const chatService = xDashboardChatService(routeX);
        if (!chatService.isConfigured(routeX)) {
          res.status(400).json({ error: "Invalid chat message or no handler" });
          return;
        }

        const sessionId = input.body.sessionId;
        if (sessionId?.startsWith("dashboard:")) {
          const sessionStore = xSessionStore(routeX);
          const existing = sessionStore.list(routeX, { ids: [sessionId], limit: 1 })[0];
          if (!existing) {
            const now = Date.now();
            const target = sessionId.slice("dashboard:".length);
            const titleSource =
              input.body.content || input.body.attachments?.[0]?.filename || "New chat";
            sessionStore.create(routeX, {
              id: sessionId,
              channel: "dashboard",
              channel_target: target,
              created_at: now,
              last_active_at: now,
              config: "{}",
              alias: makeChatTitle(titleSource),
            });
          }
        }

        if (!chatService.send(routeX, input.body)) {
          res.status(400).json({ error: "Invalid chat message or no handler" });
          return;
        }
        return { ok: true };
      },
    });

    return router;
  }
}
