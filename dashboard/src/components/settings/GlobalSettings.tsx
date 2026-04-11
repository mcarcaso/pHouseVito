import { useState, useEffect, useRef } from 'react';

import { type ModelChoice, type VitoConfig } from '../../utils/settingsResolution';
import { getDefaults } from '../../utils/defaults';
import { renderSelect, renderSegmented, renderNumberInput, renderSliderToggle } from './SettingRow';
import HarnessConfigEditor from './HarnessConfigEditor';

// Compact provider/model picker for the auto classifier model.
// Reuses the /api/models/* endpoints that HarnessConfigEditor uses.
function ClassifierModelPicker({
  value,
  onChange,
}: {
  value: { provider: string; name: string };
  onChange: (next: { provider: string; name: string }) => void;
}) {
  const [providers, setProviders] = useState<string[]>([]);
  const [models, setModels] = useState<{ id: string }[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  useEffect(() => {
    fetch('/api/models/providers')
      .then((r) => r.json())
      .then((data) => {
        const auth = data.authStatus || {};
        const all: string[] = data.providers || [];
        // Only show providers we actually have credentials for.
        setProviders(all.filter((p) => auth[p]?.hasAuth === true));
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (!value.provider) return;
    setLoadingModels(true);
    fetch(`/api/models/${value.provider}`)
      .then((r) => r.json())
      .then((data) => setModels(Array.isArray(data) ? data : []))
      .catch(() => setModels([]))
      .finally(() => setLoadingModels(false));
  }, [value.provider]);

  const selectClass =
    "bg-neutral-950 border border-neutral-700 rounded-md px-2 py-1.5 text-neutral-200 text-xs focus:outline-none focus:border-blue-600 transition-colors cursor-pointer";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        className={selectClass}
        value={value.provider}
        onChange={(e) => onChange({ provider: e.target.value, name: '' })}
      >
        <option value="">Select provider...</option>
        {providers.map((p) => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>
      {value.provider && (
        loadingModels ? (
          <span className="text-xs text-neutral-600">Loading models...</span>
        ) : (
          <select
            className={selectClass}
            value={value.name}
            onChange={(e) => onChange({ provider: value.provider, name: e.target.value })}
          >
            <option value="">Select model...</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>{m.id}</option>
            ))}
          </select>
        )
      )}
    </div>
  );
}

interface GlobalSettingsProps {
  config: VitoConfig;
  onSave: (updates: Partial<VitoConfig>) => Promise<void>;
}

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
function NumberRow({ label, hint, value, onChange, min, max, step, auto, onAutoChange }: {
  label: string;
  hint?: string;
  value: number;
  onChange: (val: number) => void;
  min?: number;
  max?: number;
  step?: number;
  auto?: boolean;
  onAutoChange?: (val: boolean) => void;
}) {
  const hasAuto = onAutoChange !== undefined;
  const disabled = hasAuto && !!auto;
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 py-3 border-b border-neutral-800/50">
      <label className="text-sm text-neutral-400 sm:w-48 sm:shrink-0">{label}</label>
      <div className={disabled ? 'opacity-40 pointer-events-none' : ''}>
        {renderNumberInput(value, onChange, { min, max, step })}
      </div>
      {hint && <span className="text-xs text-neutral-600">{hint}</span>}
      {hasAuto && (
        <label className="flex items-center gap-1.5 cursor-pointer select-none sm:ml-auto">
          <span className="text-xs text-neutral-500 uppercase tracking-wide">Auto</span>
          {renderSliderToggle(!!auto, onAutoChange!)}
        </label>
      )}
    </div>
  );
}

const STREAM_MODES = [
  { value: 'stream', label: 'Stream' },
  { value: 'bundled', label: 'Bundled' },
  { value: 'final', label: 'Final' },
];

const TIMEZONE_OPTIONS = [
  { value: 'America/Toronto', label: 'Eastern (Toronto)' },
  { value: 'America/New_York', label: 'Eastern (New York)' },
  { value: 'America/Chicago', label: 'Central (Chicago)' },
  { value: 'America/Denver', label: 'Mountain (Denver)' },
  { value: 'America/Los_Angeles', label: 'Pacific (Los Angeles)' },
  { value: 'America/Vancouver', label: 'Pacific (Vancouver)' },
  { value: 'Europe/London', label: 'London (GMT/BST)' },
  { value: 'Europe/Paris', label: 'Central Europe (Paris)' },
  { value: 'Europe/Berlin', label: 'Central Europe (Berlin)' },
  { value: 'Asia/Tokyo', label: 'Japan (Tokyo)' },
  { value: 'Asia/Shanghai', label: 'China (Shanghai)' },
  { value: 'Asia/Singapore', label: 'Singapore' },
  { value: 'Australia/Sydney', label: 'Sydney' },
  { value: 'Australia/Melbourne', label: 'Melbourne' },
  { value: 'UTC', label: 'UTC' },
];


