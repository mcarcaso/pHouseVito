import express from "express";
import type { Router } from "express";
import { z } from "zod";
import type { Context } from "../../context/Context.js";
import type { RouterService } from "../RouterService.js";
import { xSecretService } from "../../lib/x.js";
import { SystemSecretDeletionError } from "../../services/secrets/SecretService.js";
import {
  emptyRouteSchema,
  unknownRouteSchema,
  validatedRoute,
} from "../route.js";

const secretParamsSchema = z.object({
  key: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
}).strict();

const secretBodySchema = z.object({
  value: z.string(),
}).strict();

export class SecretRouterService implements RouterService {
  async createRouter(x: Context): Promise<Router> {
    const router = express.Router();

    router.get("/", validatedRoute(
      x,
      {
        params: emptyRouteSchema,
        query: emptyRouteSchema,
        body: unknownRouteSchema,
      },
      (routeX, _input, _req, res) => {
        res.json(xSecretService(routeX).list(routeX));
      }
    ));

    router.put("/:key", validatedRoute(
      x,
      {
        params: secretParamsSchema,
        query: emptyRouteSchema,
        body: secretBodySchema,
      },
      (routeX, { params, body }, _req, res) => {
        const secret = xSecretService(routeX).set(routeX, {
          key: params.key,
          value: body.value,
        });
        res.json({ key: secret.key, value: secret.value });
      }
    ));

    router.delete("/:key", validatedRoute(
      x,
      {
        params: secretParamsSchema,
        query: emptyRouteSchema,
        body: unknownRouteSchema,
      },
      (routeX, { params }, _req, res) => {
        try {
          xSecretService(routeX).delete(routeX, { key: params.key });
          res.status(204).end();
        } catch (error) {
          if (!(error instanceof SystemSecretDeletionError)) throw error;
          res.status(400).json({
            error: "Cannot delete a system key — clear its value instead",
          });
        }
      }
    ));

    return router;
  }
}
