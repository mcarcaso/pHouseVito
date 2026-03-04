/**
 * Settings resolution with cascading overrides.
 * 
 * Resolution order (later wins):
 *   Global (config.settings) → Channel (config.channels[name].settings) → Session (config.sessions[key])
 */

import type { ResolvedSettings, ResolvedContextSettings, Settings, VitoConfig } from "./types.js";

/** Default context settings */
const DEFAULT_CURRENT_CONTEXT: ResolvedContextSettings = {
  limit: 100,
  includeThoughts: true,
  includeTools: true,
  includeArchived: false,
  includeCompacted: false,
};

const DEFAULT_CROSS_CONTEXT: ResolvedContextSettings = {
  limit: 5,
  includeThoughts: false,
  includeTools: false,
  includeArchived: false,
  includeCompacted: false,
};

/** Default settings when nothing is specified */
const DEFAULTS: ResolvedSettings = {
  harness: "claude-code",
  streamMode: "stream",
  currentContext: DEFAULT_CURRENT_CONTEXT,
  crossContext: DEFAULT_CROSS_CONTEXT,
};

/**
 * Deep merge two Settings objects. Later values win.
 * Merges context objects deeply; other fields are replaced.
 */
function mergeSettings(base: Settings, override: Settings): Settings {
  const result: Settings = { ...base };

  if (override.harness !== undefined) {
    result.harness = override.harness;
  }
  if (override.streamMode !== undefined) {
    result.streamMode = override.streamMode;
  }
  if (override.currentContext !== undefined) {
    result.currentContext = { ...base.currentContext, ...override.currentContext };
  }
  if (override.crossContext !== undefined) {
    result.crossContext = { ...base.crossContext, ...override.crossContext };
  }
  if (override["pi-coding-agent"] !== undefined) {
    result["pi-coding-agent"] = { ...base["pi-coding-agent"], ...override["pi-coding-agent"] };
  }
  if (override["claude-code"] !== undefined) {
    result["claude-code"] = { ...base["claude-code"], ...override["claude-code"] };
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
 * @param config - Full Vito config
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
    currentContext: {
      limit: settings.currentContext?.limit ?? DEFAULT_CURRENT_CONTEXT.limit,
      includeThoughts: settings.currentContext?.includeThoughts ?? DEFAULT_CURRENT_CONTEXT.includeThoughts,
      includeTools: settings.currentContext?.includeTools ?? DEFAULT_CURRENT_CONTEXT.includeTools,
      includeArchived: settings.currentContext?.includeArchived ?? DEFAULT_CURRENT_CONTEXT.includeArchived,
      includeCompacted: settings.currentContext?.includeCompacted ?? DEFAULT_CURRENT_CONTEXT.includeCompacted,
    },
    crossContext: {
      limit: settings.crossContext?.limit ?? DEFAULT_CROSS_CONTEXT.limit,
      includeThoughts: settings.crossContext?.includeThoughts ?? DEFAULT_CROSS_CONTEXT.includeThoughts,
      includeTools: settings.crossContext?.includeTools ?? DEFAULT_CROSS_CONTEXT.includeTools,
      includeArchived: settings.crossContext?.includeArchived ?? DEFAULT_CROSS_CONTEXT.includeArchived,
      includeCompacted: settings.crossContext?.includeCompacted ?? DEFAULT_CROSS_CONTEXT.includeCompacted,
    },
    requireMention: settings.requireMention,
    traceMessageUpdates: settings.traceMessageUpdates ?? false,
    "pi-coding-agent": settings["pi-coding-agent"],
    "claude-code": settings["claude-code"],
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
