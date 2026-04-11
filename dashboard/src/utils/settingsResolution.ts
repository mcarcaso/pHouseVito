/**
 * Client-side settings cascade resolution.
 * Mirrors src/settings.ts logic for the dashboard UI. Default values are
 * loaded from the backend at startup via loadDefaults() and read here through
 * getDefaults() — no constants are duplicated.
 */

import { getDefaults } from './defaults';

export interface ContextSettings {
  limit?: number;
  includeThoughts?: boolean;
  includeTools?: boolean;
  includeArchived?: boolean;
  /** Max number of sessions to include for cross-session context (cross-session only) */
  maxSessions?: number;
}

export interface ResolvedContextSettings {
  limit: number;
  includeThoughts: boolean;
  includeTools: boolean;
  includeArchived: boolean;
  /** Max sessions to include for cross-session (only used by crossContext) */
  maxSessions: number;
}

export interface MemorySettings {
  recalledMemoryLimit?: number;
  recalledMemoryThreshold?: number;
  profileUpdateContext?: number;
}

export interface ResolvedMemorySettings {
  recalledMemoryLimit: number;
  recalledMemoryThreshold: number;
  profileUpdateContext: number;
}

export interface ModelChoice {
  provider: string;
  name: string;
  description: string;
}

/** Per-field auto-selection flags. Mirror of backend AutoFlags. */
export interface AutoFlags {
  currentContext?: {
    limit?: boolean;
    includeThoughts?: boolean;
    includeTools?: boolean;
  };
  memory?: {
    recalledMemoryLimit?: boolean;
  };
  'pi-coding-agent'?: {
    model?: boolean;
    modelChoices?: ModelChoice[];
  };
  classifierModel?: { provider: string; name: string };
}

export interface ResolvedAutoFlags {
  currentContext: {
    limit: boolean;
    includeThoughts: boolean;
    includeTools: boolean;
  };
  memory: {
    recalledMemoryLimit: boolean;
  };
  'pi-coding-agent': {
    model: boolean;
    modelChoices: ModelChoice[];
  };
  classifierModel: { provider: string; name: string };
}


export interface Settings {
  harness?: string;
  streamMode?: 'stream' | 'bundled' | 'final';
  customInstructions?: string;
  currentContext?: ContextSettings;
  crossContext?: ContextSettings;
  memory?: MemorySettings;
  requireMention?: boolean;
  traceMessageUpdates?: boolean;
  timezone?: string;
  'pi-coding-agent'?: {
    model?: { provider: string; name: string };
    thinkingLevel?: 'off' | 'low' | 'medium' | 'high';
  };
  auto?: AutoFlags;
}

export interface ResolvedSettings {
  harness: string;
  streamMode: 'stream' | 'bundled' | 'final';
  customInstructions?: string;
  currentContext: ResolvedContextSettings;
  crossContext: ResolvedContextSettings;
  memory: ResolvedMemorySettings;
  requireMention?: boolean;
  traceMessageUpdates?: boolean;
  'pi-coding-agent'?: Settings['pi-coding-agent'];
  auto: ResolvedAutoFlags;
}

