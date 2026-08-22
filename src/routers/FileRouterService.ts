import express from "express";
import type { Router } from "express";
import { z } from "zod";
import type { Context } from "../context/Context.js";
import type { RouterService } from "./RouterService.js";
import { xFileService } from "../lib/x.js";
import { emptyRouteSchema, unknownRouteSchema, registerStreamRoute } from "./register-route.js";

const fileQuerySchema = z.object({ path: z.unknown().optional() }).passthrough();

export class FileRouterService implements RouterService {
  async createRouter(x: Context): Promise<Router> {
    const router = express.Router();
    registerStreamRoute(x, {
      router,
      method: "GET",
      path: "/",
      auth: "dashboard",
      schemas: {
        params: emptyRouteSchema,
        query: fileQuerySchema,
        body: unknownRouteSchema,
      },
      handler: (routeX, { query }, _req, res) => {
        if (typeof query.path !== "string" || !query.path) {
          res.status(400).json({ error: "path query parameter required" });
          return;
        }
        const file = xFileService(routeX).read(routeX, query.path);
        if (!file) {
          res.status(404).json({ error: "File not found" });
          return;
        }
        const safeName = file.name.replace(/["\r\n]/g, "_");
        res.setHeader("Content-Type", file.mimeType);
        res.setHeader("Content-Length", file.size);
        res.setHeader("Content-Disposition", `${file.disposition}; filename="${safeName}"`);
        file.stream.on("error", () => {
          if (!res.headersSent) res.status(500).end();
          else res.destroy();
        });
        file.stream.pipe(res);
      },
    });
    return router;
  }
}
