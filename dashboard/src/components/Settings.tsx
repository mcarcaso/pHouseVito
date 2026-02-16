import { useState, useEffect } from 'react';

// NumberInput that allows clearing the field while typing
function NumberInput({ 
  label, value, onChange, min, max, step, hint 
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
      setLocalValue(String(value)); // Reset to original
    } else {
      onChange(num);
    }
  };

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 py-3 border-b border-neutral-900 last:border-b-0">
      <label className="text-sm text-neutral-400 sm:w-48 sm:shrink-0">{label}</label>
      <input
        type="number"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={handleBlur}
        min={min}
        max={max}
        step={step}
        className="w-full sm:w-28 bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-neutral-200 text-base sm:text-sm focus:outline-none focus:border-blue-600 transition-colors"
      />
      {hint && <span className="text-xs text-neutral-600">{hint}</span>}
    </div>
  );
}

interface Config {
  memory: {
    currentSessionLimit: number;
    crossSessionLimit: number;
    compactionThreshold: number;
    compactionPercent?: number;
    includeToolsInCurrentSession?: boolean;
    includeToolsInCrossSession?: boolean;
    showArchivedInCrossSession?: boolean;
  };
}

function Settings() {
  const [config, setConfig] = useState<Config | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch('/api/config')
      .then(r => r.json())
      .then(setConfig)
      .catch(err => console.error('Failed to load:', err));
  }, []);

  const save = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memory: config.memory }),
      });
      const updated = await res.json();
      setConfig(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('Failed to save config:', err);
    }
    setSaving(false);
  };

  if (!config) return <div className="flex flex-col pb-8 text-neutral-400 p-4">Loading...</div>;

  const updateMemory = (key: string, value: number | boolean) => {
    setConfig({ ...config, memory: { ...config.memory, [key]: value } });
  };

  return (
    <div className="flex flex-col pb-8">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-neutral-800 sticky top-0 bg-black/95 backdrop-blur z-10">
        <h2 className="text-lg font-semibold text-white">Settings</h2>
        <button
          className="ml-auto px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-default text-white text-sm rounded-md transition-colors shrink-0"
          onClick={save}
          disabled={saving}
        >
          {saving ? 'Saving...' : saved ? 'Saved ✓' : 'Save'}
        </button>
      </div>

      <div className="p-4 max-w-2xl space-y-3">
        {/* Context Window Section */}
        <section className="bg-neutral-900 border border-neutral-800 rounded-xl p-5">
          <h3 className="text-base font-semibold text-white mb-1">Context Window</h3>
          <p className="text-xs text-neutral-600 mb-4">Controls what goes into the system prompt.</p>

          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 py-3 border-b border-neutral-900">
            <label className="text-sm text-neutral-400 sm:w-48 sm:shrink-0">Current session messages</label>
            <input
              type="number"
              value={config.memory.currentSessionLimit}
              onChange={(e) => updateMemory('currentSessionLimit', parseInt(e.target.value) || 0)}
              min={0}
              className="w-full sm:w-28 bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-neutral-200 text-base sm:text-sm focus:outline-none focus:border-blue-600 transition-colors"
            />
            <span className="text-xs text-neutral-600">Recent messages from the active session</span>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 py-3 border-b border-neutral-900">
            <label className="text-sm text-neutral-400 sm:w-48 sm:shrink-0">Include tool calls (current)</label>
            <input
              type="checkbox"
              checked={config.memory.includeToolsInCurrentSession ?? true}
              onChange={(e) => updateMemory('includeToolsInCurrentSession', e.target.checked)}
              className="w-5 h-5 accent-blue-600 cursor-pointer"
            />
            <span className="text-xs text-neutral-600">Show tool calls in session transcript</span>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 py-3 border-b border-neutral-900">
            <label className="text-sm text-neutral-400 sm:w-48 sm:shrink-0">Cross-session messages</label>
            <input
              type="number"
              value={config.memory.crossSessionLimit}
              onChange={(e) => updateMemory('crossSessionLimit', parseInt(e.target.value) || 0)}
              min={0}
              className="w-full sm:w-28 bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-neutral-200 text-base sm:text-sm focus:outline-none focus:border-blue-600 transition-colors"
            />
            <span className="text-xs text-neutral-600">Messages per other session (cross-session context)</span>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 py-3 border-b border-neutral-900">
            <label className="text-sm text-neutral-400 sm:w-48 sm:shrink-0">Include tool calls (cross)</label>
            <input
              type="checkbox"
              checked={config.memory.includeToolsInCrossSession ?? false}
              onChange={(e) => updateMemory('includeToolsInCrossSession', e.target.checked)}
              className="w-5 h-5 accent-blue-600 cursor-pointer"
            />
            <span className="text-xs text-neutral-600">Show tool calls from other sessions</span>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 py-3">
            <label className="text-sm text-neutral-400 sm:w-48 sm:shrink-0">Show archived in cross-session</label>
            <input
              type="checkbox"
              checked={config.memory.showArchivedInCrossSession ?? false}
              onChange={(e) => updateMemory('showArchivedInCrossSession', e.target.checked)}
              className="w-5 h-5 accent-blue-600 cursor-pointer"
            />
            <span className="text-xs text-neutral-600">Include archived messages from other sessions</span>
          </div>
        </section>

        {/* Compaction Section */}
        <section className="bg-neutral-900 border border-neutral-800 rounded-xl p-5">
          <h3 className="text-base font-semibold text-white mb-1">Compaction</h3>
          <p className="text-xs text-neutral-600 mb-4">Summarize old messages into long-term memories.</p>

          <NumberInput
            label="Compaction threshold"
            value={config.memory.compactionThreshold}
            onChange={(val) => updateMemory('compactionThreshold', val)}
            min={0}
            step={50}
            hint="Trigger after this many uncompacted messages"
          />

          <NumberInput
            label="Compaction percent"
            value={config.memory.compactionPercent ?? 50}
            onChange={(val) => updateMemory('compactionPercent', Math.min(100, Math.max(1, val)))}
            min={1}
            max={100}
            step={5}
            hint="% of messages to compact (1-100)"
          />
        </section>
      </div>
    </div>
  );
}

export default Settings;
