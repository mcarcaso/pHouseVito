import { useState, useEffect, useRef } from 'react';

import { type VitoConfig } from '../../utils/settingsResolution';
import { renderSelect, renderSegmented, renderSliderToggle } from './SettingRow';
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

const HARNESSES = [
  { value: 'pi-coding-agent', label: 'Pi' },
  { value: 'claude-code', label: 'Claude Code' },
];

const TIMEZONE_OPTIONS = [
  { value: 'America/Toronto', label: 'America/Toronto' },
  { value: 'America/New_York', label: 'America/New_York' },
  { value: 'America/Chicago', label: 'America/Chicago' },
  { value: 'America/Denver', label: 'America/Denver' },
  { value: 'America/Los_Angeles', label: 'America/Los_Angeles' },
  { value: 'UTC', label: 'UTC' },
];

// Toggle row with title+description on left, toggle on right
function ToggleRow({ title, description, value, onChange, auto, onAutoChange }: {
  title: string;
  description: string;
  value: boolean;
  onChange: (val: boolean) => void;
  auto?: boolean;
  onAutoChange?: (val: boolean) => void;
}) {
  const hasAuto = onAutoChange !== undefined;
  const disabled = hasAuto && !!auto;
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-neutral-800/50 last:border-b-0">
      <div className="flex flex-col">
        <span className="text-sm text-neutral-200">{title}</span>
        <span className="text-xs text-neutral-500">{description}</span>
      </div>
      <div className="flex items-center gap-3">
        <div className={disabled ? 'opacity-40 pointer-events-none' : ''}>
          {renderSliderToggle(value, onChange)}
        </div>
        {hasAuto && (
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <span className="text-xs text-neutral-500 uppercase tracking-wide">Auto</span>
            {renderSliderToggle(!!auto, onAutoChange!)}
          </label>
        )}
      </div>
    </div>
  );
}

// Numeric row with optional auto toggle


// ─────────────────────────────────────────────────────────────────────────────

const CHUNK_CONTEXTUALIZER_DEFAULT = { provider: 'openrouter', name: 'openai/gpt-5.4-nano' };

// Shared style with HarnessConfigEditor's selects so the Memory picker looks
// identical to the Pi/CC pickers.
const selectClass = "w-full sm:w-64 bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-neutral-200 text-sm focus:outline-none focus:border-blue-600 transition-colors cursor-pointer appearance-none bg-[url('data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2210%22%20height%3D%2210%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%23666%22%20d%3D%22M6%208L1%203h10z%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_0.75rem_center] pr-8";

