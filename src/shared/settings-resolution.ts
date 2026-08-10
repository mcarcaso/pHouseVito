import type {
  ResolvedSettings,
  Settings,
  VitoConfig,
} from "./schemas/vito-config.js";

function mergeSettings(base: Settings, override: Settings): Settings {
  const result: Settings = { ...base, ...override };
  if (override["pi-coding-agent"] !== undefined) {
    result["pi-coding-agent"] = {
      ...base["pi-coding-agent"],
      ...override["pi-coding-agent"],
    };
  }
  if (override.memory !== undefined) {
    result.memory = { ...base.memory, ...override.memory };
  }
  return result;
}

export function resolveSettings(
  config: VitoConfig,
  defaults: ResolvedSettings,
  channelName?: string,
  sessionKey?: string,
): ResolvedSettings {
  let settings: Settings = { ...defaults };
  settings = mergeSettings(settings, config.settings);

  const channelSettings = channelName ? config.channels[channelName]?.settings : undefined;
  if (channelSettings) settings = mergeSettings(settings, channelSettings);

  const sessionSettings = sessionKey ? config.sessions?.[sessionKey] : undefined;
  if (sessionSettings) settings = mergeSettings(settings, sessionSettings);

  return {
    streamMode: settings.streamMode || defaults.streamMode,
    customInstructions: settings.customInstructions,
    requireMention: settings.requireMention,
    traceMessageUpdates: settings.traceMessageUpdates ?? false,
    timezone: settings.timezone,
    "pi-coding-agent": settings["pi-coding-agent"],
    memory: settings.memory,
  };
}
