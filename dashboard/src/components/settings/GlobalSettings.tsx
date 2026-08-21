import { useEffect, useState } from "react";
import type { VitoConfig } from "../../utils/settingsResolution";
import { getDefaults } from "../../utils/defaults";
import ProviderAccess from "./ProviderAccess";
import CascadingSettingsEditor from "./CascadingSettingsEditor";
import {
  removeSettingsValue,
  setSettingsValue,
  type SettingsPath,
  type SettingsUpdate,
} from "./settings-values";

interface GlobalSettingsProps {
  config: VitoConfig;
  onSave: (updates: Partial<VitoConfig>) => Promise<void>;
}

export default function GlobalSettings({ config, onSave }: GlobalSettingsProps) {
  const settings = config.settings || {};
  const botName = config.bot?.name || "";
  const [localBotName, setLocalBotName] = useState(botName);

  useEffect(() => {
    setLocalBotName(botName);
  }, [botName]);

  const updateSetting = async (update: SettingsUpdate) => {
    await onSave({ settings: setSettingsValue(settings, update) });
  };

  const resetSetting = async (path: SettingsPath) => {
    await onSave({ settings: removeSettingsValue(settings, path) });
  };

  const updateBotName = async () => {
    const name = localBotName.trim();
    if (!name || name === botName) return;
    await onSave({ bot: { ...config.bot, name } });
  };

  return (
    <div className="space-y-4">
      <section className="bg-[#151515] border border-neutral-800 rounded-xl p-5">
        <h4 className="text-sm font-semibold text-white">Global Setup</h4>
        <p className="text-xs text-neutral-600 mt-1 mb-4">
          Configuration that does not participate in the settings cascade.
        </p>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 py-3">
          <label className="text-sm text-neutral-300 sm:w-48 sm:shrink-0">Bot Name</label>
          <input
            type="text"
            value={localBotName}
            onChange={(event) => setLocalBotName(event.target.value)}
            onBlur={() => void updateBotName()}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            placeholder="Assistant"
            className="w-full sm:w-64 bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-neutral-200 text-sm focus:outline-none focus:border-blue-600"
          />
        </div>
      </section>

      <ProviderAccess />

      <CascadingSettingsEditor
        inherited={getDefaults()}
        inheritedFrom="default"
        overrides={settings}
        scope="global"
        onUpdate={updateSetting}
        onReset={resetSetting}
      />
    </div>
  );
}
