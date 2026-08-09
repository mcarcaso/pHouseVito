import express from "express";
import type { NextFunction, Request, Response, Router } from "express";
import { z } from "zod";
import type { Context } from "../../context/Context.js";
import type { RouterService } from "../RouterService.js";
import {
  appFilePathSchema,
  appNameSchema,
  appProcessActionSchema,
  appReadFileResultSchema,
} from "../../shared/contracts/app.js";
import { xAppProcessService, xAppStore } from "../../lib/x.js";
import { AppFileTooLargeError } from "../../stores/apps/FileAppStore.js";
import {
  emptyRouteSchema,
  unknownRouteSchema,
  validatedRoute,
} from "../route.js";

const appParamsSchema = z.object({ name: appNameSchema }).strict();
const appFileParamsSchema = z.object({
  name: appNameSchema,
  filepath: z.union([z.string(), z.array(z.string())])
    .transform((value) => Array.isArray(value) ? value.join("/") : value)
    .pipe(appFilePathSchema),
}).strict();

function appErrorMiddleware(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (error instanceof AppFileTooLargeError) {
    res.status(413).json({ error: error.message });
    return;
  }
  const message = error instanceof Error ? error.message : "App operation failed";
  res.status(500).json({ error: message });
}

export class AppRouterService implements RouterService {
  async createRouter(x: Context): Promise<Router> {
    const router = express.Router();

    router.get("/", validatedRoute(
      x,
      { params: emptyRouteSchema, query: emptyRouteSchema, body: unknownRouteSchema },
      async (routeX, _input, _req, res) => {
        const apps = xAppStore(routeX).list(routeX, {});
        const statuses = new Map(
          (await xAppProcessService(routeX).list(routeX, apps.map((app) => app.name)))
            .map((status) => [status.name, status])
        );
        res.json(apps.map((app) => {
          const process = statuses.get(app.name);
          return {
            name: app.name,
            description: app.description,
            port: app.port,
            url: app.url,
            createdAt: app.createdAt,
            status: process?.status ?? "unknown",
            uptime: process?.uptime ?? null,
            restarts: process?.restarts ?? 0,
            memory: process?.memory ?? null,
          };
        }));
      }
    ));

    router.post("/:name/:action", validatedRoute(
      x,
      {
        params: appParamsSchema.extend({ action: appProcessActionSchema }),
        query: emptyRouteSchema,
        body: unknownRouteSchema,
      },
      async (routeX, { params }, req, res) => {
        const clientIp = req.headers["x-forwarded-for"] ?? req.socket.remoteAddress;
        console.log(
          `[Dashboard] App ${params.action} requested: ${params.name} from ${String(clientIp ?? "unknown")} ua=${req.headers["user-agent"] ?? "unknown"}`
        );
        await xAppProcessService(routeX).execute(routeX, {
          action: params.action,
          appName: params.name,
        });
        const pastTense = params.action === "stop"
          ? "Stopped"
          : params.action === "start"
            ? "Started"
            : "Restarted";
        res.json({ success: true, message: `${pastTense} ${params.name}` });
      }
    ));

    router.delete("/:name", validatedRoute(
      x,
      { params: appParamsSchema, query: emptyRouteSchema, body: unknownRouteSchema },
      async (routeX, { params }, _req, res) => {
        try {
          await xAppProcessService(routeX).execute(routeX, {
            action: "delete",
            appName: params.name,
          });
        } catch {
          // An app may have no active PM2 process; filesystem deletion still applies.
        }
        xAppStore(routeX).delete(routeX, { names: [params.name] });
        res.json({ success: true, message: `Deleted ${params.name}` });
      }
    ));

    router.get("/:name/files", validatedRoute(
      x,
      { params: appParamsSchema, query: emptyRouteSchema, body: unknownRouteSchema },
      (routeX, { params }, _req, res) => {
        const app = xAppStore(routeX).list(routeX, {
          names: [params.name],
          includeFiles: true,
        })[0];
        if (!app) {
          res.status(404).json({ error: "App not found" });
          return;
        }
        res.json(app.files ?? []);
      }
    ));

    router.get("/:name/files/*filepath", validatedRoute(
      x,
      { params: appFileParamsSchema, query: emptyRouteSchema, body: unknownRouteSchema },
      (routeX, { params }, _req, res) => {
        const result = appReadFileResultSchema.safeParse(
          xAppStore(routeX).cmd(routeX, {
            type: "read-file",
            appName: params.name,
            path: params.filepath,
            maxBytes: 1024 * 1024,
          })
        );
        if (!result.success) {
          res.status(404).json({ error: "File not found" });
          return;
        }
        res.json(result.data);
      }
    ));

    router.use(appErrorMiddleware);
    return router;
  }
}
