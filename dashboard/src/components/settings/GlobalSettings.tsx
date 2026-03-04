import { useState, useEffect } from 'react';
import type { VitoConfig } from '../../utils/settingsResolution';
import { renderSelect, renderSegmented, renderNumberInput, renderSliderToggle } from './SettingRow';
import HarnessConfigEditor from './HarnessConfigEditor';

interface GlobalSettingsProps {
  config: VitoConfig;
  onSave: (updates: Partial<VitoConfig>) => Promise<void>;
}

// Toggle row with title+description on left, toggle on right
function ToggleRow({ title, description, value, onChange }: {
  title: string;
  description: string;
  value: boolean;
  onChange: (val: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-neutral-800/50 last:border-b-0">
      <div className="flex flex-col">
        <span className="text-sm text-neutral-200">{title}</span>
        <span className="text-xs text-neutral-500">{description}</span>
      </div>
      {renderSliderToggle(value, onChange)}
    </div>
  );
}

const STREAM_MODES = [
  { value: 'stream', label: 'Stream' },
  { value: 'bundled', label: 'Bundled' },
  { value: 'final', label: 'Final' },
];

const HARNESS_OPTIONS = [
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'pi-coding-agent', label: 'Pi Coding Agent' },
];

// NumberInput that allows clearing the field while typing (borrowed from old Settings.tsx)
function NumberInput({
  label, value, onChange, min, max, step, hint,
}: {
  label: string;
  value: number;
  onChange: (val: number) => void;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
}) {
  const [localValue, setLocalValue] = useState(String(value));

  useEffect(() => {
    setLocalValue(String(value));
  }, [value]);

  const handleBlur = () => {
    const num = parseInt(localValue);
    if (isNaN(num) || localValue === '') {
      setLocalValue(String(value));
    } else {
      onChange(num);
    }
  };

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 py-3 border-b border-neutral-800/50 last:border-b-0">
      <label className="text-sm text-neutral-400 sm:w-48 sm:shrink-0">{label}</label>
      <input
        type="number"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={handleBlur}
        min={min}
        max={max}
        step={step}
        className="w-full sm:w-28 bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-neutral-200 text-sm focus:outline-none focus:border-blue-600 transition-colors"
      />
      {hint && <span className="text-xs text-neutral-600">{hint}</span>}
    </div>
  );
}

