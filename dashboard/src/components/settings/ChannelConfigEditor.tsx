import { useState, useEffect, useRef } from 'react';
import type { ChannelConfig, VitoConfig, Settings } from '../../utils/settingsResolution';
import { getEffectiveSettings } from '../../utils/settingsResolution';
import SettingRow, { renderSegmented, renderNumberInput, renderToggle, renderTextarea } from './SettingRow';
import { ClassifierModelPicker } from './GlobalSettings';
import { channelConfigComponents, CHANNEL_ICONS } from './channels';
import {
  SHOW_LEGACY_CURRENT_CONTEXT,
  SHOW_LEGACY_CROSS_CONTEXT,
  SHOW_LEGACY_MEMORY_RECALL,
  SHOW_LEGACY_AUTO_CLASSIFIER,
} from '../../utils/featureFlags';

interface ChannelConfigEditorProps {
  name: string;
  channelConfig: ChannelConfig;
  config: VitoConfig;
  onSave: (updates: Partial<VitoConfig>) => Promise<void>;
}

const STREAM_MODES = [
  { value: 'stream', label: 'Stream' },
  { value: 'bundled', label: 'Bundled' },
  { value: 'final', label: 'Final' },
];

function setNestedValue(target: Record<string, any>, path: string, value: any) {
  const parts = path.split('.');
  let cursor: Record<string, any> = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    cursor[key] = { ...(cursor[key] || {}) };
    cursor = cursor[key];
  }
  cursor[parts[parts.length - 1]] = value;
}

function deleteNestedValue(target: Record<string, any>, path: string) {
  const parts = path.split('.');
  const stack: Array<{ parent: Record<string, any>; key: string }> = [];
  let cursor: Record<string, any> | undefined = target;

  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (!cursor?.[key] || typeof cursor[key] !== 'object') return;
    stack.push({ parent: cursor, key });
    cursor = cursor[key];
  }

  if (!cursor) return;
  delete cursor[parts[parts.length - 1]];

  for (let i = stack.length - 1; i >= 0; i--) {
    const { parent, key } = stack[i];
    if (parent[key] && typeof parent[key] === 'object' && Object.keys(parent[key]).length === 0) {
      delete parent[key];
    }
  }
}

