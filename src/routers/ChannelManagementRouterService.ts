import express from "express";
import type { NextFunction, Request, Response, Router } from "express";
import type { Context } from "../context/Context.js";
import type { RouterService } from "./RouterService.js";
import { xChannelRegistryService } from "../lib/x.js";
import {
  ChannelManagementNotSupportedError,
  ChannelNotConfiguredError,
} from "../services/channels/ChannelRegistryService.js";
import {
  emptyRouteSchema,
  unknownRouteSchema,
  createRawRoute,
} from "./createRoute.js";

export type ManagedChannelName = "discord" | "telegram";

function channelErrorMiddleware(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const message = error instanceof Error ? error.message : String(error);
  const isConfigurationError =
    error instanceof ChannelNotConfiguredError ||
    error instanceof ChannelManagementNotSupportedError;
  res.status(isConfigurationError ? 400 : 500).json({
    success: false,
    error: message,
  });
}

function createChannelManagementRouter(
  x: Context,
  channel: ManagedChannelName,
): Router {
  const router = express.Router();

  router.post(
    "/register-commands",
    createRawRoute(x, {
      auth: "dashboard",
      schemas: {
        params: emptyRouteSchema,
        query: emptyRouteSchema,
        body: unknownRouteSchema,
      },
      handler: async (routeX, _input, _req, res) => {
        res.json(
          await xChannelRegistryService(routeX).registerCommands(
            routeX,
            channel,
          ),
        );
      },
    }),
  );

  router.post(
    "/auto-alias",
    createRawRoute(x, {
      auth: "dashboard",
      schemas: {
        params: emptyRouteSchema,
        query: emptyRouteSchema,
        body: unknownRouteSchema,
      },
      handler: async (routeX, _input, _req, res) => {
        res.json(
          await xChannelRegistryService(routeX).generateAliases(
            routeX,
            channel,
          ),
        );
      },
    }),
  );

  router.use(channelErrorMiddleware);
  return router;
}

export class ChannelManagementRouterService implements RouterService {
  constructor(private readonly channel: ManagedChannelName) {}

  async createRouter(x: Context): Promise<Router> {
    return createChannelManagementRouter(x, this.channel);
  }
}
