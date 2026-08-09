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
} from "../shared/contracts/vito-config.js";
import { xVitoService } from "../lib/x.js";
import { getDefaultSettings } from "../settings.js";
import {
  emptyRouteSchema,
  unknownRouteSchema,
  createRawRoute,
} from "./createRoute.js";

const channelParamsSchema = z.object({
  name: z.string().min(1),
});

function applyConfigPatch(
  config: VitoConfig,
  patch: VitoConfigPatch,
): VitoConfig {
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
    settings: patch.settings
      ? { ...config.settings, ...patch.settings }
      : config.settings,
    harnesses: patch.harnesses
      ? { ...config.harnesses, ...patch.harnesses }
      : config.harnesses,
    channels: patch.channels
      ? { ...config.channels, ...patch.channels }
      : config.channels,
    sessions:
      patch.sessions !== undefined ? (patch.sessions ?? {}) : config.sessions,
    compaction: patch.compaction
      ? { ...config.compaction, ...patch.compaction }
      : config.compaction,
  };
}

export class ConfigRouterService implements RouterService {
  async createRouter(x: Context): Promise<Router> {
    const router = express.Router();

    router.get(
      "/config",
      createRawRoute(x, {
        auth: "dashboard",
        schemas: {
          params: emptyRouteSchema,
          query: emptyRouteSchema,
          body: unknownRouteSchema,
        },
        handler: (routeX, _input, _req, res) => {
          res.json(xVitoService(routeX).getConfig(routeX));
        },
      }),
    );

    router.put(
      "/config",
      createRawRoute(x, {
        auth: "dashboard",
        schemas: {
          params: emptyRouteSchema,
          query: emptyRouteSchema,
          body: vitoConfigPatchSchema,
        },
        handler: (routeX, { body }, _req, res) => {
          const vitoService = xVitoService(routeX);
          const candidate = applyConfigPatch(
            vitoService.getConfig(routeX),
            body,
          );
          const validation = vitoService.validateConfig(routeX, candidate);
          if (!validation.valid) {
            res
              .status(400)
              .json({ error: "Invalid config", issues: validation.issues });
            return;
          }

          res.json(vitoService.saveConfig(routeX, validation.config));
        },
      }),
    );

    router.get(
      "/settings/defaults",
      createRawRoute(x, {
        auth: "dashboard",
        schemas: {
          params: emptyRouteSchema,
          query: emptyRouteSchema,
          body: unknownRouteSchema,
        },
        handler: (_routeX, _input, _req, res) => {
          res.json(getDefaultSettings());
        },
      }),
    );

    router.get(
      "/channels/:name/stream-mode",
      createRawRoute(x, {
        auth: "dashboard",
        schemas: {
          params: channelParamsSchema,
          query: emptyRouteSchema,
          body: unknownRouteSchema,
        },
        handler: (routeX, { params }, _req, res) => {
          const config = xVitoService(routeX).getConfig(routeX);
          res.json({
            streamMode: config.channels[params.name]?.streamMode || "final",
          });
        },
      }),
    );

    router.put(
      "/channels/:name/stream-mode",
      createRawRoute(x, {
        auth: "dashboard",
        schemas: {
          params: channelParamsSchema,
          query: emptyRouteSchema,
          body: streamModeUpdateSchema,
        },
        handler: (routeX, { params, body }, _req, res) => {
          const vitoService = xVitoService(routeX);
          const config = vitoService.getConfig(routeX);
          const channel = config.channels[params.name] ?? { enabled: true };
          config.channels[params.name] = {
            ...channel,
            streamMode: body.streamMode,
          };
          vitoService.saveConfig(routeX, config);
          res.json({ streamMode: body.streamMode });
        },
      }),
    );

    return router;
  }
}
