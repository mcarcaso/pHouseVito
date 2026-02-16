import { useState, useEffect } from 'react';
import type { VitoConfig } from '../../utils/settingsResolution';
import SettingRow, { renderSelect, renderSegmented, renderNumberInput } from './SettingRow';
import HarnessConfigEditor from './HarnessConfigEditor';

interface GlobalSettingsProps {
  config: VitoConfig;
  onSave: (updates: Partial<VitoConfig>) => Promise<void>;
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
  const memory = config.memory || { compactionThreshold: 200 };

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

  const updateMemory = async (key: string, value: number | boolean) => {
    await onSave({ memory: { ...memory, [key]: value } });
  };

  return (
    <div className="space-y-4">
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

        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 py-3 border-b border-neutral-800/50">
          <label className="text-sm text-neutral-400 sm:w-48 sm:shrink-0">Current Session Limit</label>
          {renderNumberInput(
            settings.memory?.currentSessionLimit ?? 100,
            (val) => updateSetting('memory.currentSessionLimit', val),
            { min: 0 }
          )}
          <span className="text-xs text-neutral-600">Recent messages in context</span>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 py-3">
          <label className="text-sm text-neutral-400 sm:w-48 sm:shrink-0">Cross-Session Limit</label>
          {renderNumberInput(
            settings.memory?.crossSessionLimit ?? 5,
            (val) => updateSetting('memory.crossSessionLimit', val),
            { min: 0 }
          )}
          <span className="text-xs text-neutral-600">Messages per other session</span>
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

      {/* ── Memory & Compaction ── */}
      <section className="bg-neutral-900 border border-neutral-800 rounded-xl p-5">
        <h3 className="text-base font-semibold text-white mb-1">Memory & Compaction</h3>
        <p className="text-xs text-neutral-600 mb-4">Global-only settings (these don't cascade to channels/sessions).</p>

        {/* Context toggles */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 py-3 border-b border-neutral-800/50">
          <label className="text-sm text-neutral-400 sm:w-48 sm:shrink-0">Include tool calls (current)</label>
          <input
            type="checkbox"
            checked={memory.includeToolsInCurrentSession ?? true}
            onChange={(e) => updateMemory('includeToolsInCurrentSession', e.target.checked)}
            className="w-5 h-5 accent-blue-600 cursor-pointer"
          />
          <span className="text-xs text-neutral-600">Show tool calls in session transcript</span>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 py-3 border-b border-neutral-800/50">
          <label className="text-sm text-neutral-400 sm:w-48 sm:shrink-0">Include tool calls (cross)</label>
          <input
            type="checkbox"
            checked={memory.includeToolsInCrossSession ?? false}
            onChange={(e) => updateMemory('includeToolsInCrossSession', e.target.checked)}
            className="w-5 h-5 accent-blue-600 cursor-pointer"
          />
          <span className="text-xs text-neutral-600">Show tool calls from other sessions</span>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 py-3 border-b border-neutral-800/50">
          <label className="text-sm text-neutral-400 sm:w-48 sm:shrink-0">Show archived in cross-session</label>
          <input
            type="checkbox"
            checked={memory.showArchivedInCrossSession ?? false}
            onChange={(e) => updateMemory('showArchivedInCrossSession', e.target.checked)}
            className="w-5 h-5 accent-blue-600 cursor-pointer"
          />
          <span className="text-xs text-neutral-600">Include archived messages from other sessions</span>
        </div>

        {/* Compaction */}
        <NumberInput
          label="Compaction threshold"
          value={memory.compactionThreshold}
          onChange={(val) => updateMemory('compactionThreshold', val)}
          min={0}
          step={50}
          hint="Trigger after this many uncompacted messages"
        />

        <NumberInput
          label="Compaction percent"
          value={memory.compactionPercent ?? 50}
          onChange={(val) => updateMemory('compactionPercent', Math.min(100, Math.max(1, val)))}
          min={1}
          max={100}
          step={5}
          hint="% of messages to compact (1-100)"
        />
      </section>
    </div>
  );
}
