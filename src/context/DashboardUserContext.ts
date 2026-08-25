import type { Context } from "./Context.js";
import { ObjectContext } from "./ObjectContext.js";

export interface DashboardUser {
  kind: "dashboard-user";
  id: "owner";
}

const dashboardDependencyKeys = [
  "db",
  "embeddingDb",
  "embeddingStore",
  "embeddingService",
  "driveStore",
  "appStore",
  "attachmentStore",
  "userDir",
  "projectDir",
  "skillsDir",
  "systemSkillsDir",
  "logsDir",
  "secretsPath",
  "piAuthPath",
  "piSessionsDir",
  "driveDir",
  "appsDir",
  "attachmentsDir",
  "vitoService",
  "voiceService",
  "quickCommandService",
  "orchestratorService",
  "appProcessService",
  "dashboardAuthService",
  "channelRegistryService",
  "dashboardChatService",
  "providerService",
  "fileService",
  "cronService",
  "memoryService",
  "secretService",
  "serverLifecycleService",
  "piSessionStore",
  "sessionStore",
  "skillStore",
  "messageStore",
  "voiceTaskStore",
  "quickCommandStore",
  "traceStore",
  "traceEventStore",
] as const;

/**
 * Creates the restricted context used by an authenticated dashboard request.
 * Dependencies are explicitly exposed rather than inherited from RootContext.
 */
export function DashboardUserContext(rootX: Context): Context {
  const factories: Record<string, (x: Context) => unknown> = {
    dashboardUser: () => ({ kind: "dashboard-user", id: "owner" }) satisfies DashboardUser,
  };
  for (const key of dashboardDependencyKeys) {
    factories[key] = () => rootX.get(key);
  }
  return new ObjectContext(factories);
}
