import express from "express";
import type { Router } from "express";
import { z } from "zod";
import type { Context } from "../../context/Context.js";
import { xFileService } from "../../lib/x.js";
import {
  emptyRouteSchema,
  unknownRouteSchema,
  validatedRoute,
} from "../route.js";

const fileQuerySchema = z.object({ path: z.unknown().optional() }).passthrough();

export function createFileRouter(x: Context): Router {
  const router = express.Router();
  router.get("/", validatedRoute(
    x,
    { params: emptyRouteSchema, query: fileQuerySchema, body: unknownRouteSchema },
    (routeX, { query }, _req, res) => {
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
    }
  ));
  return router;
}