// ── Model Choices Editor ──────────────────────────────────────────────────────

interface ModelChoicesEditorProps {
  choices: ModelChoice[];
  onChange: (next: ModelChoice[]) => void;
}

interface EditingChoice {
  provider: string;
  name: string;
  description: string;
}

const emptyChoice = (): EditingChoice => ({ provider: '', name: '', description: '' });

const choiceFormInputCls = "w-full bg-neutral-950 border border-neutral-700 rounded-md px-2.5 py-1.5 text-neutral-200 text-xs focus:outline-none focus:border-blue-600 transition-colors";
const choiceFormSelectCls = `${choiceFormInputCls} cursor-pointer`;

// Top-level so its identity is stable across re-renders. If this lived inside
// ModelChoicesEditor's body, every keystroke (which calls setDraft) would
// re-create the function, React would unmount/remount the inputs, and the
// focused input would lose focus on every keystroke.
function ChoiceForm({
  draft,
  setDraft,
  availableProviders,
  providerModels,
  loadingModels,
  onProviderChange,
  onConfirm,
  onCancel,
  confirmLabel,
}: {
  draft: EditingChoice;
  setDraft: React.Dispatch<React.SetStateAction<EditingChoice>>;
  availableProviders: string[];
  providerModels: { id: string }[];
  loadingModels: boolean;
  onProviderChange: (provider: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel: string;
}) {
  return (
    <div className="space-y-2 pt-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-neutral-500 mb-1 block">Provider</label>
          <select
            className={choiceFormSelectCls}
            value={draft.provider}
            onChange={(e) => onProviderChange(e.target.value)}
          >
            <option value="">Select provider...</option>
            {availableProviders.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-neutral-500 mb-1 block">Model</label>
          {providerModels.length > 0 ? (
            <select
              className={choiceFormSelectCls}
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            >
              <option value="">Select model...</option>
              {providerModels.map((m) => (
                <option key={m.id} value={m.id}>{m.id}</option>
              ))}
            </select>
          ) : (
            <input
              className={choiceFormInputCls}
              placeholder={loadingModels ? 'Loading...' : 'model-name'}
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            />
          )}
        </div>
      </div>
      <div>
        <label className="text-xs text-neutral-500 mb-1 block">Description <span className="text-neutral-600">(when should this model be picked?)</span></label>
        <textarea
          className={`${choiceFormInputCls} resize-none`}
          rows={2}
          placeholder="e.g. Cheapest, fastest. Pick for chit-chat and simple lookups."
          value={draft.description}
          onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
        />
      </div>
      <div className="flex gap-2 pt-1">
        <button
          onClick={onConfirm}
          disabled={!draft.provider || !draft.name}
          className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-md transition-colors"
        >
          {confirmLabel}
        </button>
        <button onClick={onCancel} className="px-3 py-1 text-xs text-neutral-400 hover:text-neutral-200 transition-colors">
          Cancel
        </button>
      </div>
    </div>
  );
}

function ModelChoicesEditor({ choices, onChange }: ModelChoicesEditorProps) {
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [draft, setDraft] = useState<EditingChoice>(emptyChoice());
  const [availableProviders, setAvailableProviders] = useState<string[]>([]);
  const [providerModels, setProviderModels] = useState<{ id: string }[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  // Load providers we have credentials for. /api/models/providers returns
  // { providers, authStatus } — only show ones with hasAuth === true.
  useEffect(() => {
    fetch('/api/models/providers')
      .then((r) => r.json())
      .then((data) => {
        const all: string[] = data.providers || [];
        const auth: Record<string, { hasAuth?: boolean }> = data.authStatus || {};
        setAvailableProviders(all.filter((p) => auth[p]?.hasAuth === true));
      })
      .catch(() => {});
  }, []);

  const loadModels = async (provider: string) => {
    if (!provider) { setProviderModels([]); return; }
    setLoadingModels(true);
    try {
      const res = await fetch(`/api/models/${provider}`);
      const data = await res.json();
      setProviderModels(Array.isArray(data) ? data : []);
    } catch {
      setProviderModels([]);
    }
    setLoadingModels(false);
  };

  const startEdit = (i: number) => {
    setAddingNew(false);
    setEditingIdx(i);
    setDraft({ ...choices[i] });
    loadModels(choices[i].provider);
  };

  const startAdd = () => {
    setEditingIdx(null);
    setAddingNew(true);
    setDraft(emptyChoice());
    setProviderModels([]);
  };

  const cancel = () => { setEditingIdx(null); setAddingNew(false); };

  const saveEdit = () => {
    if (!draft.provider || !draft.name) return;
    const next = [...choices];
    next[editingIdx!] = { ...draft };
    onChange(next);
    cancel();
  };

  const saveNew = () => {
    if (!draft.provider || !draft.name) return;
    onChange([...choices, { ...draft }]);
    cancel();
  };

  const remove = (i: number) => {
    const next = choices.filter((_, idx) => idx !== i);
    onChange(next);
    if (editingIdx === i) cancel();
  };

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= choices.length) return;
    const next = [...choices];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
    if (editingIdx === i) setEditingIdx(j);
    else if (editingIdx === j) setEditingIdx(i);
  };

  const onProviderChange = (provider: string) => {
    setDraft((d) => ({ ...d, provider, name: '' }));
    loadModels(provider);
  };

  return (
    <div className="pt-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-neutral-500 uppercase tracking-wide">Candidate Models</span>
        {!addingNew && editingIdx === null && (
          <button
            onClick={startAdd}
            className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
          >
            + Add Model
          </button>
        )}
      </div>

      <ul className="space-y-2">
        {choices.map((c, i) => (
          <li key={`${c.provider}/${c.name}/${i}`} className="bg-neutral-950/60 border border-neutral-800 rounded-md p-3">
            {editingIdx === i ? (
              <ChoiceForm
                draft={draft}
                setDraft={setDraft}
                availableProviders={availableProviders}
                providerModels={providerModels}
                loadingModels={loadingModels}
                onProviderChange={onProviderChange}
                onConfirm={saveEdit}
                onCancel={cancel}
                confirmLabel="Save"
              />
            ) : (
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-xs text-purple-400 truncate">{c.provider}/{c.name}</div>
                  {c.description && <div className="text-xs text-neutral-500 mt-0.5">{c.description}</div>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    className="p-1 text-neutral-600 hover:text-neutral-300 disabled:opacity-30 transition-colors"
                    title="Move up"
                  >↑</button>
                  <button
                    onClick={() => move(i, 1)}
                    disabled={i === choices.length - 1}
                    className="p-1 text-neutral-600 hover:text-neutral-300 disabled:opacity-30 transition-colors"
                    title="Move down"
                  >↓</button>
                  <button
                    onClick={() => startEdit(i)}
                    className="p-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                  >Edit</button>
                  <button
                    onClick={() => remove(i)}
                    className="p-1 text-xs text-red-500 hover:text-red-400 transition-colors"
                  >✕</button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      {addingNew && (
        <div className="mt-2 bg-neutral-950/60 border border-blue-800/40 rounded-md p-3">
          <div className="text-xs text-blue-400 mb-1 font-medium">New Candidate Model</div>
          <ChoiceForm
            draft={draft}
            setDraft={setDraft}
            availableProviders={availableProviders}
            providerModels={providerModels}
            loadingModels={loadingModels}
            onProviderChange={onProviderChange}
            onConfirm={saveNew}
            onCancel={cancel}
            confirmLabel="Add"
          />
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function GlobalSettings({ config, onSave }: GlobalSettingsProps) {
  const settings = config.settings || {};
  const botName = config.bot?.name || '';
  const [localBotName, setLocalBotName] = useState(botName);
  const [localCustomInstructions, setLocalCustomInstructions] = useState(settings.customInstructions || '');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync local state when config changes externally
  useEffect(() => {
    setLocalBotName(config.bot?.name || '');
  }, [config.bot?.name]);

  useEffect(() => {
    setLocalCustomInstructions(config.settings?.customInstructions || '');
  }, [config.settings?.customInstructions]);

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
      // 3+ levels (e.g., auto.currentContext.limit)
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

      {/* ── Default Settings ── */}
      <section className="bg-neutral-900 border border-neutral-800 rounded-xl p-5">
        <h3 className="text-base font-semibold text-white mb-1">Default Settings</h3>
        <p className="text-xs text-neutral-600 mb-4">Baseline defaults — channels and sessions inherit from here.</p>

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

      {/* ── Current Session Context ── */}
      <section className="bg-neutral-900 border border-neutral-800 rounded-xl p-5">
        <h3 className="text-base font-semibold text-white mb-1">Current Session Context</h3>
        <p className="text-xs text-neutral-600 mb-4">What to include from the active session's history. Turn on <span className="text-blue-400">Auto</span> to have a cheap classifier pick the value per turn.</p>

        <NumberRow
          label="Num Messages"
          hint="Recent messages to include"
          value={settings.currentContext?.limit ?? 100}
          onChange={(val) => updateSetting('currentContext.limit', val)}
          min={0}
          auto={settings.auto?.currentContext?.limit ?? false}
          onAutoChange={(val) => updateSetting('auto.currentContext.limit', val)}
        />

        <ToggleRow
          title="Thoughts"
          description="Include thinking/reasoning steps"
          value={settings.currentContext?.includeThoughts ?? true}
          onChange={(val) => updateSetting('currentContext.includeThoughts', val)}
          auto={settings.auto?.currentContext?.includeThoughts ?? false}
          onAutoChange={(val) => updateSetting('auto.currentContext.includeThoughts', val)}
        />

        <ToggleRow
          title="Tools"
          description="Include tool calls and results"
          value={settings.currentContext?.includeTools ?? true}
          onChange={(val) => updateSetting('currentContext.includeTools', val)}
          auto={settings.auto?.currentContext?.includeTools ?? false}
          onAutoChange={(val) => updateSetting('auto.currentContext.includeTools', val)}
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
          <label className="text-sm text-neutral-400 sm:w-48 sm:shrink-0">Max Sessions</label>
          {renderNumberInput(
            settings.crossContext?.maxSessions ?? 15,
            (val) => updateSetting('crossContext.maxSessions', val),
            { min: 0 }
          )}
          <span className="text-xs text-neutral-600">Sessions to pull from (0 = unlimited)</span>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 py-3 border-b border-neutral-800/50">
          <label className="text-sm text-neutral-400 sm:w-48 sm:shrink-0">Num Messages</label>
          {renderNumberInput(
            settings.crossContext?.limit ?? 5,
            (val) => updateSetting('crossContext.limit', val),
            { min: 0 }
          )}
          <span className="text-xs text-neutral-600">Messages per session</span>
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

        <NumberRow
          label="Recalled Memory Limit"
          hint="Max memory chunks to inject (0 to disable)"
          value={settings.memory?.recalledMemoryLimit ?? 3}
          onChange={(val) => updateSetting('memory.recalledMemoryLimit', val)}
          min={0}
          max={10}
          auto={settings.auto?.memory?.recalledMemoryLimit ?? false}
          onAutoChange={(val) => updateSetting('auto.memory.recalledMemoryLimit', val)}
        />

        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 py-3 border-b border-neutral-800/50">
          <label className="text-sm text-neutral-400 sm:w-48 sm:shrink-0">Relevance Threshold</label>
          {renderNumberInput(
            settings.memory?.recalledMemoryThreshold ?? 0.005,
            (val) => updateSetting('memory.recalledMemoryThreshold', val),
            { min: 0, max: 1, step: 0.001 }
          )}
          <span className="text-xs text-neutral-600">Min RRF score (lower = more results)</span>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 py-3 border-b border-neutral-800/50">
          <label className="text-sm text-neutral-400 sm:w-48 sm:shrink-0">Profile Update Context</label>
          {renderNumberInput(
            settings.memory?.profileUpdateContext ?? 2,
            (val) => updateSetting('memory.profileUpdateContext', val),
            { min: 1, max: 10 }
          )}
          <span className="text-xs text-neutral-600">Messages of context for profile updates</span>
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

      {/* ── Auto Classifier ── */}
      <section className="bg-neutral-900 border border-neutral-800 rounded-xl p-5">
        <h3 className="text-base font-semibold text-white mb-1">Auto Classifier</h3>
        <p className="text-xs text-neutral-600 mb-4">When a field's Auto toggle is on, the classifier model below picks its value per turn based on the incoming message — overriding the configured value only for that turn. Toggles for message limits, thoughts/tools inclusion, and memory recall live inline in the sections above.</p>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 py-3 border-b border-neutral-800/50">
          <div className="flex flex-col sm:w-48 sm:shrink-0">
            <span className="text-sm text-neutral-200">Classifier Model</span>
            <span className="text-xs text-neutral-500">Cheap, fast model used for every classifier call</span>
          </div>
          <ClassifierModelPicker
            value={settings.auto?.classifierModel ?? getDefaults().auto.classifierModel}
            onChange={(next) => updateSetting('auto.classifierModel', next)}
          />
        </div>

        <div className="flex items-center justify-between gap-4 py-3 border-b border-neutral-800/50">
          <div className="flex flex-col">
            <span className="text-sm text-neutral-200">Pi Coding Agent: Model</span>
            <span className="text-xs text-neutral-500">Auto-pick one of the candidate models below per turn (overrides the pi-coding-agent model)</span>
          </div>
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <span className="text-xs text-neutral-500 uppercase tracking-wide">Auto</span>
            {renderSliderToggle(
              settings.auto?.['pi-coding-agent']?.model ?? false,
              (val) => updateSetting('auto.pi-coding-agent.model', val)
            )}
          </label>
        </div>

        {/* Editable candidate models list */}
        <ModelChoicesEditor
          choices={settings.auto?.['pi-coding-agent']?.modelChoices ?? getDefaults().auto['pi-coding-agent'].modelChoices}
          onChange={(next) => updateSetting('auto.pi-coding-agent.modelChoices', next)}
        />
      </section>
    </div>
  );
}
