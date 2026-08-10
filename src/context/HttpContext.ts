import type { Context } from "./Context.js";
import { ObjectContext } from "./ObjectContext.js";

function explicitContext(rootX: Context, keys: readonly string[]): Context {
  const factories: Record<string, (x: Context) => unknown> = {};
  for (const key of keys) factories[key] = () => rootX.get(key);
  return new ObjectContext(factories);
}

/** Dependencies available to unauthenticated dashboard setup and health routes. */
export function PublicHttpContext(rootX: Context): Context {
  return explicitContext(rootX, [
    "dashboardAuthService",
    "secretService",
    "secretsPath",
    "piAuthPath",
    "serverLifecycleService",
  ]);
}

/** Dependencies available while serving explicitly public Drive content. */
export function PublicDriveContext(rootX: Context): Context {
  return explicitContext(rootX, ["driveStore", "driveDir"]);
}

/** Dependencies available to the existing unauthenticated provider OAuth flow. */
export function ProviderAuthContext(rootX: Context): Context {
  return explicitContext(rootX, ["providerService", "secretService", "secretsPath", "piAuthPath"]);
}

/** Dependencies available to the independently authenticated Ask API. */
export function AskApiContext(rootX: Context): Context {
  return explicitContext(rootX, ["askApiService", "secretService", "secretsPath"]);
}

/** Dependencies available while resolving dashboard authentication. */
export function DashboardAuthContext(rootX: Context): Context {
  return explicitContext(rootX, [
    "dashboardAuthService",
    "secretService",
    "secretsPath",
    "piAuthPath",
  ]);
}