export default function GlobalSettings({ config, onSave }: GlobalSettingsProps) {
  const settings = config.settings || {};
  const botName = config.bot?.name || 'Vito';

  const updateSetting = async (field: string, value: any) => {
    const newSettings = { ...settings };
    if (field.includes('.')) {
      const [parent, child] = field.split('.');
      (newSettings as any)[parent] = { ...(newSettings as any)[parent], [child]: value };
    } else {
      (newSettings as any)[field] = value;
    }
    await onSave({ settings: newSettings });
  };

  const updateBotName = async (name: string) => {
    await onSave({ bot: { name } });
  };

  return (
    <div className="space-y-4">
      {/* ── Bot Identity ── */}
      <section className="bg-neutral-900 border border-neutral-800 rounded-xl p-5">
        <h3 className="text-base font-semibold text-white mb-1">Bot Identity</h3>
        <p className="text-xs text-neutral-600 mb-4">Name used for @mention normalization across all channels.</p>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 py-3">
          <label className="text-sm text-neutral-400 sm:w-48 sm:shrink-0">Bot Name</label>
          <input
            type="text"
            value={botName}
            onChange={(e) => updateBotName(e.target.value)}
            placeholder="Vito"
            className="w-full sm:w-48 bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-neutral-200 text-sm focus:outline-none focus:border-blue-600 transition-colors"
          />
          <span className="text-xs text-neutral-600">@mentions become @{botName}</span>
        </div>
      </section>

      {/* ── Default Settings ── */}
      <section className="bg-neutral-900 border border-neutral-800 rounded-xl p-5">
        <h3 className="text-base font-semibold text-white mb-1">Default Settings</h3>
        <p className="text-xs text-neutral-600 mb-4">Baseline defaults — channels and sessions inherit from here.</p>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 py-3 border-b border-neutral-800/50">
          <label className="text-sm text-neutral-400 sm:w-48 sm:shrink-0">Harness</label>
          {renderSelect(settings.harness || 'claude-code', (val) => updateSetting('harness', val), HARNESS_OPTIONS)}
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 py-3 border-b border-neutral-800/50">
          <label className="text-sm text-neutral-400 sm:w-48 sm:shrink-0">Stream Mode</label>
          {renderSegmented(settings.streamMode || 'stream', (val) => updateSetting('streamMode', val), STREAM_MODES)}
        </div>

        <ToggleRow
          title="Require @Mention"
          description="Only respond when @mentioned (Discord/Telegram guild channels)"
          value={settings.requireMention !== false}
          onChange={(val) => updateSetting('requireMention', val)}
        />

        <ToggleRow
          title="Trace Message Updates"
          description="Log raw message_update events in traces (noisy)"
          value={settings.traceMessageUpdates ?? false}
          onChange={(val) => updateSetting('traceMessageUpdates', val)}
        />

      </section>

      {/* ── Current Session Context ── */}
      <section className="bg-neutral-900 border border-neutral-800 rounded-xl p-5">
        <h3 className="text-base font-semibold text-white mb-1">Current Session Context</h3>
        <p className="text-xs text-neutral-600 mb-4">What to include from the active session's history.</p>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 py-3 border-b border-neutral-800/50">
          <label className="text-sm text-neutral-400 sm:w-48 sm:shrink-0">Num Messages</label>
          {renderNumberInput(
            settings.currentContext?.limit ?? 100,
            (val) => updateSetting('currentContext.limit', val),
            { min: 0 }
          )}
          <span className="text-xs text-neutral-600">Recent messages to include</span>
        </div>

        <ToggleRow
          title="Thoughts"
          description="Include thinking/reasoning steps"
          value={settings.currentContext?.includeThoughts ?? true}
          onChange={(val) => updateSetting('currentContext.includeThoughts', val)}
        />

        <ToggleRow
          title="Tools"
          description="Include tool calls and results"
          value={settings.currentContext?.includeTools ?? true}
          onChange={(val) => updateSetting('currentContext.includeTools', val)}
        />

        <ToggleRow
          title="Archived"
          description="Include archived messages"
          value={settings.currentContext?.includeArchived ?? false}
          onChange={(val) => updateSetting('currentContext.includeArchived', val)}
        />
      </section>

      {/* ── Cross-Session Context ── */}
      <section className="bg-neutral-900 border border-neutral-800 rounded-xl p-5">
        <h3 className="text-base font-semibold text-white mb-1">Cross-Session Context</h3>
        <p className="text-xs text-neutral-600 mb-4">What to include from other sessions.</p>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 py-3 border-b border-neutral-800/50">
          <label className="text-sm text-neutral-400 sm:w-48 sm:shrink-0">Num Messages</label>
          {renderNumberInput(
            settings.crossContext?.limit ?? 5,
            (val) => updateSetting('crossContext.limit', val),
            { min: 0 }
          )}
          <span className="text-xs text-neutral-600">Messages per other session</span>
        </div>

        <ToggleRow
          title="Thoughts"
          description="Include thinking/reasoning steps"
          value={settings.crossContext?.includeThoughts ?? false}
          onChange={(val) => updateSetting('crossContext.includeThoughts', val)}
        />

        <ToggleRow
          title="Tools"
          description="Include tool calls and results"
          value={settings.crossContext?.includeTools ?? false}
          onChange={(val) => updateSetting('crossContext.includeTools', val)}
        />

        <ToggleRow
          title="Archived"
          description="Include archived messages"
          value={settings.crossContext?.includeArchived ?? false}
          onChange={(val) => updateSetting('crossContext.includeArchived', val)}
        />
      </section>

      {/* ── Memory / Recalled Memories ── */}
      <section className="bg-neutral-900 border border-neutral-800 rounded-xl p-5">
        <h3 className="text-base font-semibold text-white mb-1">Memory Recall</h3>
        <p className="text-xs text-neutral-600 mb-4">Settings for semantic search over past conversations.</p>

        <NumberInput
          label="Recalled Memory Limit"
          value={settings.memory?.recalledMemoryLimit ?? 3}
          onChange={(val) => updateSetting('memory.recalledMemoryLimit', val)}
          min={0}
          max={10}
          hint="Max memory chunks to inject (0 to disable)"
        />

        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 py-3">
          <label className="text-sm text-neutral-400 sm:w-48 sm:shrink-0">Relevance Threshold</label>
          <input
            type="number"
            value={settings.memory?.recalledMemoryThreshold ?? 0.005}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              if (!isNaN(val)) updateSetting('memory.recalledMemoryThreshold', val);
            }}
            min={0}
            max={1}
            step={0.001}
            className="w-full sm:w-28 bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-neutral-200 text-sm focus:outline-none focus:border-blue-600 transition-colors"
          />
          <span className="text-xs text-neutral-600">Min RRF score (lower = more results)</span>
        </div>
      </section>

      {/* ── Harness Configurations ── */}
      <section>
        <div className="mb-3">
          <h3 className="text-base font-semibold text-white mb-1">Harness Configurations</h3>
          <p className="text-xs text-neutral-600">Base configs for each AI harness engine.</p>
        </div>
        <HarnessConfigEditor config={config} onSave={onSave} />
      </section>
    </div>
  );
}