export default function GlobalSettings({ config, onSave }: GlobalSettingsProps) {
  const settings = config.settings || {};
  const botName = config.bot?.name || '';
  const [localBotName, setLocalBotName] = useState(botName);
  const [localCustomInstructions, setLocalCustomInstructions] = useState(settings.customInstructions || '');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Memory chunk contextualizer picker state — mirrors HarnessConfigEditor's
  // edit/save flow. Read-only view shows the active model; Edit reveals
  // provider + model dropdowns sourced from /api/models.
  const [editingChunkModel, setEditingChunkModel] = useState(false);
  const [chunkProvider, setChunkProvider] = useState('');
  const [chunkModelName, setChunkModelName] = useState('');
  const [chunkProviders, setChunkProviders] = useState<string[]>([]);
  const [chunkModels, setChunkModels] = useState<{ id: string }[]>([]);
  const [chunkLoadingModels, setChunkLoadingModels] = useState(false);
  const [savingChunkModel, setSavingChunkModel] = useState(false);

  // Sync local state when config changes externally
  useEffect(() => {
    setLocalBotName(config.bot?.name || '');
  }, [config.bot?.name]);

  useEffect(() => {
    setLocalCustomInstructions(config.settings?.customInstructions || '');
  }, [config.settings?.customInstructions]);

  // Seed the chunk model picker from config (or defaults) whenever entering edit mode.
  useEffect(() => {
    if (!editingChunkModel) return;
    const saved = config.settings?.memory?.chunkContextualizerModel;
    const initialProvider = saved?.provider || CHUNK_CONTEXTUALIZER_DEFAULT.provider;
    const initialName = saved?.name || CHUNK_CONTEXTUALIZER_DEFAULT.name;
    setChunkProvider(initialProvider);
    setChunkModelName(initialName);
    fetch('/api/models/providers')
      .then((r) => r.json())
      .then((data) => setChunkProviders(data.providers || []))
      .catch(() => setChunkProviders([]));
    if (initialProvider) loadChunkModels(initialProvider);
  }, [editingChunkModel]);

  const loadChunkModels = async (provider: string) => {
    setChunkLoadingModels(true);
    try {
      const res = await fetch(`/api/models/${provider}`);
      setChunkModels(await res.json());
    } catch {
      setChunkModels([]);
    }
    setChunkLoadingModels(false);
  };

  const handleChunkProviderChange = (provider: string) => {
    setChunkProvider(provider);
    setChunkModelName('');
    loadChunkModels(provider);
  };

  const saveChunkModel = async () => {
    if (!chunkProvider || !chunkModelName) return;
    setSavingChunkModel(true);
    await updateSetting('memory.chunkContextualizerModel', { provider: chunkProvider, name: chunkModelName });
    setEditingChunkModel(false);
    setSavingChunkModel(false);
  };

  const resetChunkModel = async () => {
    await updateSetting('memory.chunkContextualizerModel', undefined);
  };

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
    }
  }, [localCustomInstructions]);

  const updateSetting = async (field: string, value: any) => {
    const newSettings: any = { ...settings };
    const parts = field.split('.');
    if (parts.length === 1) {
      newSettings[parts[0]] = value;
    } else if (parts.length === 2) {
      newSettings[parts[0]] = { ...newSettings[parts[0]], [parts[1]]: value };
    } else {
      // 3+ levels (e.g., pi-coding-agent.model.provider)
      let cursor = newSettings;
      for (let i = 0; i < parts.length - 1; i++) {
        cursor[parts[i]] = { ...cursor[parts[i]] };
        cursor = cursor[parts[i]];
      }
      cursor[parts[parts.length - 1]] = value;
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
            value={localBotName}
            onChange={(e) => setLocalBotName(e.target.value)}
            onBlur={() => {
              if (localBotName !== botName) {
                updateBotName(localBotName);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur();
              }
            }}
            placeholder="Assistant"
            className="w-full sm:w-48 bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-neutral-200 text-sm focus:outline-none focus:border-blue-600 transition-colors"
          />
          <span className="text-xs text-neutral-600">@mentions become @{localBotName || 'Assistant'}</span>
        </div>
      </section>

      {/* ── System ── */}
      <section className="bg-neutral-900 border border-neutral-800 rounded-xl p-5">
        <h3 className="text-base font-semibold text-white mb-1">System</h3>
        <p className="text-xs text-neutral-600 mb-4">Core system settings for scheduling and datetime display.</p>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 py-3">
          <label className="text-sm text-neutral-400 sm:w-48 sm:shrink-0">Timezone</label>
          {renderSelect(settings.timezone || 'America/Toronto', (val) => updateSetting('timezone', val), TIMEZONE_OPTIONS)}
          <span className="text-xs text-neutral-600">Used for scheduler + datetime in prompts</span>
        </div>
      </section>

      {/* ── Memory ── */}
      <section className="bg-neutral-900 border border-neutral-800 rounded-xl p-5">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-base font-semibold text-white">Memory</h3>
          {!editingChunkModel ? (
            <div className="flex gap-3">
              {settings.memory?.chunkContextualizerModel && (
                <button onClick={resetChunkModel} className="text-xs text-red-400 hover:text-red-300 transition-colors">
                  Reset to default
                </button>
              )}
              <button onClick={() => setEditingChunkModel(true)} className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
                Edit
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => setEditingChunkModel(false)} className="text-xs text-neutral-400 hover:text-neutral-300">Cancel</button>
              <button
                onClick={saveChunkModel}
                disabled={savingChunkModel || !chunkProvider || !chunkModelName}
                className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-md transition-colors"
              >
                {savingChunkModel ? 'Saving...' : 'Save'}
              </button>
            </div>
          )}
        </div>
        <p className="text-xs text-neutral-600 mb-4">Model that writes the 1–2 sentence context prepended to each chunk before embedding. Routes via OpenRouter if OPENROUTER_API_KEY is set, else native OpenAI.</p>

        {!editingChunkModel ? (
          <div className="bg-neutral-900/50 border border-neutral-800 rounded-md p-3 font-mono text-sm space-y-1">
            <div className="flex gap-2">
              <span className="text-neutral-500">Chunk Contextualizer:</span>
              {settings.memory?.chunkContextualizerModel ? (
                <span className="text-purple-400">{settings.memory.chunkContextualizerModel.provider}/{settings.memory.chunkContextualizerModel.name}</span>
              ) : (
                <span className="text-neutral-500">{CHUNK_CONTEXTUALIZER_DEFAULT.provider}/{CHUNK_CONTEXTUALIZER_DEFAULT.name} <span className="text-neutral-700">(default)</span></span>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <label className="text-sm text-neutral-400 sm:w-24 shrink-0">Provider</label>
              <select className={selectClass} value={chunkProvider} onChange={(e) => handleChunkProviderChange(e.target.value)}>
                <option value="">Select provider...</option>
                {chunkProviders.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <label className="text-sm text-neutral-400 sm:w-24 shrink-0">Model</label>
              {chunkLoadingModels ? (
                <span className="text-xs text-neutral-600">Loading models...</span>
              ) : (
                <select className={selectClass} value={chunkModelName} onChange={(e) => setChunkModelName(e.target.value)}>
                  <option value="">Select model...</option>
                  {chunkModels.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
                </select>
              )}
            </div>
          </div>
        )}
      </section>

      {/* ── Default Settings ── */}
      <section className="bg-neutral-900 border border-neutral-800 rounded-xl p-5">
        <h3 className="text-base font-semibold text-white mb-1">Default Settings</h3>
        <p className="text-xs text-neutral-600 mb-4">Baseline defaults — channels and sessions inherit from here.</p>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 py-3 border-b border-neutral-800/50">
          <label className="text-sm text-neutral-400 sm:w-48 sm:shrink-0">Harness</label>
          {renderSegmented(settings.harness || 'pi-coding-agent', (val) => updateSetting('harness', val), HARNESSES)}
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

      {/* ── Custom Instructions ── */}
      <section className="bg-neutral-900 border border-neutral-800 rounded-xl p-5">
        <h3 className="text-base font-semibold text-white mb-1">Custom Instructions</h3>
        <p className="text-xs text-neutral-600 mb-4">Additional instructions injected into the system prompt. Channels and sessions can override this.</p>

        <textarea
          ref={textareaRef}
          value={localCustomInstructions}
          onChange={(e) => setLocalCustomInstructions(e.target.value)}
          onBlur={() => {
            if (localCustomInstructions !== (settings.customInstructions || '')) {
              updateSetting('customInstructions', localCustomInstructions || undefined);
            }
          }}
          placeholder="e.g., Always respond in Italian when discussing food..."
          rows={3}
          className="w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-neutral-200 text-sm focus:outline-none focus:border-blue-600 transition-colors resize-none overflow-hidden"
        />
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
