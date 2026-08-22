import express from "express";
import type { Router } from "express";
import type { Context } from "../context/Context.js";
import type { RouterService } from "./RouterService.js";
import { askApiRequestSchema } from "../shared/schemas/ask-api.js";
import { xAskApiService } from "../lib/x.js";
import { emptyRouteSchema, registerRoute } from "./register-route.js";
import { jsonResponseSchema } from "../shared/schemas/json.js";
export class AskApiRouterService implements RouterService {
  async createRouter(x: Context): Promise<Router> {
    const router = express.Router();

    registerRoute(x, {
      router,
      method: "POST",
      path: "/",
      auth: "ask",
      schemas: {
        params: emptyRouteSchema,
        query: emptyRouteSchema,
        body: askApiRequestSchema,
      },
      responseSchema: jsonResponseSchema,
      handler: async (routeX, { data: input, req: _req, res }) => {
        const { question, session, author, channelPrompt, timeoutMs, relayToSession } = input.body;
        const start = Date.now();
        console.log(
          `[Dashboard] /api/ask request: session=${session || "api:default"} question="${question.slice(0, 80)}"`,
        );

        try {
          const answer = await xAskApiService(routeX).ask(routeX, {
            question,
            session: session || undefined,
            author: author || undefined,
            channelPrompt: channelPrompt || undefined,
            timeoutMs: typeof timeoutMs === "number" ? timeoutMs : undefined,
            relayToSession: relayToSession === true,
          });
          const elapsed = Date.now() - start;
          console.log(`[Dashboard] /api/ask response (${elapsed}ms): "${answer.slice(0, 100)}"`);
          return { answer, elapsed };
        } catch (error) {
          console.error("[Dashboard] /api/ask error:", error);
          res.status(500).json({
            error: "Failed to process question",
            answer: "I hit a snag. Try again.",
          });
        }
      },
    });

    return router;
  }
}
