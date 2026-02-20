/**
 * Client-side settings cascade resolution.
 * Mirrors src/settings.ts logic for the dashboard UI.
 */

export interface ContextSettings {
  limit?: number;
  includeThoughts?: boolean;
  includeTools?: boolean;
  includeArchived?: boolean;
  includeCompacted?: boolean;
}

export interface ResolvedContextSettings {
  limit: number;
  includeThoughts: boolean;
  includeTools: boolean;
  includeArchived: boolean;
  includeCompacted: boolean;
}

export interface Settings {
  harness?: string;
  streamMode?: 'stream' | 'bundled' | 'final';
  currentContext?: ContextSettings;
  crossContext?: ContextSettings;
  requireMention?: boolean;
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
  currentContext: ResolvedContextSettings;
  crossContext: ResolvedContextSettings;
  requireMention?: boolean;
  'pi-coding-agent'?: Settings['pi-coding-agent'];
  'claude-code'?: Settings['claude-code'];
}

export interface VitoConfig {
  bot?: {
    name: string;  // e.g., "Vito" — @mentions get normalized to @{name}
  };
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
  compaction: {
    threshold: number;
    percent?: number;
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

const DEFAULTS: ResolvedSettings = {
  harness: 'claude-code',
  streamMode: 'stream',
  currentContext: DEFAULT_CURRENT_CONTEXT,
  crossContext: DEFAULT_CROSS_CONTEXT,
};

/** Deep merge two Settings objects. Later values win. */
function mergeSettings(base: Settings, override: Settings): Settings {
  const result: Settings = { ...base };

  if (override.harness !== undefined) result.harness = override.harness;
  if (override.streamMode !== undefined) result.streamMode = override.streamMode;
  if (override.currentContext !== undefined) {
    result.currentContext = { ...base.currentContext, ...override.currentContext };
  }
  if (override.crossContext !== undefined) {
    result.crossContext = { ...base.crossContext, ...override.crossContext };
  }
  if (override['pi-coding-agent'] !== undefined) {
    result['pi-coding-agent'] = { ...base['pi-coding-agent'], ...override['pi-coding-agent'] };
  }
  if (override['claude-code'] !== undefined) {
    result['claude-code'] = { ...base['claude-code'], ...override['claude-code'] };
  }
  if (override.requireMention !== undefined) {
    result.requireMention = override.requireMention;
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

/** Get a nested value from an object using dot notation (e.g., "currentContext.limit") */
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
  // Current context settings
  { key: 'currentContext.limit', label: 'Current: Num Messages', type: 'number' as const },
  { key: 'currentContext.includeThoughts', label: 'Current: Thoughts', type: 'boolean' as const },
  { key: 'currentContext.includeTools', label: 'Current: Tools', type: 'boolean' as const },
  { key: 'currentContext.includeArchived', label: 'Current: Archived', type: 'boolean' as const },
  { key: 'currentContext.includeCompacted', label: 'Current: Compacted', type: 'boolean' as const },
  // Cross context settings
  { key: 'crossContext.limit', label: 'Cross: Num Messages', type: 'number' as const },
  { key: 'crossContext.includeThoughts', label: 'Cross: Thoughts', type: 'boolean' as const },
  { key: 'crossContext.includeTools', label: 'Cross: Tools', type: 'boolean' as const },
  { key: 'crossContext.includeArchived', label: 'Cross: Archived', type: 'boolean' as const },
  { key: 'crossContext.includeCompacted', label: 'Cross: Compacted', type: 'boolean' as const },
] as const;
