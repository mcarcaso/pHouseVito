import { useState } from 'react';
import type { ChannelConfig, VitoConfig, Settings } from '../../utils/settingsResolution';
import { getEffectiveSettings } from '../../utils/settingsResolution';
import SettingRow, { renderSelect, renderSegmented, renderNumberInput, renderToggle } from './SettingRow';

interface ChannelConfigEditorProps {
  name: string;
  channelConfig: ChannelConfig;
  config: VitoConfig;
  onSave: (updates: Partial<VitoConfig>) => Promise<void>;
}

const CHANNEL_ICONS: Record<string, string> = {
  dashboard: '\uD83D\uDDA5\uFE0F',
  telegram: '\uD83D\uDCF1',
  discord: '\uD83C\uDFAE',
};

const STREAM_MODES = [
  { value: 'stream', label: 'Stream' },
  { value: 'bundled', label: 'Bundled' },
  { value: 'final', label: 'Final' },
];

const HARNESS_OPTIONS = [
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'pi-coding-agent', label: 'Pi Coding Agent' },
];

export default function ChannelConfigEditor({ name, channelConfig, config, onSave }: ChannelConfigEditorProps) {
  const [expanded, setExpanded] = useState(false);
  const [newId, setNewId] = useState<Record<string, string>>({});
  const [needsRestart, setNeedsRestart] = useState(false);
  const [registeringCommands, setRegisteringCommands] = useState(false);
  const [commandsResult, setCommandsResult] = useState<{ success: boolean; message: string } | null>(null);

  const isTelegram = name === 'telegram';
  const isDiscord = name === 'discord';

  // Get what the global settings resolve to (for showing inheritance)
  const globalResolved = getEffectiveSettings(config);
  const channelSettings = channelConfig.settings || {};

  const updateChannelField = async (key: string, value: any) => {
    const updatedChannel = { ...channelConfig, [key]: value };
    await onSave({ channels: { ...config.channels, [name]: updatedChannel } });
    if (key === 'enabled') setNeedsRestart(true);
  };

  const updateChannelSetting = async (field: string, value: any) => {
    const newSettings: Settings = { ...channelSettings };
    if (field.includes('.')) {
      const [parent, child] = field.split('.');
      (newSettings as any)[parent] = { ...(newSettings as any)[parent], [child]: value };
    } else {
      (newSettings as any)[field] = value;
    }
    const updatedChannel = { ...channelConfig, settings: newSettings };
    await onSave({ channels: { ...config.channels, [name]: updatedChannel } });
  };

  const resetChannelSetting = async (field: string) => {
    const newSettings: Settings = { ...channelSettings };
    if (field.includes('.')) {
      const [parent, child] = field.split('.');
      if ((newSettings as any)[parent]) {
        delete (newSettings as any)[parent][child];
        if (Object.keys((newSettings as any)[parent]).length === 0) {
          delete (newSettings as any)[parent];
        }
      }
    } else {
      delete (newSettings as any)[field];
    }
    // Clean up: if settings is now empty, remove the key
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
          <span className="text-xl">{CHANNEL_ICONS[name] || '\uD83D\uDCE1'}</span>
          <h4 className="text-base font-semibold text-white">{name.charAt(0).toUpperCase() + name.slice(1)}</h4>
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

            {/* Enabled toggle */}
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

            {/* Telegram-specific */}
            {isTelegram && (
              <div className="py-2.5 border-b border-neutral-800/50">
                <div className="flex items-center gap-2 text-sm text-neutral-500">
                  <span>🔑</span>
                  <span>Bot Token via <code className="bg-neutral-900 text-purple-400 px-1.5 py-0.5 rounded text-xs">TELEGRAM_BOT_TOKEN</code> in <a href="/secrets" className="text-blue-400 hover:underline">Secrets</a></span>
                </div>
              </div>
            )}
            {isTelegram && renderIdList('allowedChatIds', 'Allowed Chat IDs', 'No chat IDs — all chats allowed', 'Chat ID')}

            {/* Discord-specific */}
            {isDiscord && (
              <div className="py-2.5 border-b border-neutral-800/50">
                <div className="flex items-center gap-2 text-sm text-neutral-500">
                  <span>🔑</span>
                  <span>Bot Token via <code className="bg-neutral-900 text-purple-400 px-1.5 py-0.5 rounded text-xs">DISCORD_BOT_TOKEN</code> in <a href="/secrets" className="text-blue-400 hover:underline">Secrets</a></span>
                </div>
              </div>
            )}
            {isDiscord && (
              <div className="flex items-center justify-between py-2.5 border-b border-neutral-800/50">
                <span className="text-sm text-neutral-300">Require @Mention</span>
                <div className="flex items-center gap-3">
                  <label className="relative inline-block w-11 h-6 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={channelConfig.requireMention !== false}
                      onChange={(e) => updateChannelField('requireMention', e.target.checked)}
                      className="opacity-0 w-0 h-0 peer"
                    />
                    <span className="absolute inset-0 bg-neutral-700 rounded-full transition-colors peer-checked:bg-blue-800" />
                    <span className="absolute left-[3px] top-[3px] w-[18px] h-[18px] bg-neutral-400 rounded-full transition-all peer-checked:translate-x-5 peer-checked:bg-blue-400" />
                  </label>
                </div>
              </div>
            )}
            {isDiscord && (
              <div className="flex flex-col gap-2 py-2.5 border-b border-neutral-800/50">
                <label className="text-sm text-neutral-300">Slash Commands</label>
                <div className="flex items-center gap-3">
                  <button
                    className="bg-green-950/40 text-green-400 border border-green-800/40 rounded-md px-3 py-1.5 text-sm cursor-pointer hover:bg-green-900/40 disabled:opacity-40"
                    disabled={registeringCommands}
                    onClick={async () => {
                      setRegisteringCommands(true);
                      setCommandsResult(null);
                      try {
                        const res = await fetch('/api/discord/register-commands', { method: 'POST' });
                        const data = await res.json();
                        setCommandsResult(data.success
                          ? { success: true, message: `Registered ${data.count} command(s)` }
                          : { success: false, message: data.error || 'Failed' });
                      } catch (err: any) {
                        setCommandsResult({ success: false, message: err.message });
                      }
                      setRegisteringCommands(false);
                      setTimeout(() => setCommandsResult(null), 5000);
                    }}
                  >
                    {registeringCommands ? 'Registering...' : 'Register Slash Commands'}
                  </button>
                  {commandsResult && (
                    <span className={`text-sm ${commandsResult.success ? 'text-green-400' : 'text-red-400'}`}>
                      {commandsResult.success ? '\u2713' : '\u2717'} {commandsResult.message}
                    </span>
                  )}
                </div>
                <span className="text-xs text-neutral-600">Only needed once (or when commands change).</span>
              </div>
            )}
            {isDiscord && renderIdList('allowedGuildIds', 'Allowed Server IDs', 'No server IDs — all servers allowed', 'Server (Guild) ID')}
            {isDiscord && renderIdList('allowedChannelIds', 'Allowed Channel IDs', 'No channel IDs — all channels allowed', 'Channel ID')}
          </div>

          {/* ── Setting Overrides (cascading) ── */}
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
              renderInput={(val, onChange) => renderSelect(val, onChange, HARNESS_OPTIONS)}
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

            {/* Current Session Context */}
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
              label="Thoughts"
              inheritedValue={globalResolved.currentContext.includeThoughts}
              inheritedFrom="global"
              overrideValue={channelSettings.currentContext?.includeThoughts}
              onOverride={(val) => updateChannelSetting('currentContext.includeThoughts', val)}
              onReset={() => resetChannelSetting('currentContext.includeThoughts')}
              renderInput={(val, onChange) => renderToggle(val, onChange)}
              formatValue={(v) => v ? 'On' : 'Off'}
            />

            <SettingRow
              label="Tools"
              inheritedValue={globalResolved.currentContext.includeTools}
              inheritedFrom="global"
              overrideValue={channelSettings.currentContext?.includeTools}
              onOverride={(val) => updateChannelSetting('currentContext.includeTools', val)}
              onReset={() => resetChannelSetting('currentContext.includeTools')}
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
              label="Compacted"
              inheritedValue={globalResolved.currentContext.includeCompacted}
              inheritedFrom="global"
              overrideValue={channelSettings.currentContext?.includeCompacted}
              onOverride={(val) => updateChannelSetting('currentContext.includeCompacted', val)}
              onReset={() => resetChannelSetting('currentContext.includeCompacted')}
              renderInput={(val, onChange) => renderToggle(val, onChange)}
              formatValue={(v) => v ? 'On' : 'Off'}
            />

            {/* Cross-Session Context */}
            <div className="mt-4 mb-2">
              <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">Cross-Session Context</span>
            </div>

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
              label="Thoughts"
              inheritedValue={globalResolved.crossContext.includeThoughts}
              inheritedFrom="global"
              overrideValue={channelSettings.crossContext?.includeThoughts}
              onOverride={(val) => updateChannelSetting('crossContext.includeThoughts', val)}
              onReset={() => resetChannelSetting('crossContext.includeThoughts')}
              renderInput={(val, onChange) => renderToggle(val, onChange)}
              formatValue={(v) => v ? 'On' : 'Off'}
            />

            <SettingRow
              label="Tools"
              inheritedValue={globalResolved.crossContext.includeTools}
              inheritedFrom="global"
              overrideValue={channelSettings.crossContext?.includeTools}
              onOverride={(val) => updateChannelSetting('crossContext.includeTools', val)}
              onReset={() => resetChannelSetting('crossContext.includeTools')}
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

            <SettingRow
              label="Compacted"
              inheritedValue={globalResolved.crossContext.includeCompacted}
              inheritedFrom="global"
              overrideValue={channelSettings.crossContext?.includeCompacted}
              onOverride={(val) => updateChannelSetting('crossContext.includeCompacted', val)}
              onReset={() => resetChannelSetting('crossContext.includeCompacted')}
              renderInput={(val, onChange) => renderToggle(val, onChange)}
              formatValue={(v) => v ? 'On' : 'Off'}
            />
          </div>
        </div>
      )}
    </section>
  );
}
