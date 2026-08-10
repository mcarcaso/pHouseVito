import { useState } from "react";
import type { ChannelConfig, VitoConfig, Settings } from "../../utils/settingsResolution";
import { countActiveSettingOverrides, getEffectiveSettings } from "../../utils/settingsResolution";
import { channelConfigComponents, CHANNEL_ICONS, type ChannelIdField } from "./channels";
import ScopedSettingsFields from "./ScopedSettingsFields";
import PiSettingsOverrideFields from "./PiSettingsOverrideFields";
import {
  removeSettingsValue,
  setSettingsValue,
  type SettingsPath,
  type SettingsUpdate,
} from "./settings-values";

interface ChannelConfigEditorProps {
  name: string;
  channelConfig: ChannelConfig;
  config: VitoConfig;
  onSave: (updates: Partial<VitoConfig>) => Promise<void>;
}

export default function ChannelConfigEditor({
  name,
  channelConfig,
  config,
  onSave,
}: ChannelConfigEditorProps) {
  const [expanded, setExpanded] = useState(false);
  const [newId, setNewId] = useState<Record<string, string>>({});
  const [needsRestart, setNeedsRestart] = useState(false);

  // Get the channel-specific config component (if one exists)
  const ChannelSpecificConfig = channelConfigComponents[name];

  // Get what the global settings resolve to (for showing inheritance)
  const globalResolved = getEffectiveSettings(config);
  const channelSettings = channelConfig.settings || {};
  const activeOverrideCount = countActiveSettingOverrides(channelSettings);

  const updateChannelField = async (
    update: { key: "enabled"; value: boolean } | { key: ChannelIdField; value: string[] },
  ) => {
    const updatedChannel = { ...channelConfig, [update.key]: update.value };
    await onSave({ channels: { ...config.channels, [name]: updatedChannel } });
    if (update.key === "enabled") setNeedsRestart(true);
  };

  const saveChannelSettings = async (newSettings: Settings) => {
    const updatedChannel = { ...channelConfig, settings: newSettings };
    await onSave({ channels: { ...config.channels, [name]: updatedChannel } });
  };

  const updateChannelSetting = async (update: SettingsUpdate) => {
    await saveChannelSettings(setSettingsValue(channelSettings, update));
  };

  const resetChannelSetting = async (path: SettingsPath) => {
    const newSettings = removeSettingsValue(channelSettings, path);
    // Clean up: if settings is now empty, remove the key
    const updatedChannel = { ...channelConfig };
    if (Object.keys(newSettings).length === 0) {
      delete updatedChannel.settings;
    } else {
      updatedChannel.settings = newSettings;
    }
    await onSave({ channels: { ...config.channels, [name]: updatedChannel } });
  };

  const removeAllSettingOverrides = async () => {
    const updatedChannel = { ...channelConfig };
    delete updatedChannel.settings;
    await onSave({ channels: { ...config.channels, [name]: updatedChannel } });
  };

  const addId = (field: ChannelIdField) => {
    const inputKey = `${name}-${field}`;
    const value = newId[inputKey]?.trim();
    if (!value) return;
    const current = channelConfig[field] || [];
    if (current.includes(value)) return;
    updateChannelField({ key: field, value: [...current, value] });
    setNewId({ ...newId, [inputKey]: "" });
  };

  const removeId = (field: ChannelIdField, id: string) => {
    const current = channelConfig[field] || [];
    updateChannelField({
      key: field,
      value: current.filter((candidate) => candidate !== id),
    });
  };

  // Shared ID list renderer — passed to channel-specific components
  const renderIdList = (
    field: ChannelIdField,
    label: string,
    emptyText: string,
    placeholder: string,
  ) => {
    const ids = channelConfig[field] || [];
    const inputKey = `${name}-${field}`;
    return (
      <div className="flex flex-col gap-2 py-2.5 border-t border-neutral-800/50">
        <label className="text-sm text-neutral-300">{label}</label>
        <div className="flex flex-wrap gap-1.5 mb-2 min-h-[28px]">
          {ids.length === 0 && <span className="text-xs text-neutral-600 italic">{emptyText}</span>}
          {ids.map((id: string) => (
            <span
              key={id}
              className="inline-flex items-center gap-1.5 bg-blue-950/40 border border-blue-800/40 text-blue-400 rounded px-2 py-1 text-sm font-mono"
            >
              {id}
              <button
                className="text-neutral-600 hover:text-red-500 text-base leading-none p-0 ml-1"
                onClick={() => removeId(field, id)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={newId[inputKey] || ""}
            onChange={(e) => setNewId({ ...newId, [inputKey]: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && addId(field)}
            placeholder={placeholder}
            className="bg-neutral-950 border border-neutral-700 rounded-md px-2.5 py-1.5 text-neutral-200 text-sm font-mono w-40 focus:outline-none focus:border-blue-600 transition-colors"
          />
          <button
            className="bg-blue-950 text-blue-400 border border-blue-800/40 rounded-md px-3 py-1.5 text-sm cursor-pointer transition-all hover:bg-blue-900 disabled:opacity-40"
            onClick={() => addId(field)}
            disabled={!(newId[`${name}-${field}`] || "").trim()}
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
          <span className="text-xl">{CHANNEL_ICONS[name] || "📡"}</span>
          <h4 className="text-base font-semibold text-white">
            {name.charAt(0).toUpperCase() + name.slice(1).replace("-", " ")}
          </h4>
          {channelConfig.enabled ? (
            <span className="text-xs bg-green-900/40 text-green-400 px-2 py-0.5 rounded-full">
              enabled
            </span>
          ) : (
            <span className="text-xs bg-red-900/40 text-red-400 px-2 py-0.5 rounded-full">
              disabled
            </span>
          )}
          {activeOverrideCount > 0 && (
            <span className="text-xs bg-blue-900/40 text-blue-400 px-2 py-0.5 rounded-full">
              {activeOverrideCount} override{activeOverrideCount !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <span className={`text-neutral-500 transition-transform ${expanded ? "rotate-180" : ""}`}>
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
            <h5 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-3">
              Channel Config
            </h5>

            {/* Enabled toggle — always present for all channels */}
            <div className="flex items-center justify-between py-2.5 border-b border-neutral-800/50">
              <span className="text-sm text-neutral-300">Enabled</span>
              <label className="relative inline-block w-11 h-6 cursor-pointer">
                <input
                  type="checkbox"
                  checked={channelConfig.enabled}
                  onChange={(event) =>
                    updateChannelField({ key: "enabled", value: event.target.checked })
                  }
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
            <div className="flex items-center justify-between mb-3">
              <h5 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">
                Setting Overrides
              </h5>
              {activeOverrideCount > 0 && (
                <button
                  onClick={() => void removeAllSettingOverrides()}
                  className="text-xs text-red-400 hover:text-red-300 transition-colors"
                >
                  Reset all
                </button>
              )}
            </div>
            <p className="text-xs text-neutral-600 mb-3">
              Override global defaults for this channel. Unset values inherit from Global.
            </p>

            <ScopedSettingsFields
              inherited={globalResolved}
              inheritedFrom="global"
              overrides={channelSettings}
              instructionScope="channel"
              onUpdate={(update) => void updateChannelSetting(update)}
              onReset={(path) => void resetChannelSetting(path)}
            />

            <div className="mt-5 mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">
                Pi Coding Agent Config
              </span>
              <span className="text-xs text-neutral-600">Per-channel Pi overrides</span>
            </div>
            <PiSettingsOverrideFields
              inherited={globalResolved["pi-coding-agent"]}
              fallback={config.settings?.["pi-coding-agent"]}
              inheritedFrom="global"
              overrides={channelSettings["pi-coding-agent"]}
              onUpdate={(update) => void updateChannelSetting(update)}
              onReset={(path) => void resetChannelSetting(path)}
            />
          </div>
        </div>
      )}
    </section>
  );
}