export default function ChannelConfigEditor({ name, channelConfig, config, onSave }: ChannelConfigEditorProps) {
  const [expanded, setExpanded] = useState(false);
  const [newId, setNewId] = useState<Record<string, string>>({});
  const [needsRestart, setNeedsRestart] = useState(false);

  // Get the channel-specific config component (if one exists)
  const ChannelSpecificConfig = channelConfigComponents[name];

  // Get what the global settings resolve to (for showing inheritance)
  const globalResolved = getEffectiveSettings(config);
  const channelSettings = channelConfig.settings || {};

  const updateChannelField = async (key: string, value: any) => {
    const updatedChannel = { ...channelConfig, [key]: value };
    await onSave({ channels: { ...config.channels, [name]: updatedChannel } });
    if (key === 'enabled') setNeedsRestart(true);
  };

  const saveChannelSettings = async (newSettings: Settings) => {
    const updatedChannel = { ...channelConfig, settings: newSettings };
    await onSave({ channels: { ...config.channels, [name]: updatedChannel } });
  };

  const updateChannelSetting = async (field: string, value: any) => {
    const newSettings: Settings = structuredClone(channelSettings);
    setNestedValue(newSettings as any, field, value);
    await saveChannelSettings(newSettings);
  };

  const updateChannelSettingsBatch = async (entries: Array<{ field: string; value: any }>) => {
    const newSettings: Settings = structuredClone(channelSettings);
    for (const entry of entries) {
      setNestedValue(newSettings as any, entry.field, entry.value);
    }
    await saveChannelSettings(newSettings);
  };

  const resetChannelSetting = async (field: string) => {
    const newSettings: Settings = structuredClone(channelSettings);
    deleteNestedValue(newSettings as any, field);
    // Clean up: if settings is now empty, remove the key
    const updatedChannel = { ...channelConfig };
    if (Object.keys(newSettings).length === 0) {
      delete updatedChannel.settings;
    } else {
      updatedChannel.settings = newSettings;
    }
    await onSave({ channels: { ...config.channels, [name]: updatedChannel } });
  };

  const resetChannelSettingsBatch = async (fields: string[]) => {
    const newSettings: Settings = structuredClone(channelSettings);
    for (const field of fields) {
      deleteNestedValue(newSettings as any, field);
    }
    const updatedChannel = { ...channelConfig };
    if (Object.keys(newSettings).length === 0) {
      delete updatedChannel.settings;
    } else {
      updatedChannel.settings = newSettings;
    }
    await onSave({ channels: { ...config.channels, [name]: updatedChannel } });
  };

  const addId = (field: string) => {
    const inputKey = `${name}-${field}`;
    const val = newId[inputKey]?.trim();
    if (!val) return;
    const current: string[] = (channelConfig as any)[field] || [];
    if (current.includes(val)) return;
    updateChannelField(field, [...current, val]);
    setNewId({ ...newId, [inputKey]: '' });
  };

  const removeId = (field: string, id: string) => {
    const current: string[] = (channelConfig as any)[field] || [];
    updateChannelField(field, current.filter((c: string) => c !== id));
  };

  // Shared ID list renderer — passed to channel-specific components
  const renderIdList = (field: string, label: string, emptyText: string, placeholder: string) => {
    const ids: string[] = (channelConfig as any)[field] || [];
    const inputKey = `${name}-${field}`;
    return (
      <div className="flex flex-col gap-2 py-2.5 border-t border-neutral-800/50">
        <label className="text-sm text-neutral-300">{label}</label>
        <div className="flex flex-wrap gap-1.5 mb-2 min-h-[28px]">
          {ids.length === 0 && <span className="text-xs text-neutral-600 italic">{emptyText}</span>}
          {ids.map((id: string) => (
            <span key={id} className="inline-flex items-center gap-1.5 bg-blue-950/40 border border-blue-800/40 text-blue-400 rounded px-2 py-1 text-sm font-mono">
              {id}
              <button className="text-neutral-600 hover:text-red-500 text-base leading-none p-0 ml-1" onClick={() => removeId(field, id)}>
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={newId[inputKey] || ''}
            onChange={(e) => setNewId({ ...newId, [inputKey]: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && addId(field)}
            placeholder={placeholder}
            className="bg-neutral-950 border border-neutral-700 rounded-md px-2.5 py-1.5 text-neutral-200 text-sm font-mono w-40 focus:outline-none focus:border-blue-600 transition-colors"
          />
          <button
            className="bg-blue-950 text-blue-400 border border-blue-800/40 rounded-md px-3 py-1.5 text-sm cursor-pointer transition-all hover:bg-blue-900 disabled:opacity-40"
            onClick={() => addId(field)}
            disabled={!(newId[`${name}-${field}`] || '').trim()}
          >
            Add
          </button>
        </div>
      </div>
    );
  };

  return (
    <section className="bg-[#151515] border border-neutral-800 rounded-xl overflow-hidden">
      {/* Header — always visible */}
      <button
        className="w-full flex items-center justify-between p-5 text-left hover:bg-neutral-800/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <span className="text-xl">{CHANNEL_ICONS[name] || '📡'}</span>
          <h4 className="text-base font-semibold text-white">{name.charAt(0).toUpperCase() + name.slice(1).replace('-', ' ')}</h4>
          {channelConfig.enabled ? (
            <span className="text-xs bg-green-900/40 text-green-400 px-2 py-0.5 rounded-full">enabled</span>
          ) : (
            <span className="text-xs bg-red-900/40 text-red-400 px-2 py-0.5 rounded-full">disabled</span>
          )}
          {channelSettings && Object.keys(channelSettings).length > 0 && (
            <span className="text-xs bg-blue-900/40 text-blue-400 px-2 py-0.5 rounded-full">
              {Object.keys(channelSettings).length} override{Object.keys(channelSettings).length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <span className={`text-neutral-500 transition-transform ${expanded ? 'rotate-180' : ''}`}>
          ▼
        </span>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-5 pb-5 border-t border-neutral-800/50">
          {needsRestart && (
            <div className="flex items-center gap-2 mt-3 px-3 py-2 rounded-lg text-xs bg-blue-950/30 border border-blue-800/30 text-blue-300">
              🔄 Restart the server to apply enabled/disabled changes.
            </div>
          )}

          {/* ── Channel-Specific Config ── */}
          <div className="mt-4">
            <h5 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-3">Channel Config</h5>

            {/* Enabled toggle — always present for all channels */}
            <div className="flex items-center justify-between py-2.5 border-b border-neutral-800/50">
              <span className="text-sm text-neutral-300">Enabled</span>
              <label className="relative inline-block w-11 h-6 cursor-pointer">
                <input
                  type="checkbox"
                  checked={channelConfig.enabled}
                  onChange={(e) => updateChannelField('enabled', e.target.checked)}
                  className="opacity-0 w-0 h-0 peer"
                />
                <span className="absolute inset-0 bg-neutral-700 rounded-full transition-colors peer-checked:bg-blue-800" />
                <span className="absolute left-[3px] top-[3px] w-[18px] h-[18px] bg-neutral-400 rounded-full transition-all peer-checked:translate-x-5 peer-checked:bg-blue-400" />
              </label>
            </div>

            {/* Channel-specific config (Discord, Telegram, Google Chat, etc.) */}
            {ChannelSpecificConfig && (
              <ChannelSpecificConfig
                channelConfig={channelConfig}
                config={config}
                onSave={onSave}
                renderIdList={renderIdList}
              />
            )}
          </div>

          {/* ── Setting Overrides (cascading) — ALWAYS shown for all channels ── */}
          <div className="mt-6">
            <h5 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-3">Setting Overrides</h5>
            <p className="text-xs text-neutral-600 mb-3">Override global defaults for this channel. Unset values inherit from Global.</p>

            <SettingRow
              label="Stream Mode"
              inheritedValue={globalResolved.streamMode}
              inheritedFrom="global"
              overrideValue={channelSettings.streamMode}
              onOverride={(val) => updateChannelSetting('streamMode', val)}
              onReset={() => resetChannelSetting('streamMode')}
              renderInput={(val, onChange) => renderSegmented(val, onChange, STREAM_MODES)}
            />

            <SettingRow
              label="Require @Mention"
              inheritedValue={globalResolved.requireMention !== false}
              inheritedFrom="global"
              overrideValue={channelSettings.requireMention}
              onOverride={(val) => updateChannelSetting('requireMention', val)}
              onReset={() => resetChannelSetting('requireMention')}
              renderInput={(val, onChange) => renderToggle(val, onChange)}
              formatValue={(v) => v ? 'On' : 'Off'}
            />

            <SettingRow
              label="Trace Message Updates"
              hint="Log raw message_update events in traces (noisy)"
              inheritedValue={globalResolved.traceMessageUpdates ?? false}
              inheritedFrom="global"
              overrideValue={channelSettings.traceMessageUpdates}
              onOverride={(val) => updateChannelSetting('traceMessageUpdates', val)}
              onReset={() => resetChannelSetting('traceMessageUpdates')}
              renderInput={(val, onChange) => renderToggle(val, onChange)}
              formatValue={(v) => v ? 'On' : 'Off'}
            />

            <SettingRow
              label="Custom Instructions"
              hint="Additional system prompt instructions for this channel"
              inheritedValue={globalResolved.customInstructions || ''}
              inheritedFrom="global"
              overrideValue={channelSettings.customInstructions}
              onOverride={(val) => updateChannelSetting('customInstructions', val)}
              onReset={() => resetChannelSetting('customInstructions')}
              renderInput={(val, onChange) => renderTextarea(val, onChange, { placeholder: 'Custom instructions for this channel...' })}
              formatValue={(v) => v ? `"${(v as string).slice(0, 50)}${(v as string).length > 50 ? '...' : ''}"` : '(none)'}
            />

            {/* Current Session Context — legacy under v2, gated behind featureFlags.SHOW_LEGACY_CURRENT_CONTEXT */}
            {SHOW_LEGACY_CURRENT_CONTEXT && (<>
            <div className="mt-4 mb-2">
              <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">Current Session Context</span>
            </div>

            <SettingRow
              label="Num Messages"
              inheritedValue={globalResolved.currentContext.limit}
              inheritedFrom="global"
              overrideValue={channelSettings.currentContext?.limit}
              onOverride={(val) => updateChannelSetting('currentContext.limit', val)}
              onReset={() => resetChannelSetting('currentContext.limit')}
              renderInput={(val, onChange) => renderNumberInput(val, onChange, { min: 0 })}
            />

            <SettingRow
              label="Auto: Num Messages"
              hint="Classifier decides the current-session message window"
              inheritedValue={globalResolved.auto.currentContext.limit}
              inheritedFrom="global"
              overrideValue={channelSettings.auto?.currentContext?.limit}
              onOverride={(val) => updateChannelSetting('auto.currentContext.limit', val)}
              onReset={() => resetChannelSetting('auto.currentContext.limit')}
              renderInput={(val, onChange) => renderToggle(val, onChange)}
              formatValue={(v) => v ? 'On' : 'Off'}
            />

            <SettingRow
              label="Working Context"
              hint="Thoughts + tools together"
              inheritedValue={globalResolved.currentContext.includeThoughts && globalResolved.currentContext.includeTools}
              inheritedFrom="global"
              overrideValue={channelSettings.currentContext?.includeThoughts === undefined && channelSettings.currentContext?.includeTools === undefined
                ? undefined
                : (channelSettings.currentContext?.includeThoughts ?? globalResolved.currentContext.includeThoughts)
                  && (channelSettings.currentContext?.includeTools ?? globalResolved.currentContext.includeTools)}
              onOverride={(val) => updateChannelSettingsBatch([
                { field: 'currentContext.includeThoughts', value: val },
                { field: 'currentContext.includeTools', value: val },
              ])}
              onReset={() => resetChannelSettingsBatch([
                'currentContext.includeThoughts',
                'currentContext.includeTools',
              ])}
              renderInput={(val, onChange) => renderToggle(val, onChange)}
              formatValue={(v) => v ? 'On' : 'Off'}
            />

            <SettingRow
              label="Auto: Working Context"
              hint="Classifier decides whether to include thoughts + tools"
              inheritedValue={globalResolved.auto.currentContext.includeWorkingContext}
              inheritedFrom="global"
              overrideValue={channelSettings.auto?.currentContext?.includeWorkingContext}
              onOverride={(val) => updateChannelSetting('auto.currentContext.includeWorkingContext', val)}
              onReset={() => resetChannelSetting('auto.currentContext.includeWorkingContext')}
              renderInput={(val, onChange) => renderToggle(val, onChange)}
              formatValue={(v) => v ? 'On' : 'Off'}
            />

            <SettingRow
              label="Archived"
              inheritedValue={globalResolved.currentContext.includeArchived}
              inheritedFrom="global"
              overrideValue={channelSettings.currentContext?.includeArchived}
              onOverride={(val) => updateChannelSetting('currentContext.includeArchived', val)}
              onReset={() => resetChannelSetting('currentContext.includeArchived')}
              renderInput={(val, onChange) => renderToggle(val, onChange)}
              formatValue={(v) => v ? 'On' : 'Off'}
            />

            <SettingRow
              label="Exclude Embedded"
              hint="Skip messages already covered by embeddings"
              inheritedValue={globalResolved.currentContext.excludeEmbedded}
              inheritedFrom="global"
              overrideValue={channelSettings.currentContext?.excludeEmbedded}
              onOverride={(val) => updateChannelSetting('currentContext.excludeEmbedded', val)}
              onReset={() => resetChannelSetting('currentContext.excludeEmbedded')}
              renderInput={(val, onChange) => renderToggle(val, onChange)}
              formatValue={(v) => v ? 'On' : 'Off'}
            />

            <SettingRow
              label="Keep Embedded Tail"
              hint="Recent embedded messages to keep anyway"
              inheritedValue={globalResolved.currentContext.keepRecentEmbeddedMessages}
              inheritedFrom="global"
              overrideValue={channelSettings.currentContext?.keepRecentEmbeddedMessages}
              onOverride={(val) => updateChannelSetting('currentContext.keepRecentEmbeddedMessages', val)}
              onReset={() => resetChannelSetting('currentContext.keepRecentEmbeddedMessages')}
              renderInput={(val, onChange) => renderNumberInput(val, onChange, { min: 0, max: 50 })}
            />
            </>)}

            {/* Cross-Session Context — legacy under v2 */}
            {SHOW_LEGACY_CROSS_CONTEXT && (<>
            <div className="mt-4 mb-2">
              <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">Cross-Session Context</span>
            </div>

            <SettingRow
              label="Max Sessions"
              inheritedValue={globalResolved.crossContext.maxSessions}
              inheritedFrom="global"
              overrideValue={channelSettings.crossContext?.maxSessions}
              onOverride={(val) => updateChannelSetting('crossContext.maxSessions', val)}
              onReset={() => resetChannelSetting('crossContext.maxSessions')}
              renderInput={(val, onChange) => renderNumberInput(val, onChange, { min: 0 })}
            />

            <SettingRow
              label="Auto: Max Sessions"
              hint="Classifier decides how many other sessions to pull from"
              inheritedValue={globalResolved.auto.crossContext.maxSessions}
              inheritedFrom="global"
              overrideValue={channelSettings.auto?.crossContext?.maxSessions}
              onOverride={(val) => updateChannelSetting('auto.crossContext.maxSessions', val)}
              onReset={() => resetChannelSetting('auto.crossContext.maxSessions')}
              renderInput={(val, onChange) => renderToggle(val, onChange)}
              formatValue={(v) => v ? 'On' : 'Off'}
            />

            <SettingRow
              label="Num Messages"
              inheritedValue={globalResolved.crossContext.limit}
              inheritedFrom="global"
              overrideValue={channelSettings.crossContext?.limit}
              onOverride={(val) => updateChannelSetting('crossContext.limit', val)}
              onReset={() => resetChannelSetting('crossContext.limit')}
              renderInput={(val, onChange) => renderNumberInput(val, onChange, { min: 0 })}
            />

            <SettingRow
              label="Auto: Num Messages"
              hint="Classifier decides the cross-session message window"
              inheritedValue={globalResolved.auto.crossContext.limit}
              inheritedFrom="global"
              overrideValue={channelSettings.auto?.crossContext?.limit}
              onOverride={(val) => updateChannelSetting('auto.crossContext.limit', val)}
              onReset={() => resetChannelSetting('auto.crossContext.limit')}
              renderInput={(val, onChange) => renderToggle(val, onChange)}
              formatValue={(v) => v ? 'On' : 'Off'}
            />

            <SettingRow
              label="Working Context"
              hint="Thoughts + tools together"
              inheritedValue={globalResolved.crossContext.includeThoughts && globalResolved.crossContext.includeTools}
              inheritedFrom="global"
              overrideValue={channelSettings.crossContext?.includeThoughts === undefined && channelSettings.crossContext?.includeTools === undefined
                ? undefined
                : (channelSettings.crossContext?.includeThoughts ?? globalResolved.crossContext.includeThoughts)
                  && (channelSettings.crossContext?.includeTools ?? globalResolved.crossContext.includeTools)}
              onOverride={(val) => updateChannelSettingsBatch([
                { field: 'crossContext.includeThoughts', value: val },
                { field: 'crossContext.includeTools', value: val },
              ])}
              onReset={() => resetChannelSettingsBatch([
                'crossContext.includeThoughts',
                'crossContext.includeTools',
              ])}
              renderInput={(val, onChange) => renderToggle(val, onChange)}
              formatValue={(v) => v ? 'On' : 'Off'}
            />

            <SettingRow
              label="Auto: Working Context"
              hint="Classifier decides whether to include thoughts + tools from other sessions"
              inheritedValue={globalResolved.auto.crossContext.includeWorkingContext}
              inheritedFrom="global"
              overrideValue={channelSettings.auto?.crossContext?.includeWorkingContext}
              onOverride={(val) => updateChannelSetting('auto.crossContext.includeWorkingContext', val)}
              onReset={() => resetChannelSetting('auto.crossContext.includeWorkingContext')}
              renderInput={(val, onChange) => renderToggle(val, onChange)}
              formatValue={(v) => v ? 'On' : 'Off'}
            />

            <SettingRow
              label="Archived"
              inheritedValue={globalResolved.crossContext.includeArchived}
              inheritedFrom="global"
              overrideValue={channelSettings.crossContext?.includeArchived}
              onOverride={(val) => updateChannelSetting('crossContext.includeArchived', val)}
              onReset={() => resetChannelSetting('crossContext.includeArchived')}
              renderInput={(val, onChange) => renderToggle(val, onChange)}
              formatValue={(v) => v ? 'On' : 'Off'}
            />
            </>)}

            {/* Memory section — Profile Update Context stays live; the rest is legacy. */}
            <div className="mt-4 mb-2">
              <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">Memory</span>
            </div>

            {SHOW_LEGACY_MEMORY_RECALL && (
            <SettingRow
              label="Recalled Memory Limit"
              hint="Max semantic chunks to inject"
              inheritedValue={globalResolved.memory.recalledMemoryLimit}
              inheritedFrom="global"
              overrideValue={channelSettings.memory?.recalledMemoryLimit}
              onOverride={(val) => updateChannelSetting('memory.recalledMemoryLimit', val)}
              onReset={() => resetChannelSetting('memory.recalledMemoryLimit')}
              renderInput={(val, onChange) => renderNumberInput(val, onChange, { min: 0, max: 50 })}
            />
            )}

            {SHOW_LEGACY_MEMORY_RECALL && (
            <SettingRow
              label="Relevance Threshold"
              inheritedValue={globalResolved.memory.recalledMemoryThreshold}
              inheritedFrom="global"
              overrideValue={channelSettings.memory?.recalledMemoryThreshold}
              onOverride={(val) => updateChannelSetting('memory.recalledMemoryThreshold', val)}
              onReset={() => resetChannelSetting('memory.recalledMemoryThreshold')}
              renderInput={(val, onChange) => renderNumberInput(val, onChange, { min: 0, max: 1, step: 0.001 })}
            />
            )}

            <SettingRow
              label="Profile Update Context"
              inheritedValue={globalResolved.memory.profileUpdateContext}
              inheritedFrom="global"
              overrideValue={channelSettings.memory?.profileUpdateContext}
              onOverride={(val) => updateChannelSetting('memory.profileUpdateContext', val)}
              onReset={() => resetChannelSetting('memory.profileUpdateContext')}
              renderInput={(val, onChange) => renderNumberInput(val, onChange, { min: 1, max: 10 })}
            />

            {SHOW_LEGACY_MEMORY_RECALL && (
            <SettingRow
              label="Contextualize Search Query"
              hint="Rewrite follow-up asks before semantic search"
              inheritedValue={globalResolved.memory.contextualizeQuery}
              inheritedFrom="global"
              overrideValue={channelSettings.memory?.contextualizeQuery}
              onOverride={(val) => updateChannelSetting('memory.contextualizeQuery', val)}
              onReset={() => resetChannelSetting('memory.contextualizeQuery')}
              renderInput={(val, onChange) => renderToggle(val, onChange)}
              formatValue={(v) => v ? 'On' : 'Off'}
            />
            )}

            {SHOW_LEGACY_MEMORY_RECALL && (
            <SettingRow
              label="Query Context Messages"
              inheritedValue={globalResolved.memory.queryContextMessages}
              inheritedFrom="global"
              overrideValue={channelSettings.memory?.queryContextMessages}
              onOverride={(val) => updateChannelSetting('memory.queryContextMessages', val)}
              onReset={() => resetChannelSetting('memory.queryContextMessages')}
              renderInput={(val, onChange) => renderNumberInput(val, onChange, { min: 0, max: 50 })}
            />
            )}

            {SHOW_LEGACY_MEMORY_RECALL && (
            <SettingRow
              label="Query Contextualizer Model"
              inheritedValue={globalResolved.memory.queryContextualizerModel}
              inheritedFrom="global"
              overrideValue={channelSettings.memory?.queryContextualizerModel}
              onOverride={(val) => updateChannelSetting('memory.queryContextualizerModel', val)}
              onReset={() => resetChannelSetting('memory.queryContextualizerModel')}
              renderInput={(val, onChange) => <ClassifierModelPicker value={val} onChange={onChange} />}
              formatValue={(v) => v?.provider && v?.name ? `${v.provider}/${v.name}` : '—'}
            />
            )}

            {/* Auto Classifier — legacy under v2 */}
            {SHOW_LEGACY_AUTO_CLASSIFIER && (<>
            <div className="mt-4 mb-2">
              <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">Auto Classifier</span>
            </div>

            <SettingRow
              label="Classifier: Current Session Messages"
              hint="How many recent messages from this session the classifier reads"
              inheritedValue={globalResolved.auto.classifierContext.currentSessionMessages}
              inheritedFrom="global"
              overrideValue={channelSettings.auto?.classifierContext?.currentSessionMessages}
              onOverride={(val) => updateChannelSetting('auto.classifierContext.currentSessionMessages', val)}
              onReset={() => resetChannelSetting('auto.classifierContext.currentSessionMessages')}
              renderInput={(val, onChange) => renderNumberInput(val, onChange, { min: 0, max: 300 })}
            />

            <SettingRow
              label="Classifier: Cross-Session Max Sessions"
              hint="How many other sessions the classifier may preview"
              inheritedValue={globalResolved.auto.classifierContext.crossSessionMaxSessions}
              inheritedFrom="global"
              overrideValue={channelSettings.auto?.classifierContext?.crossSessionMaxSessions}
              onOverride={(val) => updateChannelSetting('auto.classifierContext.crossSessionMaxSessions', val)}
              onReset={() => resetChannelSetting('auto.classifierContext.crossSessionMaxSessions')}
              renderInput={(val, onChange) => renderNumberInput(val, onChange, { min: 0, max: 20 })}
            />

            <SettingRow
              label="Classifier: Cross-Session Messages"
              hint="How many recent messages per other session the classifier may preview"
              inheritedValue={globalResolved.auto.classifierContext.crossSessionMessages}
              inheritedFrom="global"
              overrideValue={channelSettings.auto?.classifierContext?.crossSessionMessages}
              onOverride={(val) => updateChannelSetting('auto.classifierContext.crossSessionMessages', val)}
              onReset={() => resetChannelSetting('auto.classifierContext.crossSessionMessages')}
              renderInput={(val, onChange) => renderNumberInput(val, onChange, { min: 0, max: 20 })}
            />
            </>)}

          </div>
        </div>
      )}
    </section>
  );
}