export interface VitoConfig {
  bot?: {
    name: string;  // @mentions get normalized to @{name}
  };
  settings: Settings;
  harnesses: {
    'pi-coding-agent'?: {
      model: { provider: string; name: string };
      thinkingLevel?: string;
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
  if (override.currentContext !== undefined) {
    result.currentContext = { ...base.currentContext, ...override.currentContext };
  }
  if (override.crossContext !== undefined) {
    result.crossContext = { ...base.crossContext, ...override.crossContext };
  }
  if (override.memory !== undefined) {
    result.memory = { ...base.memory, ...override.memory };
  }
  if (override['pi-coding-agent'] !== undefined) {
    result['pi-coding-agent'] = { ...base['pi-coding-agent'], ...override['pi-coding-agent'] };
  }
  if (override.requireMention !== undefined) {
    result.requireMention = override.requireMention;
  }
  if (override.traceMessageUpdates !== undefined) {
    result.traceMessageUpdates = override.traceMessageUpdates;
  }
  if (override.auto !== undefined) {
    result.auto = {
      ...base.auto,
      ...override.auto,
      currentContext: { ...base.auto?.currentContext, ...override.auto?.currentContext },
      memory: { ...base.auto?.memory, ...override.auto?.memory },
      'pi-coding-agent': { ...base.auto?.['pi-coding-agent'], ...override.auto?.['pi-coding-agent'] },
    };
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
    currentContext: {
      limit: settings.currentContext?.limit ?? defaults.currentContext.limit,
      includeThoughts: settings.currentContext?.includeThoughts ?? defaults.currentContext.includeThoughts,
      includeTools: settings.currentContext?.includeTools ?? defaults.currentContext.includeTools,
      includeArchived: settings.currentContext?.includeArchived ?? defaults.currentContext.includeArchived,
      maxSessions: defaults.currentContext.maxSessions, // Not used for current context
    },
    crossContext: {
      limit: settings.crossContext?.limit ?? defaults.crossContext.limit,
      includeThoughts: settings.crossContext?.includeThoughts ?? defaults.crossContext.includeThoughts,
      includeTools: settings.crossContext?.includeTools ?? defaults.crossContext.includeTools,
      includeArchived: settings.crossContext?.includeArchived ?? defaults.crossContext.includeArchived,
      maxSessions: settings.crossContext?.maxSessions ?? defaults.crossContext.maxSessions,
    },
    memory: {
      recalledMemoryLimit: settings.memory?.recalledMemoryLimit ?? defaults.memory.recalledMemoryLimit,
      recalledMemoryThreshold: settings.memory?.recalledMemoryThreshold ?? defaults.memory.recalledMemoryThreshold,
      profileUpdateContext: settings.memory?.profileUpdateContext ?? defaults.memory.profileUpdateContext,
    },
    requireMention: settings.requireMention,
    traceMessageUpdates: settings.traceMessageUpdates ?? false,
    'pi-coding-agent': settings['pi-coding-agent'],
    auto: {
      currentContext: {
        limit: settings.auto?.currentContext?.limit ?? defaults.auto.currentContext.limit,
        includeThoughts: settings.auto?.currentContext?.includeThoughts ?? defaults.auto.currentContext.includeThoughts,
        includeTools: settings.auto?.currentContext?.includeTools ?? defaults.auto.currentContext.includeTools,
      },
      memory: {
        recalledMemoryLimit: settings.auto?.memory?.recalledMemoryLimit ?? defaults.auto.memory.recalledMemoryLimit,
      },
      'pi-coding-agent': {
        model: settings.auto?.['pi-coding-agent']?.model ?? defaults.auto['pi-coding-agent'].model,
        modelChoices: (settings.auto?.['pi-coding-agent']?.modelChoices && settings.auto['pi-coding-agent'].modelChoices.length > 0)
          ? settings.auto['pi-coding-agent'].modelChoices
          : defaults.auto['pi-coding-agent'].modelChoices,
      },
      classifierModel: (settings.auto?.classifierModel?.provider && settings.auto.classifierModel.name)
        ? settings.auto.classifierModel
        : defaults.auto.classifierModel,
    },
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
  { key: 'traceMessageUpdates', label: 'Trace Message Updates', type: 'boolean' as const },
  // Cross context settings
  { key: 'crossContext.limit', label: 'Cross: Num Messages', type: 'number' as const },
  { key: 'crossContext.maxSessions', label: 'Cross: Max Sessions', type: 'number' as const },
  { key: 'crossContext.includeThoughts', label: 'Cross: Thoughts', type: 'boolean' as const },
  { key: 'crossContext.includeTools', label: 'Cross: Tools', type: 'boolean' as const },
  { key: 'crossContext.includeArchived', label: 'Cross: Archived', type: 'boolean' as const },
  // Memory settings
  { key: 'memory.recalledMemoryLimit', label: 'Recalled Memory Limit', type: 'number' as const },
  { key: 'memory.recalledMemoryThreshold', label: 'Recalled Memory Threshold', type: 'number' as const },
  { key: 'memory.profileUpdateContext', label: 'Profile Update Context', type: 'number' as const },
  // Per-field auto-selection flags
  { key: 'auto.currentContext.limit', label: 'Auto: Current Num Messages', type: 'boolean' as const },
  { key: 'auto.currentContext.includeThoughts', label: 'Auto: Current Thoughts', type: 'boolean' as const },
  { key: 'auto.currentContext.includeTools', label: 'Auto: Current Tools', type: 'boolean' as const },
  { key: 'auto.memory.recalledMemoryLimit', label: 'Auto: Recalled Memory Limit', type: 'boolean' as const },
  { key: 'auto.pi-coding-agent.model', label: 'Auto: Pi Model', type: 'boolean' as const },
] as const;
