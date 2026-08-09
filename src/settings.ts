/**
 * Settings resolution with cascading overrides.
 * 
 * Resolution order (later wins):
 *   Global (config.settings) → Channel (config.channels[name].settings) → Session (config.sessions[key])
 */

import type { ResolvedSettings, Settings, VitoConfig } from "./types.js";

/** Default settings when nothing is specified */
const DEFAULTS: ResolvedSettings = {
  streamMode: "stream",
  traceMessageUpdates: false,
};

export function getDefaultSettings(): ResolvedSettings {
  return structuredClone(DEFAULTS);
}

/**
 * Deep merge two Settings objects. Later values win.
 * Merges nested settings objects deeply where needed; other fields are replaced.
 */
function mergeSettings(base: Settings, override: Settings): Settings {
  const result: Settings = { ...base, ...override };

  if (override["pi-coding-agent"] !== undefined) {
    result["pi-coding-agent"] = {
      ...base["pi-coding-agent"],
      ...override["pi-coding-agent"],
    };
  }
  if (override.memory !== undefined) {
    result.memory = {
      ...base.memory,
      ...override.memory,
    };
  }

  return result;
}

/**
 * Get effective settings for a given channel and session.
 * Cascades: Global → Channel → Session
 * 
 * @param config - Full app config
 * @param channelName - Channel name (e.g., "telegram", "discord", "dashboard")
 * @param sessionKey - Full session key (e.g., "telegram:123456789")
 * @returns Fully resolved settings with all defaults filled in
 */
export function getEffectiveSettings(
  config: VitoConfig,
  channelName: string,
  sessionKey: string
): ResolvedSettings {
  // Start with defaults
  let settings: Settings = { ...DEFAULTS };

  // Layer 1: Global settings
  if (config.settings) {
    settings = mergeSettings(settings, config.settings);
  }

  // Layer 2: Channel settings
  const channelConfig = config.channels?.[channelName];
  if (channelConfig?.settings) {
    settings = mergeSettings(settings, channelConfig.settings);
  }

  // Layer 3: Session settings
  const sessionSettings = config.sessions?.[sessionKey];
  if (sessionSettings) {
    settings = mergeSettings(settings, sessionSettings);
  }

  // Return with guaranteed required fields
  return {
    streamMode: settings.streamMode || DEFAULTS.streamMode,
    customInstructions: settings.customInstructions,
    requireMention: settings.requireMention,
    traceMessageUpdates: settings.traceMessageUpdates ?? false,
    timezone: settings.timezone,
    "pi-coding-agent": settings["pi-coding-agent"],
    memory: settings.memory,
  };
}

/**
 * Get stream mode from effective settings.
 * Convenience wrapper.
 */
export function getEffectiveStreamMode(
  config: VitoConfig,
  channelName: string,
  sessionKey: string
): "stream" | "bundled" | "final" {
  return getEffectiveSettings(config, channelName, sessionKey).streamMode;
}
