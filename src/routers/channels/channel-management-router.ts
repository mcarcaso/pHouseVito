import express from "express";
import type { NextFunction, Request, Response, Router } from "express";
import type { Context } from "../../context/Context.js";
import { xChannelManagementService } from "../../lib/x.js";
import {
  ChannelNotConfiguredError,
  type ManagedChannelName,
} from "../../services/channels/ChannelManagementService.js";
import {
  emptyRouteSchema,
  unknownRouteSchema,
  validatedRoute,
} from "../route.js";

function channelErrorMiddleware(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const message = error instanceof Error ? error.message : String(error);
  res.status(error instanceof ChannelNotConfiguredError ? 400 : 500).json({
    success: false,
    error: message,
  });
}

export function createChannelManagementRouter(
  x: Context,
  channel: ManagedChannelName
): Router {
  const router = express.Router();

  router.post("/register-commands", validatedRoute(
    x,
    { params: emptyRouteSchema, query: emptyRouteSchema, body: unknownRouteSchema },
    async (routeX, _input, _req, res) => {
      res.json(await xChannelManagementService(routeX).registerCommands(routeX, channel));
    }
  ));

  router.post("/auto-alias", validatedRoute(
    x,
    { params: emptyRouteSchema, query: emptyRouteSchema, body: unknownRouteSchema },
    async (routeX, _input, _req, res) => {
      res.json(await xChannelManagementService(routeX).generateAliases(routeX, channel));
    }
  ));

  router.use(channelErrorMiddleware);
  return router;
}
