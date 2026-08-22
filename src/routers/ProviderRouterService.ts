import express from "express";
import type { NextFunction, Request, Response, Router } from "express";
import { z } from "zod";
import type { Context } from "../context/Context.js";
import {
  providerIdSchema,
  providerLoginPromptRequestSchema,
} from "../shared/schemas/provider-api.js";
import type { RouterService } from "./RouterService.js";
import { xProviderService } from "../lib/x.js";
import { ProviderLoginConflictError } from "../services/providers/ProviderService.js";
import { emptyRouteSchema, unknownRouteSchema, registerRoute } from "./register-route.js";
import { jsonResponseSchema } from "../shared/schemas/json.js";
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

  registerRoute(x, {
    router,
    method: "GET",
    path: "/providers",
    auth: "dashboard",
    delegateErrors: true,
    schemas: {
      params: emptyRouteSchema,
      query: emptyRouteSchema,
      body: unknownRouteSchema,
    },
    responseSchema: jsonResponseSchema,
    handler: async (routeX, { data: _input, req: _req, res }) => {
      return await xProviderService(routeX).getOverview(routeX);
    },
  });

  registerRoute(x, {
    router,
    method: "GET",
    path: "/:provider",
    auth: "dashboard",
    delegateErrors: true,
    schemas: {
      params: modelParamsSchema,
      query: emptyRouteSchema,
      body: unknownRouteSchema,
    },
    responseSchema: jsonResponseSchema,
    handler: async (routeX, { data: { params }, req: _req, res }) => {
      try {
        return await xProviderService(routeX).listModels(routeX, params.provider);
      } catch {
        res.status(400).json({ error: `Unknown provider: ${params.provider}` });
      }
    },
  });

  router.use(providerErrorMiddleware);
  return router;
}

function createProviderAuthRouter(x: Context): Router {
  const router = express.Router();

  registerRoute(x, {
    router,
    method: "POST",
    path: "/:id/login",
    auth: "dashboard",
    delegateErrors: true,
    schemas: {
      params: providerParamsSchema,
      query: emptyRouteSchema,
      body: unknownRouteSchema,
    },
    responseSchema: jsonResponseSchema,
    handler: async (routeX, { data: { params }, req: _req, res }) => {
      return await xProviderService(routeX).startLogin(routeX, params.id);
    },
  });

  registerRoute(x, {
    router,
    method: "GET",
    path: "/:id/login/status",
    auth: "dashboard",
    delegateErrors: true,
    schemas: {
      params: providerParamsSchema,
      query: emptyRouteSchema,
      body: unknownRouteSchema,
    },
    responseSchema: jsonResponseSchema,
    handler: (routeX, { data: { params }, req: _req, res }) => {
      return xProviderService(routeX).getLoginStatus(routeX, params.id);
    },
  });

  registerRoute(x, {
    router,
    method: "POST",
    path: "/:id/login/prompt",
    auth: "dashboard",
    delegateErrors: true,
    schemas: {
      params: providerParamsSchema,
      query: emptyRouteSchema,
      body: providerLoginPromptRequestSchema,
    },
    responseSchema: jsonResponseSchema,
    handler: (routeX, { data: { params, body }, req: _req, res }) => {
      const value = typeof body.value === "string" ? body.value.trim() : "";
      if (!value) {
        res.status(400).json({ error: "Missing prompt value" });
        return;
      }
      xProviderService(routeX).submitPrompt(routeX, {
        providerId: params.id,
        value,
      });
      return { status: "submitted" };
    },
  });

  registerRoute(x, {
    router,
    method: "POST",
    path: "/:id/logout",
    auth: "dashboard",
    delegateErrors: true,
    schemas: {
      params: providerParamsSchema,
      query: emptyRouteSchema,
      body: unknownRouteSchema,
    },
    responseSchema: jsonResponseSchema,
    handler: async (routeX, { data: { params }, req: _req, res }) => {
      await xProviderService(routeX).logout(routeX, params.id);
      return { status: "logged_out" };
    },
  });

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
