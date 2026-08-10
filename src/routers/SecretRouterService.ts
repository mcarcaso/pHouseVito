import express from "express";
import type { Router } from "express";
import { z } from "zod";
import type { Context } from "../context/Context.js";
import {
  secretKeySchema,
  secretUpdateRequestSchema,
} from "../shared/schemas/secret-api.js";
import type { RouterService } from "./RouterService.js";
import { xSecretService } from "../lib/x.js";
import { SystemSecretDeletionError } from "../services/secrets/SecretService.js";
import {
  emptyRouteSchema,
  unknownRouteSchema,
  createRawRoute,
} from "./createRoute.js";

const secretParamsSchema = z.object({ key: secretKeySchema }).strict();

export class SecretRouterService implements RouterService {
  async createRouter(x: Context): Promise<Router> {
    const router = express.Router();

    router.get(
      "/",
      createRawRoute(x, {
        auth: "dashboard",
        schemas: {
          params: emptyRouteSchema,
          query: emptyRouteSchema,
          body: unknownRouteSchema,
        },
        handler: (routeX, _input, _req, res) => {
          res.json(xSecretService(routeX).list(routeX));
        },
      }),
    );

    router.put(
      "/:key",
      createRawRoute(x, {
        auth: "dashboard",
        schemas: {
          params: secretParamsSchema,
          query: emptyRouteSchema,
          body: secretUpdateRequestSchema,
        },
        handler: (routeX, { params, body }, _req, res) => {
          const secret = xSecretService(routeX).set(routeX, {
            key: params.key,
            value: body.value,
          });
          res.json({ key: secret.key, value: secret.value });
        },
      }),
    );

    router.delete(
      "/:key",
      createRawRoute(x, {
        auth: "dashboard",
        schemas: {
          params: secretParamsSchema,
          query: emptyRouteSchema,
          body: unknownRouteSchema,
        },
        handler: (routeX, { params }, _req, res) => {
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
      }),
    );

    return router;
  }
}
