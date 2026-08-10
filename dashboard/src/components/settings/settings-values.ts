import type { PiRuntimeConfig, Settings } from "../../../../src/shared/schemas/vito-config";

export const STREAM_MODE_OPTIONS = [
  { value: "stream", label: "Stream" },
  { value: "bundled", label: "Bundled" },
  { value: "final", label: "Final" },
] as const;

export const THINKING_LEVEL_OPTIONS = [
  { value: "off", label: "Off" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
] as const;

export const OPENROUTER_PROVIDER_OPTIONS = [
  { value: "", label: "Auto" },
  { value: "deepinfra", label: "DeepInfra" },
  { value: "groq", label: "Groq" },
  { value: "fireworks", label: "Fireworks" },
  { value: "together", label: "Together" },
  { value: "novita", label: "Novita" },
  { value: "siliconflow", label: "SiliconFlow" },
  { value: "hyperbolic", label: "Hyperbolic" },
  { value: "lambda", label: "Lambda" },
] as const;

export type BasicSettingsPath =
  "streamMode" | "requireMention" | "traceMessageUpdates" | "customInstructions";

export type SettingsUpdate =
  | { path: "streamMode"; value: NonNullable<Settings["streamMode"]> }
  | { path: "requireMention"; value: boolean }
  | { path: "traceMessageUpdates"; value: boolean }
  | { path: "customInstructions"; value: string }
  | { path: "pi-coding-agent.model"; value: PiRuntimeConfig["model"] }
  | {
      path: "pi-coding-agent.openRouterProvider";
      value: NonNullable<PiRuntimeConfig["openRouterProvider"]>;
    }
  | {
      path: "pi-coding-agent.thinkingLevel";
      value: NonNullable<PiRuntimeConfig["thinkingLevel"]>;
    };

export type SettingsPath = SettingsUpdate["path"];

export function setSettingsValue(settings: Settings, update: SettingsUpdate): Settings {
  switch (update.path) {
    case "streamMode":
      return { ...settings, streamMode: update.value };
    case "requireMention":
      return { ...settings, requireMention: update.value };
    case "traceMessageUpdates":
      return { ...settings, traceMessageUpdates: update.value };
    case "customInstructions":
      return { ...settings, customInstructions: update.value };
    case "pi-coding-agent.model":
      return {
        ...settings,
        "pi-coding-agent": { ...settings["pi-coding-agent"], model: update.value },
      };
    case "pi-coding-agent.openRouterProvider":
      return {
        ...settings,
        "pi-coding-agent": {
          ...settings["pi-coding-agent"],
          openRouterProvider: update.value,
        },
      };
    case "pi-coding-agent.thinkingLevel":
      return {
        ...settings,
        "pi-coding-agent": { ...settings["pi-coding-agent"], thinkingLevel: update.value },
      };
  }
}

export function removeSettingsValue(settings: Settings, path: SettingsPath): Settings {
  switch (path) {
    case "streamMode": {
      const { streamMode: _removed, ...remaining } = settings;
      return remaining;
    }
    case "requireMention": {
      const { requireMention: _removed, ...remaining } = settings;
      return remaining;
    }
    case "traceMessageUpdates": {
      const { traceMessageUpdates: _removed, ...remaining } = settings;
      return remaining;
    }
    case "customInstructions": {
      const { customInstructions: _removed, ...remaining } = settings;
      return remaining;
    }
    case "pi-coding-agent.model":
      return removePiValue(settings, "model");
    case "pi-coding-agent.openRouterProvider":
      return removePiValue(settings, "openRouterProvider");
    case "pi-coding-agent.thinkingLevel":
      return removePiValue(settings, "thinkingLevel");
  }
}

function removePiValue(
  settings: Settings,
  key: "model" | "openRouterProvider" | "thinkingLevel",
): Settings {
  const pi = settings["pi-coding-agent"];
  if (!pi) return settings;
  const remaining: Partial<PiRuntimeConfig> = { ...pi };
  delete remaining[key];
  if (Object.keys(remaining).length > 0) {
    return { ...settings, "pi-coding-agent": remaining };
  }
  const { "pi-coding-agent": _removed, ...withoutPi } = settings;
  return withoutPi;
}
