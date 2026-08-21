import { useState } from "react";
import type { ChannelConfig, Settings, VitoConfig } from "../../utils/settingsResolution";
import { getEffectiveSettings } from "../../utils/settingsResolution";
import { channelConfigComponents, CHANNEL_ICONS, type ChannelIdField } from "./channels";
import CascadingSettingsEditor from "./CascadingSettingsEditor";
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
  const [newId, setNewId] = useState<Record<string, string>>({});
  const [needsRestart, setNeedsRestart] = useState(false);
  const ChannelSpecificConfig = channelConfigComponents[name];
  const inherited = getEffectiveSettings(config);
  const channelSettings = channelConfig.settings || {};

  const updateChannelField = async (
    update: { key: "enabled"; value: boolean } | { key: ChannelIdField; value: string[] },
  ) => {
    const updatedChannel = { ...channelConfig, [update.key]: update.value };
    await onSave({ channels: { ...config.channels, [name]: updatedChannel } });
    if (update.key === "enabled") setNeedsRestart(true);
  };

  const saveChannelSettings = async (newSettings: Settings) => {
    const updatedChannel: ChannelConfig = { ...channelConfig, settings: newSettings };
    if (Object.keys(newSettings).length === 0) delete updatedChannel.settings;
    await onSave({ channels: { ...config.channels, [name]: updatedChannel } });
  };

  const updateChannelSetting = async (update: SettingsUpdate) => {
    await saveChannelSettings(setSettingsValue(channelSettings, update));
  };

  const resetChannelSetting = async (path: SettingsPath) => {
    await saveChannelSettings(removeSettingsValue(channelSettings, path));
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
    void updateChannelField({ key: field, value: [...current, value] });
    setNewId({ ...newId, [inputKey]: "" });
  };

  const removeId = (field: ChannelIdField, id: string) => {
    const current = channelConfig[field] || [];
    void updateChannelField({
      key: field,
      value: current.filter((candidate) => candidate !== id),
    });
  };

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
          {ids.map((id) => (
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
            onChange={(event) => setNewId({ ...newId, [inputKey]: event.target.value })}
            onKeyDown={(event) => event.key === "Enter" && addId(field)}
            placeholder={placeholder}
            className="bg-neutral-950 border border-neutral-700 rounded-md px-2.5 py-1.5 text-neutral-200 text-sm font-mono w-40 focus:outline-none focus:border-blue-600 transition-colors"
          />
          <button
            className="bg-blue-950 text-blue-400 border border-blue-800/40 rounded-md px-3 py-1.5 text-sm cursor-pointer transition-all hover:bg-blue-900 disabled:opacity-40"
            onClick={() => addId(field)}
            disabled={!newId[inputKey]?.trim()}
          >
            Add
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <section className="bg-[#151515] border border-neutral-800 rounded-xl p-5">
        <div className="flex items-center gap-3 mb-4">
          <span className="text-xl">{CHANNEL_ICONS[name] || "📡"}</span>
          <div>
            <h4 className="text-sm font-semibold text-white">Channel Setup</h4>
            <p className="text-xs text-neutral-600">
              Configuration specific to {name.charAt(0).toUpperCase() + name.slice(1)}.
            </p>
          </div>
        </div>

        {needsRestart && (
          <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg text-xs bg-blue-950/30 border border-blue-800/30 text-blue-300">
            🔄 Restart the server to apply enabled/disabled changes.
          </div>
        )}

        <div className="flex items-center justify-between py-2.5 border-b border-neutral-800/50">
          <span className="text-sm text-neutral-300">Enabled</span>
          <label className="relative inline-block w-11 h-6 cursor-pointer">
            <input
              type="checkbox"
              checked={channelConfig.enabled}
              onChange={(event) =>
                void updateChannelField({ key: "enabled", value: event.target.checked })
              }
              className="opacity-0 w-0 h-0 peer"
            />
            <span className="absolute inset-0 bg-neutral-700 rounded-full transition-colors peer-checked:bg-blue-800" />
            <span className="absolute left-[3px] top-[3px] w-[18px] h-[18px] bg-neutral-400 rounded-full transition-all peer-checked:translate-x-5 peer-checked:bg-blue-400" />
          </label>
        </div>

        {ChannelSpecificConfig && (
          <ChannelSpecificConfig
            channelConfig={channelConfig}
            config={config}
            onSave={onSave}
            renderIdList={renderIdList}
          />
        )}
      </section>

      <CascadingSettingsEditor
        inherited={inherited}
        inheritedFrom="global"
        overrides={channelSettings}
        scope="channel"
        onUpdate={updateChannelSetting}
        onReset={resetChannelSetting}
        onResetAll={removeAllSettingOverrides}
      />
    </div>
  );
}
