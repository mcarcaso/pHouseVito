import express from "express";
import type { Router } from "express";
import { z } from "zod";
import type { Context } from "../context/Context.js";
import type { RouterService } from "./RouterService.js";
import {
  type VitoConfig,
  type VitoConfigPatch,
  streamModeUpdateSchema,
  vitoConfigPatchSchema,
} from "../shared/schemas/vito-config.js";
import { xVitoService } from "../lib/x.js";
import { getDefaultSettings } from "../services/vito/settings.js";
import { emptyRouteSchema, unknownRouteSchema, registerRoute } from "./register-route.js";
import { jsonResponseSchema } from "../shared/schemas/json.js";
const channelParamsSchema = z.object({
  name: z.string().min(1),
});

function applyConfigPatch(config: VitoConfig, patch: VitoConfigPatch): VitoConfig {
  return {
    ...config,
    bot: patch.bot
      ? {
          ...config.bot,
          ...patch.bot,
          name: patch.bot.name ?? config.bot?.name ?? "",
        }
      : config.bot,
    apps: patch.apps ? { ...config.apps, ...patch.apps } : config.apps,
    settings: patch.settings ? { ...config.settings, ...patch.settings } : config.settings,
    channels: patch.channels ? { ...config.channels, ...patch.channels } : config.channels,
    sessions: patch.sessions !== undefined ? (patch.sessions ?? {}) : config.sessions,
    compaction: patch.compaction
      ? { ...config.compaction, ...patch.compaction }
      : config.compaction,
  };
}

export class ConfigRouterService implements RouterService {
  async createRouter(x: Context): Promise<Router> {
    const router = express.Router();

    registerRoute(x, {
      router,
      method: "GET",
      path: "/config",
      auth: "dashboard",
      schemas: {
        params: emptyRouteSchema,
        query: emptyRouteSchema,
        body: unknownRouteSchema,
      },
      responseSchema: jsonResponseSchema,
      handler: (routeX, { data: _input, req: _req, res }) => {
        return xVitoService(routeX).getConfig(routeX);
      },
    });

    registerRoute(x, {
      router,
      method: "PUT",
      path: "/config",
      auth: "dashboard",
      schemas: {
        params: emptyRouteSchema,
        query: emptyRouteSchema,
        body: vitoConfigPatchSchema,
      },
      responseSchema: jsonResponseSchema,
      handler: (routeX, { data: { body }, req: _req, res }) => {
        const vitoService = xVitoService(routeX);
        const candidate = applyConfigPatch(vitoService.getConfig(routeX), body);
        const validation = vitoService.validateConfig(routeX, candidate);
        if (!validation.valid) {
          res.status(400).json({ error: "Invalid config", issues: validation.issues });
          return;
        }

        return vitoService.saveConfig(routeX, validation.config);
      },
    });

    registerRoute(x, {
      router,
      method: "GET",
      path: "/settings/defaults",
      auth: "dashboard",
      schemas: {
        params: emptyRouteSchema,
        query: emptyRouteSchema,
        body: unknownRouteSchema,
      },
      responseSchema: jsonResponseSchema,
      handler: (_routeX, { data: _input, req: _req, res }) => {
        return getDefaultSettings();
      },
    });

    registerRoute(x, {
      router,
      method: "GET",
      path: "/channels/:name/stream-mode",
      auth: "dashboard",
      schemas: {
        params: channelParamsSchema,
        query: emptyRouteSchema,
        body: unknownRouteSchema,
      },
      responseSchema: jsonResponseSchema,
      handler: (routeX, { data: { params }, req: _req, res }) => {
        const config = xVitoService(routeX).getConfig(routeX);
        return {
          streamMode: config.channels[params.name]?.streamMode || "final",
        };
      },
    });

    registerRoute(x, {
      router,
      method: "PUT",
      path: "/channels/:name/stream-mode",
      auth: "dashboard",
      schemas: {
        params: channelParamsSchema,
        query: emptyRouteSchema,
        body: streamModeUpdateSchema,
      },
      responseSchema: jsonResponseSchema,
      handler: (routeX, { data: { params, body }, req: _req, res }) => {
        const vitoService = xVitoService(routeX);
        const config = vitoService.getConfig(routeX);
        const channel = config.channels[params.name] ?? { enabled: true };
        config.channels[params.name] = {
          ...channel,
          streamMode: body.streamMode,
        };
        vitoService.saveConfig(routeX, config);
        return { streamMode: body.streamMode };
      },
    });

    return router;
  }
}
