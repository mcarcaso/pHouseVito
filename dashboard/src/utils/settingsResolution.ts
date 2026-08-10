/**
 * Client-side settings cascade resolution.
 * Mirrors src/settings.ts logic for the dashboard UI. Default values are
 * loaded from the backend at startup via loadDefaults() and read here through
 * getDefaults() — no constants are duplicated.
 */

import type {
  ResolvedSettings,
  Settings,
  VitoConfig,
} from "../../../src/shared/schemas/vito-config";
import { resolveSettings } from "../../../src/shared/settings-resolution";
import { getDefaults } from "./defaults";

export type {
  ChannelConfig,
  ResolvedSettings,
  Settings,
  VitoConfig,
} from "../../../src/shared/schemas/vito-config";

/**
 * Get effective settings for a given channel and session.
 * Cascades: Global -> Channel -> Session
 */
export function getEffectiveSettings(
  config: VitoConfig,
  channelName?: string,
  sessionKey?: string,
): ResolvedSettings {
  return resolveSettings(config, getDefaults(), channelName, sessionKey);
}

/** Which level is a setting value coming from? */
export type InheritSource = "default" | "global" | "channel" | "session";

/**
 * Determine where a field's value is being inherited from.
 * Used by SettingRow to show "from Global", "from Channel", etc.
 */
export function getInheritSource(
  field: string,
  config: VitoConfig,
  channelName?: string,
  sessionKey?: string,
): { value: unknown; source: InheritSource } {
  // Check session level
  if (sessionKey) {
    const sessionVal = getNestedValue(config.sessions?.[sessionKey], field);
    if (sessionVal !== undefined) return { value: sessionVal, source: "session" };
  }

  // Check channel level
  if (channelName) {
    const channelVal = getNestedValue(config.channels?.[channelName]?.settings, field);
    if (channelVal !== undefined) return { value: channelVal, source: "channel" };
  }

  // Check global level
  const globalVal = getNestedValue(config.settings, field);
  if (globalVal !== undefined) return { value: globalVal, source: "global" };

  // Fall back to defaults
  const defaultVal = getNestedValue(getDefaults(), field);
  return { value: defaultVal, source: "default" };
}

/** Get a nested value from an object using dot notation (e.g., "pi-coding-agent.model") */
function getNestedValue(value: unknown, path: string): unknown {
  let current = value;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = Reflect.get(current, part);
  }
  return current;
}

/** Cascading field definitions — what cascades through the hierarchy */
export const CASCADING_FIELDS = [
  { key: "streamMode", label: "Stream Mode", type: "select" as const },
  { key: "requireMention", label: "Require @Mention", type: "boolean" as const },
  { key: "traceMessageUpdates", label: "Trace Message Updates", type: "boolean" as const },
  { key: "customInstructions", label: "Custom Instructions", type: "text" as const },
  { key: "pi-coding-agent.model", label: "Pi Model", type: "select" as const },
  { key: "pi-coding-agent.openRouterProvider", label: "OpenRouter Route", type: "select" as const },
  { key: "pi-coding-agent.thinkingLevel", label: "Thinking Level", type: "select" as const },
] as const;

/** Count settings that are active in the current UI. */
export function countActiveSettingOverrides(settings?: Settings): number {
  if (!settings) return 0;
  return CASCADING_FIELDS.reduce(
    (count, field) => (getNestedValue(settings, field.key) !== undefined ? count + 1 : count),
    0,
  );
}
