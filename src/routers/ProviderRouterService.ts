import express from "express";
import type { NextFunction, Request, Response, Router } from "express";
import { z } from "zod";
import type { Context } from "../context/Context.js";
import {
  providerIdSchema,
  providerLoginPromptRequestSchema,
} from "../shared/contracts/provider-api.js";
import type { RouterService } from "./RouterService.js";
import { xProviderService } from "../lib/x.js";
import { ProviderLoginConflictError } from "../services/providers/ProviderService.js";
import {
  emptyRouteSchema,
  unknownRouteSchema,
  createRawRoute,
} from "./createRoute.js";

const providerParamsSchema = z.object({ id: providerIdSchema }).strict();
const modelParamsSchema = z.object({ provider: providerIdSchema }).strict();

function providerErrorMiddleware(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof ProviderLoginConflictError) {
    res.status(409).json({ error: error.message });
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  res.status(500).json({ error: message });
}

function createModelRouter(x: Context): Router {
  const router = express.Router();

  router.get(
    "/providers",
    createRawRoute(x, {
      auth: "dashboard",
      schemas: {
        params: emptyRouteSchema,
        query: emptyRouteSchema,
        body: unknownRouteSchema,
      },
      handler: (routeX, _input, _req, res) => {
        res.json(xProviderService(routeX).getOverview(routeX));
      },
    }),
  );

  router.get(
    "/:provider",
    createRawRoute(x, {
      auth: "dashboard",
      schemas: {
        params: modelParamsSchema,
        query: emptyRouteSchema,
        body: unknownRouteSchema,
      },
      handler: (routeX, { params }, _req, res) => {
        try {
          res.json(
            xProviderService(routeX).listModels(routeX, params.provider),
          );
        } catch {
          res
            .status(400)
            .json({ error: `Unknown provider: ${params.provider}` });
        }
      },
    }),
  );

  router.use(providerErrorMiddleware);
  return router;
}

function createProviderAuthRouter(x: Context): Router {
  const router = express.Router();

  router.post(
    "/:id/login",
    createRawRoute(x, {
      auth: "provider-auth",
      schemas: {
        params: providerParamsSchema,
        query: emptyRouteSchema,
        body: unknownRouteSchema,
      },
      handler: async (routeX, { params }, _req, res) => {
        res.json(await xProviderService(routeX).startLogin(routeX, params.id));
      },
    }),
  );

  router.get(
    "/:id/login/status",
    createRawRoute(x, {
      auth: "provider-auth",
      schemas: {
        params: providerParamsSchema,
        query: emptyRouteSchema,
        body: unknownRouteSchema,
      },
      handler: (routeX, { params }, _req, res) => {
        res.json(xProviderService(routeX).getLoginStatus(routeX, params.id));
      },
    }),
  );

  router.post(
    "/:id/login/prompt",
    createRawRoute(x, {
      auth: "provider-auth",
      schemas: {
        params: providerParamsSchema,
        query: emptyRouteSchema,
        body: providerLoginPromptRequestSchema,
      },
      handler: (routeX, { params, body }, _req, res) => {
        const value = typeof body.value === "string" ? body.value.trim() : "";
        if (!value) {
          res.status(400).json({ error: "Missing prompt value" });
          return;
        }
        xProviderService(routeX).submitPrompt(routeX, {
          providerId: params.id,
          value,
        });
        res.json({ status: "submitted" });
      },
    }),
  );

  router.post(
    "/:id/logout",
    createRawRoute(x, {
      auth: "provider-auth",
      schemas: {
        params: providerParamsSchema,
        query: emptyRouteSchema,
        body: unknownRouteSchema,
      },
      handler: (routeX, { params }, _req, res) => {
        xProviderService(routeX).logout(routeX, params.id);
        res.json({ status: "logged_out" });
      },
    }),
  );

  router.use(providerErrorMiddleware);
  return router;
}

export class ModelRouterService implements RouterService {
  async createRouter(x: Context): Promise<Router> {
    return createModelRouter(x);
  }
}

export class ProviderAuthRouterService implements RouterService {
  async createRouter(x: Context): Promise<Router> {
    return createProviderAuthRouter(x);
  }
}
