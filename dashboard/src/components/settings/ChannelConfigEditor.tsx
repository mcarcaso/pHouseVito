import { useState, useEffect, useRef } from 'react';
import type { ChannelConfig, VitoConfig, Settings } from '../../utils/settingsResolution';
import { countActiveSettingOverrides, getEffectiveSettings } from '../../utils/settingsResolution';
import SettingRow, { renderSegmented, renderToggle, renderTextarea } from './SettingRow';
import { channelConfigComponents, CHANNEL_ICONS } from './channels';

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

const HARNESSES = [
  { value: 'pi-coding-agent', label: 'Pi' },
  { value: 'claude-code', label: 'Claude Code' },
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
  const activeOverrideCount = countActiveSettingOverrides(channelSettings);

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
          {activeOverrideCount > 0 && (
            <span className="text-xs bg-blue-900/40 text-blue-400 px-2 py-0.5 rounded-full">
              {activeOverrideCount} override{activeOverrideCount !== 1 ? 's' : ''}
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
              label="Harness"
              inheritedValue={globalResolved.harness}
              inheritedFrom="global"
              overrideValue={channelSettings.harness}
              onOverride={(val) => updateChannelSetting('harness', val)}
              onReset={() => resetChannelSetting('harness')}
              renderInput={(val, onChange) => renderSegmented(val, onChange, HARNESSES)}
            />

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




          </div>
        </div>
      )}
    </section>
  );
}
