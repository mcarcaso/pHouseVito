import express from "express";
import type { Router } from "express";
import type { Context } from "../context/Context.js";
import type { RouterService } from "./RouterService.js";
import {
  type VitoConfig,
  type VitoConfigPatch,
  vitoConfigPatchSchema,
} from "../shared/schemas/vito-config.js";
import { CHANNEL_CATALOG } from "../shared/channel-catalog.js";
import { xSecretService, xVitoService } from "../lib/x.js";
import { getDefaultSettings } from "../services/vito/settings.js";
import { emptyRouteSchema, unknownRouteSchema, registerRoute } from "./register-route.js";
import { jsonResponseSchema } from "../shared/schemas/json.js";
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
    const startupChannels = xVitoService(x).getConfig(x).channels;
    const startupEnabled = new Map(
      CHANNEL_CATALOG.map(({ name }) => [name, startupChannels[name]?.enabled === true]),
    );

    registerRoute(x, {
      router,
      method: "GET",
      path: "/channels/setup",
      auth: "dashboard",
      schemas: { params: emptyRouteSchema, query: emptyRouteSchema, body: unknownRouteSchema },
      responseSchema: jsonResponseSchema,
      handler: (routeX) => {
        const config = xVitoService(routeX).getConfig(routeX);
        return CHANNEL_CATALOG.map(({ name, requiredSecrets }) => {
          const enabled = config.channels[name]?.enabled === true;
          const atStartup = startupEnabled.get(name) === true;
          return {
            name,
            requiredSecrets: [...requiredSecrets],
            missingSecrets: requiredSecrets.filter(
              (key) => !xSecretService(routeX).get(routeX, key)?.trim(),
            ),
            enabled,
            startupEnabled: atStartup,
            restartRequired: enabled !== atStartup,
          };
        });
      },
    });

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
        const current = vitoService.getConfig(routeX);
        const candidate = applyConfigPatch(current, body);
        for (const { name, requiredSecrets } of CHANNEL_CATALOG) {
          if (
            candidate.channels[name]?.enabled !== true ||
            current.channels[name]?.enabled === true
          )
            continue;
          const missing = requiredSecrets.filter(
            (key) => !xSecretService(routeX).get(routeX, key)?.trim(),
          );
          if (missing.length) {
            res.status(400).json({
              error: `Cannot enable ${name}: set ${missing.join(", ")} in Secrets first.`,
              missingSecrets: missing,
            });
            return;
          }
        }
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

    return router;
  }
}
