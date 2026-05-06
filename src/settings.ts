/**
 * Settings resolution with cascading overrides.
 * 
 * Resolution order (later wins):
 *   Global (config.settings) → Channel (config.channels[name].settings) → Session (config.sessions[key])
 */

import type { ResolvedSettings, Settings, VitoConfig } from "./types.js";

/** Default settings when nothing is specified */
const DEFAULTS: ResolvedSettings = {
  harness: "pi-coding-agent",
  streamMode: "stream",
};

/**
 * Deep merge two Settings objects. Later values win.
 * Merges nested settings objects deeply where needed; other fields are replaced.
 */
function mergeSettings(base: Settings, override: Settings): Settings {
  const result: Settings = { ...base };

  if (override.harness !== undefined) {
    result.harness = override.harness;
  }
  if (override.streamMode !== undefined) {
    result.streamMode = override.streamMode;
  }
  if (override.customInstructions !== undefined) {
    result.customInstructions = override.customInstructions;
  }
  if (override["pi-coding-agent"] !== undefined) {
    result["pi-coding-agent"] = { ...base["pi-coding-agent"], ...override["pi-coding-agent"] };
  }
  if (override.requireMention !== undefined) {
    result.requireMention = override.requireMention;
  }
  if (override.traceMessageUpdates !== undefined) {
    result.traceMessageUpdates = override.traceMessageUpdates;
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
    harness: settings.harness || DEFAULTS.harness,
    streamMode: settings.streamMode || DEFAULTS.streamMode,
    customInstructions: settings.customInstructions,
    requireMention: settings.requireMention,
    traceMessageUpdates: settings.traceMessageUpdates ?? false,
    "pi-coding-agent": settings["pi-coding-agent"],
  };
}

/**
 * Get harness name from effective settings.
 * Convenience wrapper.
 */
export function getEffectiveHarness(
  config: VitoConfig,
  channelName: string,
  sessionKey: string
): string {
  return getEffectiveSettings(config, channelName, sessionKey).harness;
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
