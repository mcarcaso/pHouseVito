import express from "express";
import type { Router } from "express";
import type { Context } from "../../context/Context.js";
import type { RouterService } from "../RouterService.js";
import { systemContentUpdateSchema } from "../../shared/contracts/system-content.js";
import { xVitoService } from "../../lib/x.js";
import { emptyRouteSchema, unknownRouteSchema, validatedRoute } from "../route.js";

export class SystemContentRouterService implements RouterService {
  async createRouter(x: Context): Promise<Router> {
    const router = express.Router();

    router.get("/jobs", validatedRoute(
      x,
      { params: emptyRouteSchema, query: emptyRouteSchema, body: unknownRouteSchema },
      (routeX, _input, _req, res) => {
        res.json(xVitoService(routeX).getConfiguredJobs(routeX));
      }
    ));

    router.get("/soul", validatedRoute(
      x,
      { params: emptyRouteSchema, query: emptyRouteSchema, body: unknownRouteSchema },
      (routeX, _input, _req, res) => {
        res.json({ content: xVitoService(routeX).getSoul(routeX) });
      }
    ));

    router.put("/soul", validatedRoute(
      x,
      {
        params: emptyRouteSchema,
        query: emptyRouteSchema,
        body: systemContentUpdateSchema,
      },
      (routeX, input, _req, res) => {
        xVitoService(routeX).saveSoul(routeX, input.body.content);
        res.json({ content: input.body.content });
      }
    ));

    router.get("/system-prompt", validatedRoute(
      x,
      { params: emptyRouteSchema, query: emptyRouteSchema, body: unknownRouteSchema },
      (routeX, _input, _req, res) => {
        res.json({ content: xVitoService(routeX).getSystemPrompt(routeX) });
      }
    ));

    router.all("/system-prompt", (_req, res) => {
      res.setHeader("allow", "GET");
      res.status(405).json({ error: "System prompt is read-only" });
    });

    return router;
  }
}
