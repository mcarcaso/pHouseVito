import express from "express";
import type { Router } from "express";
import { z } from "zod";
import type { Context } from "../../context/Context.js";
import { xSkillStore } from "../../lib/x.js";
import {
  emptyRouteSchema,
  unknownRouteSchema,
  validatedRoute,
} from "../route.js";

const skillParamsSchema = z.object({
  name: z.string().min(1),
}).strict();

export function createSkillRouter(x: Context): Router {
  const router = express.Router();

  router.get("/", validatedRoute(
    x,
    {
      params: emptyRouteSchema,
      query: emptyRouteSchema,
      body: unknownRouteSchema,
    },
    (routeX, _input, _req, res) => {
      res.json(xSkillStore(routeX).list(routeX, {}));
    }
  ));

  router.get("/:name/files", validatedRoute(
    x,
    {
      params: skillParamsSchema,
      query: emptyRouteSchema,
      body: unknownRouteSchema,
    },
    (routeX, { params }, _req, res) => {
      const skill = xSkillStore(routeX).list(routeX, {
        names: [params.name],
        includeFiles: true,
      })[0];
      if (!skill) {
        res.status(404).json({ error: "Skill not found" });
        return;
      }
      res.json(skill.files ?? []);
    }
  ));

  return router;
}
