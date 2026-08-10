import {
  streamModeSchema,
  type ResolvedSettings,
  type Settings,
} from "../../../../src/shared/schemas/vito-config";
import type { InheritSource } from "../../utils/settingsResolution";
import SettingRow, { renderSegmented, renderTextarea, renderToggle } from "./SettingRow";
import {
  STREAM_MODE_OPTIONS,
  type BasicSettingsPath,
  type SettingsUpdate,
} from "./settings-values";

interface ScopedSettingsFieldsProps {
  inherited: ResolvedSettings;
  inheritedFrom: InheritSource;
  overrides: Settings;
  instructionScope: "channel" | "session";
  onUpdate: (update: SettingsUpdate) => void;
  onReset: (path: BasicSettingsPath) => void;
}

function formatBoolean(value: unknown): string {
  return value ? "On" : "Off";
}

function formatInstructions(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) return "(none)";
  return `"${value.slice(0, 50)}${value.length > 50 ? "..." : ""}"`;
}

export default function ScopedSettingsFields({
  inherited,
  inheritedFrom,
  overrides,
  instructionScope,
  onUpdate,
  onReset,
}: ScopedSettingsFieldsProps) {
  return (
    <>
      <SettingRow
        label="Stream Mode"
        inheritedValue={inherited.streamMode}
        inheritedFrom={inheritedFrom}
        overrideValue={overrides.streamMode}
        onOverride={(value) =>
          onUpdate({ path: "streamMode", value: streamModeSchema.parse(value) })
        }
        onReset={() => onReset("streamMode")}
        renderInput={(value, onChange) =>
          renderSegmented(value, onChange, [...STREAM_MODE_OPTIONS])
        }
      />

      <SettingRow
        label="Require @Mention"
        inheritedValue={inherited.requireMention !== false}
        inheritedFrom={inheritedFrom}
        overrideValue={overrides.requireMention}
        onOverride={(value) => onUpdate({ path: "requireMention", value: value === true })}
        onReset={() => onReset("requireMention")}
        renderInput={renderToggle}
        formatValue={formatBoolean}
      />

      <SettingRow
        label="Trace Message Updates"
        hint="Log raw message_update events in traces (noisy)"
        inheritedValue={inherited.traceMessageUpdates ?? false}
        inheritedFrom={inheritedFrom}
        overrideValue={overrides.traceMessageUpdates}
        onOverride={(value) => onUpdate({ path: "traceMessageUpdates", value: value === true })}
        onReset={() => onReset("traceMessageUpdates")}
        renderInput={renderToggle}
        formatValue={formatBoolean}
      />

      <SettingRow
        label="Custom Instructions"
        hint={`Additional system prompt instructions for this ${instructionScope}`}
        inheritedValue={inherited.customInstructions ?? ""}
        inheritedFrom={inheritedFrom}
        overrideValue={overrides.customInstructions}
        onOverride={(value) =>
          onUpdate({
            path: "customInstructions",
            value: typeof value === "string" ? value : "",
          })
        }
        onReset={() => onReset("customInstructions")}
        renderInput={(value, onChange) =>
          renderTextarea(value, onChange, {
            placeholder: `Custom instructions for this ${instructionScope}...`,
          })
        }
        formatValue={formatInstructions}
      />
    </>
  );
}
