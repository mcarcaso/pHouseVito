import express from "express";
import type { Router } from "express";
import { z } from "zod";
import type { Context } from "../context/Context.js";
import { secretKeySchema, secretUpdateRequestSchema } from "../shared/schemas/secret-api.js";
import type { RouterService } from "./RouterService.js";
import { xSecretService } from "../lib/x.js";
import { SystemSecretDeletionError } from "../services/secrets/SecretService.js";
import { emptyRouteSchema, unknownRouteSchema, registerRoute } from "./register-route.js";
import { jsonResponseSchema } from "../shared/schemas/json.js";
const secretParamsSchema = z.object({ key: secretKeySchema }).strict();

export class SecretRouterService implements RouterService {
  async createRouter(x: Context): Promise<Router> {
    const router = express.Router();

    registerRoute(x, {
      router,
      method: "GET",
      path: "/",
      auth: "dashboard",
      schemas: {
        params: emptyRouteSchema,
        query: emptyRouteSchema,
        body: unknownRouteSchema,
      },
      responseSchema: jsonResponseSchema,
      handler: (routeX, { data: _input, req: _req, res }) => {
        return xSecretService(routeX).list(routeX);
      },
    });

    registerRoute(x, {
      router,
      method: "PUT",
      path: "/:key",
      auth: "dashboard",
      schemas: {
        params: secretParamsSchema,
        query: emptyRouteSchema,
        body: secretUpdateRequestSchema,
      },
      responseSchema: jsonResponseSchema,
      handler: (routeX, { data: { params, body }, req: _req, res }) => {
        const secret = xSecretService(routeX).set(routeX, {
          key: params.key,
          value: body.value,
        });
        return { key: secret.key, value: secret.value };
      },
    });

    registerRoute(x, {
      router,
      method: "DELETE",
      path: "/:key",
      auth: "dashboard",
      schemas: {
        params: secretParamsSchema,
        query: emptyRouteSchema,
        body: unknownRouteSchema,
      },
      responseSchema: jsonResponseSchema,
      handler: (routeX, { data: { params }, req: _req, res }) => {
        try {
          xSecretService(routeX).delete(routeX, { key: params.key });
          res.status(204).end();
        } catch (error) {
          if (!(error instanceof SystemSecretDeletionError)) throw error;
          res.status(400).json({
            error: "Cannot delete a system key — clear its value instead",
          });
        }
      },
    });

    return router;
  }
}
