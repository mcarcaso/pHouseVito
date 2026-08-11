import type { ResolvedSettings, Settings } from "../../utils/settingsResolution";
import type { InheritSource } from "../../utils/settingsResolution";
import ModelSettingsField from "./ModelSettingsField";
import PiSettingsOverrideFields from "./PiSettingsOverrideFields";
import ScopedSettingsFields from "./ScopedSettingsFields";
import type { SettingsPath, SettingsUpdate } from "./settings-values";

interface CascadingSettingsEditorProps {
  inherited: ResolvedSettings;
  inheritedFrom: InheritSource;
  overrides: Settings;
  scope: "global" | "channel" | "session";
  onUpdate: (update: SettingsUpdate) => Promise<void>;
  onReset: (path: SettingsPath) => Promise<void>;
  onResetAll?: () => Promise<void>;
}

export default function CascadingSettingsEditor({
  inherited,
  inheritedFrom,
  overrides,
  scope,
  onUpdate,
  onReset,
  onResetAll,
}: CascadingSettingsEditorProps) {
  const mode = scope === "global" ? "base" : "override";

  return (
    <section className="bg-[#151515] border border-neutral-800 rounded-xl p-5">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h4 className="text-sm font-semibold text-white">Cascading Settings</h4>
          <p className="text-xs text-neutral-600 mt-1">
            {scope === "global"
              ? "Base values inherited by channels and sessions."
              : `Values without an override inherit from ${inheritedFrom === "channel" ? "Channel" : "Global"}.`}
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
        mode={mode}
        inherited={inherited}
        inheritedFrom={inheritedFrom}
        overrides={overrides}
        instructionScope={scope}
        onUpdate={onUpdate}
        onReset={onReset}
      />

      <div className="mt-6 mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">
          Memory
        </span>
        {scope !== "global" && <span className="text-xs text-neutral-600">{scope} override</span>}
      </div>
      <ModelSettingsField
        label="Chunk Contextualizer"
        hint="Writes context prepended to chunks before embedding"
        mode={mode}
        inherited={inherited.memory?.chunkContextualizerModel}
        inheritedFrom={inheritedFrom}
        value={overrides.memory?.chunkContextualizerModel}
        onSave={(model) => onUpdate({ path: "memory.chunkContextualizerModel", value: model })}
        onReset={() => onReset("memory.chunkContextualizerModel")}
      />

      <div className="mt-6 mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">
          Pi Coding Agent
        </span>
        {scope !== "global" && <span className="text-xs text-neutral-600">{scope} overrides</span>}
      </div>
      <PiSettingsOverrideFields
        mode={mode}
        inherited={inherited["pi-coding-agent"]}
        inheritedFrom={inheritedFrom}
        overrides={overrides["pi-coding-agent"]}
        onUpdate={onUpdate}
        onReset={onReset}
      />
    </section>
  );
}
