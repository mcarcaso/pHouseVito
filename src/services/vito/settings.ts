import { DEFAULT_SETTINGS } from "../../shared/defaults.js";
import { resolveSettings } from "../../shared/settings-resolution.js";
import type { ResolvedSettings, VitoConfig } from "../../shared/schemas/vito-config.js";

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
