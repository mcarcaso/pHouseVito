import express from "express";
import type { RequestHandler, Router } from "express";
import type { Context } from "../../context/Context.js";
import { askApiRequestSchema } from "../../contracts/ask-api.js";
import { xAskApiService, xSecretService } from "../../lib/x.js";
import { emptyRouteSchema, validatedRoute } from "../route.js";

function createAskAuthenticationMiddleware(x: Context): RequestHandler {
  return (req, res, next) => {
    const apiKey = xSecretService(x).get(x, "VITO_ASK_API_KEY");
    if (!apiKey) {
      res.status(503).json({
        error: "Ask API is disabled — no VITO_ASK_API_KEY configured",
      });
      return;
    }

    const authHeader = req.headers.authorization ?? "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : authHeader;
    if (!token || token !== apiKey) {
      res.status(401).json({
        error: "Unauthorized — invalid or missing API key",
      });
      return;
    }

    if (!xAskApiService(x).isConfigured(x)) {
      res.status(503).json({ error: "Ask handler not configured" });
      return;
    }
    next();
  };
}

export function createAskApiRouter(x: Context): Router {
  const router = express.Router();

  router.post("/", createAskAuthenticationMiddleware(x), validatedRoute(
    x,
    {
      params: emptyRouteSchema,
      query: emptyRouteSchema,
      body: askApiRequestSchema,
    },
    async (routeX, input, _req, res) => {
      const { question, session, author, channelPrompt, timeoutMs, relayToSession } = input.body;
      const start = Date.now();
      console.log(
        `[Dashboard] /api/ask request: session=${session || "api:default"} question="${question.slice(0, 80)}"`
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
        console.log(
          `[Dashboard] /api/ask response (${elapsed}ms): "${answer.slice(0, 100)}"`
        );
        res.json({ answer, elapsed });
      } catch (error) {
        console.error("[Dashboard] /api/ask error:", error);
        res.status(500).json({
          error: "Failed to process question",
          answer: "I hit a snag. Try again.",
        });
      }
    }
  ));

  return router;
}
