import express from "express";
import type { Router } from "express";
import { z } from "zod";
import type { Context } from "../context/Context.js";
import type { RouterService } from "./RouterService.js";
import { xSkillStore } from "../lib/x.js";
import { emptyRouteSchema, unknownRouteSchema, registerRoute } from "./register-route.js";
import { jsonResponseSchema } from "../shared/schemas/json.js";
const skillParamsSchema = z
  .object({
    name: z.string().min(1),
  })
  .strict();

export class SkillRouterService implements RouterService {
  async createRouter(x: Context): Promise<Router> {
    const router = express.Router();

    registerRoute(x, {
      router,
      method: "GET",
      path: "/",
      auth: "dashboard",
      schemas: {
        params: emptyRouteSchema,
        query: emptyRouteSchema,
        body: unknownRouteSchema,
      },
      responseSchema: jsonResponseSchema,
      handler: (routeX, { data: _input, req: _req, res }) => {
        return xSkillStore(routeX).list(routeX, {});
      },
    });

    registerRoute(x, {
      router,
      method: "GET",
      path: "/:name/files",
      auth: "dashboard",
      schemas: {
        params: skillParamsSchema,
        query: emptyRouteSchema,
        body: unknownRouteSchema,
      },
      responseSchema: jsonResponseSchema,
      handler: (routeX, { data: { params }, req: _req, res }) => {
        const skill = xSkillStore(routeX).list(routeX, {
          names: [params.name],
          includeFiles: true,
        })[0];
        if (!skill) {
          res.status(404).json({ error: "Skill not found" });
          return;
        }
        return skill.files ?? [];
      },
    });

    return router;
  }
}
