import type { ResolvedSettings, Settings } from "../../utils/settingsResolution";
import type { InheritSource } from "../../utils/settingsResolution";
import PiSettingsOverrideFields from "./PiSettingsOverrideFields";
import ScopedSettingsFields from "./ScopedSettingsFields";
import type { SettingsPath, SettingsUpdate } from "./settings-values";

interface ScopedSettingsEditorProps {
  inherited: ResolvedSettings;
  inheritedFrom: InheritSource;
  overrides: Settings;
  scope: "channel" | "session";
  onUpdate: (update: SettingsUpdate) => Promise<void>;
  onReset: (path: SettingsPath) => Promise<void>;
  onResetAll?: () => Promise<void>;
}

export default function ScopedSettingsEditor({
  inherited,
  inheritedFrom,
  overrides,
  scope,
  onUpdate,
  onReset,
  onResetAll,
}: ScopedSettingsEditorProps) {
  return (
    <section className="bg-[#151515] border border-neutral-800 rounded-xl p-5">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h4 className="text-sm font-semibold text-white">Cascading Settings</h4>
          <p className="text-xs text-neutral-600 mt-1">
            Values without an override inherit from{" "}
            {inheritedFrom === "channel" ? "Channel" : "Global"}.
          </p>
        </div>
        {onResetAll && Object.keys(overrides).length > 0 && (
          <button
            onClick={() => void onResetAll()}
            className="text-xs text-red-400 hover:text-red-300 transition-colors shrink-0"
          >
            Reset all overrides
          </button>
        )}
      </div>

      <ScopedSettingsFields
        inherited={inherited}
        inheritedFrom={inheritedFrom}
        overrides={overrides}
        instructionScope={scope}
        onUpdate={onUpdate}
        onReset={onReset}
      />

      <div className="mt-6 mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">
          Pi Coding Agent
        </span>
        <span className="text-xs text-neutral-600">{scope} overrides</span>
      </div>
      <PiSettingsOverrideFields
        inherited={inherited["pi-coding-agent"]}
        inheritedFrom={inheritedFrom}
        overrides={overrides["pi-coding-agent"]}
        onUpdate={onUpdate}
        onReset={onReset}
      />
    </section>
  );
}
