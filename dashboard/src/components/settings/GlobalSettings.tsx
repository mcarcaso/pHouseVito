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
