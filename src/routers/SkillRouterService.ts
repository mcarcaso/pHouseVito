import express from "express";
import type { Router } from "express";
import { z } from "zod";
import type { Context } from "../context/Context.js";
import type { RouterService } from "./RouterService.js";
import { xSkillStore } from "../lib/x.js";
import {
  emptyRouteSchema,
  unknownRouteSchema,
  createRawRoute,
} from "./createRoute.js";

const skillParamsSchema = z
  .object({
    name: z.string().min(1),
  })
  .strict();

export class SkillRouterService implements RouterService {
  async createRouter(x: Context): Promise<Router> {
    const router = express.Router();

    router.get(
      "/",
      createRawRoute(x, {
        auth: "dashboard",
        schemas: {
          params: emptyRouteSchema,
          query: emptyRouteSchema,
          body: unknownRouteSchema,
        },
        handler: (routeX, _input, _req, res) => {
          res.json(xSkillStore(routeX).list(routeX, {}));
        },
      }),
    );

    router.get(
      "/:name/files",
      createRawRoute(x, {
        auth: "dashboard",
        schemas: {
          params: skillParamsSchema,
          query: emptyRouteSchema,
          body: unknownRouteSchema,
        },
        handler: (routeX, { params }, _req, res) => {
          const skill = xSkillStore(routeX).list(routeX, {
            names: [params.name],
            includeFiles: true,
          })[0];
          if (!skill) {
            res.status(404).json({ error: "Skill not found" });
            return;
          }
          res.json(skill.files ?? []);
        },
      }),
    );

    return router;
  }
}
