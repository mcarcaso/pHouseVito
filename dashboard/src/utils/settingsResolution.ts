/**
 * Client-side settings cascade resolution.
 * Mirrors src/settings.ts logic for the dashboard UI. Default values are
 * loaded from the backend at startup via loadDefaults() and read here through
 * getDefaults() — no constants are duplicated.
 */

import { getDefaults } from './defaults';

export interface Settings {
  harness?: string;
  streamMode?: 'stream' | 'bundled' | 'final';
  customInstructions?: string;
  requireMention?: boolean;
  traceMessageUpdates?: boolean;
  timezone?: string;
  'pi-coding-agent'?: {
    model?: { provider: string; name: string };
    openRouterProvider?: string;
    thinkingLevel?: 'off' | 'low' | 'medium' | 'high';
  };
  memory?: {
    chunkContextualizerModel?: { provider: string; name: string };
  };
}

export interface ResolvedSettings {
  harness: string;
  streamMode: 'stream' | 'bundled' | 'final';
  customInstructions?: string;
  requireMention?: boolean;
  traceMessageUpdates?: boolean;
  'pi-coding-agent'?: Settings['pi-coding-agent'];
}

export interface VitoConfig {
  bot?: {
    name: string;  // @mentions get normalized to @{name}
  };
  settings: Settings;
  harnesses: {
    'pi-coding-agent'?: {
      model: { provider: string; name: string };
      openRouterProvider?: string;
      thinkingLevel?: string;
    };
    'claude-code'?: {
      model?: { provider: string; name: string };
      permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
      binaryPath?: string;
    };
  };
  channels: Record<string, ChannelConfig>;
  sessions?: Record<string, Settings>;
  cron: { jobs: any[] };
}

export interface ChannelConfig {
  enabled: boolean;
  settings?: Settings;
  allowedChatIds?: string[];
  allowedGuildIds?: string[];
  allowedChannelIds?: string[];
  [key: string]: any;
}

/** Deep merge two Settings objects. Later values win. */
function mergeSettings(base: Settings, override: Settings): Settings {
  const result: Settings = { ...base };

  if (override.harness !== undefined) result.harness = override.harness;
  if (override.streamMode !== undefined) result.streamMode = override.streamMode;
  if (override.customInstructions !== undefined) result.customInstructions = override.customInstructions;
  if (override['pi-coding-agent'] !== undefined) {
    result['pi-coding-agent'] = { ...base['pi-coding-agent'], ...override['pi-coding-agent'] };
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
 * Cascades: Global -> Channel -> Session
 */
export function getEffectiveSettings(
  config: VitoConfig,
  channelName?: string,
  sessionKey?: string
): ResolvedSettings {
  const defaults = getDefaults();
  let settings: Settings = { ...defaults };

  // Layer 1: Global
  if (config.settings) {
    settings = mergeSettings(settings, config.settings);
  }

  // Layer 2: Channel
  if (channelName) {
    const channelConfig = config.channels?.[channelName];
    if (channelConfig?.settings) {
      settings = mergeSettings(settings, channelConfig.settings);
    }
  }

  // Layer 3: Session
  if (sessionKey) {
    const sessionSettings = config.sessions?.[sessionKey];
    if (sessionSettings) {
      settings = mergeSettings(settings, sessionSettings);
    }
  }

  return {
    harness: settings.harness || defaults.harness,
    streamMode: settings.streamMode || defaults.streamMode,
    customInstructions: settings.customInstructions,
    requireMention: settings.requireMention,
    traceMessageUpdates: settings.traceMessageUpdates ?? false,
    'pi-coding-agent': settings['pi-coding-agent'],
  };
}

/** Which level is a setting value coming from? */
export type InheritSource = 'default' | 'global' | 'channel' | 'session';

/**
 * Determine where a field's value is being inherited from.
 * Used by SettingRow to show "from Global", "from Channel", etc.
 */
export function getInheritSource(
  field: string,
  config: VitoConfig,
  channelName?: string,
  sessionKey?: string
): { value: any; source: InheritSource } {
  // Check session level
  if (sessionKey) {
    const sessionVal = getNestedValue(config.sessions?.[sessionKey], field);
    if (sessionVal !== undefined) return { value: sessionVal, source: 'session' };
  }

  // Check channel level
  if (channelName) {
    const channelVal = getNestedValue(config.channels?.[channelName]?.settings, field);
    if (channelVal !== undefined) return { value: channelVal, source: 'channel' };
  }

  // Check global level
  const globalVal = getNestedValue(config.settings, field);
  if (globalVal !== undefined) return { value: globalVal, source: 'global' };

  // Fall back to defaults
  const defaultVal = getNestedValue(getDefaults(), field);
  return { value: defaultVal, source: 'default' };
}

/** Get a nested value from an object using dot notation (e.g., "pi-coding-agent.model") */
function getNestedValue(obj: any, path: string): any {
  if (!obj) return undefined;
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current === undefined || current === null) return undefined;
    current = current[part];
  }
  return current;
}

/** Cascading field definitions — what cascades through the hierarchy */
export const CASCADING_FIELDS = [
  { key: 'harness', label: 'Harness', type: 'select' as const },
  { key: 'streamMode', label: 'Stream Mode', type: 'select' as const },
  { key: 'requireMention', label: 'Require @Mention', type: 'boolean' as const },
  { key: 'traceMessageUpdates', label: 'Trace Message Updates', type: 'boolean' as const },
  { key: 'customInstructions', label: 'Custom Instructions', type: 'text' as const },
  { key: 'pi-coding-agent.model', label: 'Pi Model', type: 'select' as const },
  { key: 'pi-coding-agent.thinkingLevel', label: 'Thinking Level', type: 'select' as const },
] as const;

/** Count only settings that are still live in the v2 UI. Ignores stale legacy keys left in config. */
export function countActiveSettingOverrides(settings?: Settings): number {
  if (!settings) return 0;
  return CASCADING_FIELDS.reduce((count, field) => (
    getNestedValue(settings, field.key) !== undefined ? count + 1 : count
  ), 0);
}
