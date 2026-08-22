import express from "express";
import type { NextFunction, Request, Response, Router } from "express";
import type { Context } from "../context/Context.js";
import type { RouterService } from "./RouterService.js";
import { xChannelRegistryService } from "../lib/x.js";
import {
  ChannelManagementNotSupportedError,
  ChannelNotConfiguredError,
} from "../services/channels/ChannelRegistryService.js";
import { emptyRouteSchema, unknownRouteSchema, registerRoute } from "./register-route.js";
import { jsonResponseSchema } from "../shared/schemas/json.js";
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

function createChannelManagementRouter(x: Context, channel: ManagedChannelName): Router {
  const router = express.Router();

  registerRoute(x, {
    router,
    method: "POST",
    path: "/register-commands",
    auth: "dashboard",
    delegateErrors: true,
    schemas: {
      params: emptyRouteSchema,
      query: emptyRouteSchema,
      body: unknownRouteSchema,
    },
    responseSchema: jsonResponseSchema,
    handler: async (routeX, { data: _input, req: _req, res }) => {
      return await xChannelRegistryService(routeX).registerCommands(routeX, channel);
    },
  });

  registerRoute(x, {
    router,
    method: "POST",
    path: "/auto-alias",
    auth: "dashboard",
    delegateErrors: true,
    schemas: {
      params: emptyRouteSchema,
      query: emptyRouteSchema,
      body: unknownRouteSchema,
    },
    responseSchema: jsonResponseSchema,
    handler: async (routeX, { data: _input, req: _req, res }) => {
      return await xChannelRegistryService(routeX).generateAliases(routeX, channel);
    },
  });

  router.use(channelErrorMiddleware);
  return router;
}

export class ChannelManagementRouterService implements RouterService {
  constructor(private readonly channel: ManagedChannelName) {}

  async createRouter(x: Context): Promise<Router> {
    return createChannelManagementRouter(x, this.channel);
  }
}
