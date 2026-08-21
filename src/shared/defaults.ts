import type { ResolvedSettings } from "./schemas/vito-config.js";

/** Default timezone used when no global or job-specific timezone is configured. */
export const DEFAULT_TIMEZONE = "America/Toronto";

/** Browser-safe canonical settings defaults shared by runtime and dashboard. */
export const DEFAULT_SETTINGS: ResolvedSettings = {
  streamMode: "stream",
  traceMessageUpdates: false,
};
