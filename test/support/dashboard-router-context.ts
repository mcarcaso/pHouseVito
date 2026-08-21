import type { Context } from "../../src/context/Context.js";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import { authenticatedDashboardAuthService } from "./authenticated-dashboard-auth-service.js";

export function dashboardRouterContext(
  factories: Readonly<Record<string, (x: Context) => unknown>> = {},
  parent?: Context,
): Context {
  return new ObjectContext(
    {
      ...factories,
      dashboardAuthService: () => authenticatedDashboardAuthService,
    },
    parent,
  );
}
