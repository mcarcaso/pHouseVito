import express from "express";
import type { Router } from "express";
import type { Context } from "../context/Context.js";
import { xAppPreferenceStore, xDashboardUser } from "../lib/x.js";
import {
  appPreferencesPatchSchema,
  appPreferencesResponseSchema,
} from "../shared/schemas/app-preferences.js";
import type { RouterService } from "./RouterService.js";
import { emptyRouteSchema, registerRoute, unknownRouteSchema } from "./register-route.js";

export class AppPreferenceRouterService implements RouterService {
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
      responseSchema: appPreferencesResponseSchema,
      handler: (routeX) => {
        const record = xAppPreferenceStore(routeX).get(routeX, xDashboardUser(routeX).id);
        return {
          preferences: record?.preferences ?? {},
          updatedAt: record?.updatedAt ?? null,
        };
      },
    });

    registerRoute(x, {
      router,
      method: "PATCH",
      path: "/",
      auth: "dashboard",
      schemas: {
        params: emptyRouteSchema,
        query: emptyRouteSchema,
        body: appPreferencesPatchSchema,
      },
      responseSchema: appPreferencesResponseSchema,
      handler: (routeX, { data: { body } }) => {
        const record = xAppPreferenceStore(routeX).patch(
          routeX,
          xDashboardUser(routeX).id,
          body,
          Date.now(),
        );
        return { preferences: record.preferences, updatedAt: record.updatedAt };
      },
    });

    return router;
  }
}
