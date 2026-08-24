import express from "express";
import type { Router } from "express";
import { readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
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
const skillFileQuerySchema = z
  .object({
    path: z.string().min(1),
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

    registerRoute(x, {
      router,
      method: "GET",
      path: "/:name/file",
      auth: "dashboard",
      schemas: {
        params: skillParamsSchema,
        query: skillFileQuerySchema,
        body: unknownRouteSchema,
      },
      responseSchema: jsonResponseSchema,
      handler: (routeX, { data: { params, query }, req: _req, res }) => {
        const skill = xSkillStore(routeX).list(routeX, {
          names: [params.name],
          includeFiles: true,
        })[0];
        if (!skill) {
          res.status(404).json({ error: "Skill not found" });
          return;
        }
        const skillDir = dirname(skill.path);
        const filePath = resolve(skillDir, query.path);
        if (relative(skillDir, filePath).startsWith("..")) {
          res.status(400).json({ error: "Invalid skill file path" });
          return;
        }
        const file = skill.files?.find((candidate) => resolve(candidate.path) === filePath);
        if (!file) {
          res.status(404).json({ error: "Skill file not found" });
          return;
        }
        if (statSync(filePath).size > 1024 * 1024) {
          return { name: file.name, size: file.size, content: null, binary: true };
        }
        const buffer = readFileSync(filePath);
        const binary = buffer.includes(0);
        return {
          name: file.name,
          size: file.size,
          content: binary ? null : buffer.toString("utf-8"),
          binary,
        };
      },
    });

    return router;
  }
}
