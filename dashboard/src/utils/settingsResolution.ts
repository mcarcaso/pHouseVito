/**
 * Client-side settings cascade resolution.
 * Mirrors src/settings.ts logic for the dashboard UI.
 */

export interface Settings {
  harness?: string;
  streamMode?: 'stream' | 'bundled' | 'final';
  memory?: {
    currentSessionLimit?: number;
    crossSessionLimit?: number;
  };
  'pi-coding-agent'?: {
    model?: { provider: string; name: string };
    thinkingLevel?: 'off' | 'low' | 'medium' | 'high';
  };
  'claude-code'?: {
    model?: string;
    cwd?: string;
    permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
    allowedTools?: string[];
  };
}

export interface ResolvedSettings {
  harness: string;
  streamMode: 'stream' | 'bundled' | 'final';
  memory: {
    currentSessionLimit: number;
    crossSessionLimit: number;
  };
  'pi-coding-agent'?: Settings['pi-coding-agent'];
  'claude-code'?: Settings['claude-code'];
}

export interface VitoConfig {
  settings: Settings;
  harnesses: {
    'pi-coding-agent'?: {
      model: { provider: string; name: string };
      thinkingLevel?: string;
    };
    'claude-code'?: {
      model?: string;
      permissionMode?: string;
      allowedTools?: string[];
    };
  };
  memory: {
    compactionThreshold: number;
    compactionPercent?: number;
    includeToolsInCurrentSession?: boolean;
    includeToolsInCrossSession?: boolean;
    showArchivedInCrossSession?: boolean;
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
  requireMention?: boolean;
  [key: string]: any;
}

const DEFAULTS: ResolvedSettings = {
  harness: 'claude-code',
  streamMode: 'stream',
  memory: {
    currentSessionLimit: 100,
    crossSessionLimit: 5,
  },
};

/** Deep merge two Settings objects. Later values win. */
function mergeSettings(base: Settings, override: Settings): Settings {
  const result: Settings = { ...base };

  if (override.harness !== undefined) result.harness = override.harness;
  if (override.streamMode !== undefined) result.streamMode = override.streamMode;
  if (override.memory !== undefined) {
    result.memory = { ...base.memory, ...override.memory };
  }
  if (override['pi-coding-agent'] !== undefined) {
    result['pi-coding-agent'] = { ...base['pi-coding-agent'], ...override['pi-coding-agent'] };
  }
  if (override['claude-code'] !== undefined) {
    result['claude-code'] = { ...base['claude-code'], ...override['claude-code'] };
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
  let settings: Settings = { ...DEFAULTS };

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
    harness: settings.harness || DEFAULTS.harness,
    streamMode: settings.streamMode || DEFAULTS.streamMode,
    memory: {
      currentSessionLimit: settings.memory?.currentSessionLimit ?? DEFAULTS.memory.currentSessionLimit,
      crossSessionLimit: settings.memory?.crossSessionLimit ?? DEFAULTS.memory.crossSessionLimit,
    },
    'pi-coding-agent': settings['pi-coding-agent'],
    'claude-code': settings['claude-code'],
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
  const defaultVal = getNestedValue(DEFAULTS, field);
  return { value: defaultVal, source: 'default' };
}

/** Get a nested value from an object using dot notation (e.g., "memory.currentSessionLimit") */
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
  { key: 'memory.currentSessionLimit', label: 'Current Session Limit', type: 'number' as const },
  { key: 'memory.crossSessionLimit', label: 'Cross Session Limit', type: 'number' as const },
] as const;
