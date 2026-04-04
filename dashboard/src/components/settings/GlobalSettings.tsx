import { useState, useEffect, useRef } from 'react';

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

        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 py-3 border-b border-neutral-800/50">
          <label className="text-sm text-neutral-400 sm:w-48 sm:shrink-0">Recalled Memory Limit</label>
          {renderNumberInput(
            settings.memory?.recalledMemoryLimit ?? 3,
            (val) => updateSetting('memory.recalledMemoryLimit', val),
            { min: 0, max: 10 }
          )}
          <span className="text-xs text-neutral-600">Max memory chunks to inject (0 to disable)</span>
        </div>

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
    </div>
  );
}
