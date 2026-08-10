import { resolveSettings } from "../../shared/settings-resolution.js";
import type { ResolvedSettings, VitoConfig } from "../../shared/schemas/vito-config.js";

const DEFAULT_SETTINGS: ResolvedSettings = {
  streamMode: "stream",
  traceMessageUpdates: false,
};

export function getDefaultSettings(): ResolvedSettings {
  return structuredClone(DEFAULT_SETTINGS);
}

export function getEffectiveSettings(
  config: VitoConfig,
  channelName?: string,
  sessionKey?: string,
): ResolvedSettings {
  return resolveSettings(config, DEFAULT_SETTINGS, channelName, sessionKey);
}
