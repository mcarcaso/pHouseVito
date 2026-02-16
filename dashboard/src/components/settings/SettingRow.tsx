import type { ReactNode } from 'react';
import type { InheritSource } from '../../utils/settingsResolution';

interface SettingRowProps {
  label: string;
  hint?: string;
  /** The inherited value from the parent level */
  inheritedValue?: any;
  /** Which level the inherited value comes from */
  inheritedFrom?: InheritSource;
  /** Current override value at this level (undefined = not overridden) */
  overrideValue?: any;
  /** Called when user wants to add an override */
  onOverride: (value: any) => void;
  /** Called when user wants to remove the override */
  onReset: () => void;
  /** Render the editable input for this setting */
  renderInput: (value: any, onChange: (val: any) => void) => ReactNode;
  /** Format a value for display (when showing inherited) */
  formatValue?: (value: any) => string;
}

const SOURCE_LABELS: Record<InheritSource, string> = {
  default: 'default',
  global: 'Global',
  channel: 'Channel',
  session: 'Session',
};

export default function SettingRow({
  label,
  hint,
  inheritedValue,
  inheritedFrom = 'default',
  overrideValue,
  onOverride,
  onReset,
  renderInput,
  formatValue = (v) => String(v ?? '—'),
}: SettingRowProps) {
  const isOverridden = overrideValue !== undefined;

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 py-3 border-b border-neutral-800/50 last:border-b-0">
      <div className="sm:w-48 sm:shrink-0">
        <label className="text-sm text-neutral-300">{label}</label>
        {hint && <p className="text-xs text-neutral-600 mt-0.5">{hint}</p>}
      </div>

      <div className="flex-1 flex items-center gap-3 min-w-0">
        {isOverridden ? (
          <>
            {renderInput(overrideValue, onOverride)}
            <span className="text-xs text-neutral-600 whitespace-nowrap shrink-0">
              inherits: {formatValue(inheritedValue)}
            </span>
            <button
              onClick={onReset}
              className="text-xs text-red-400 hover:text-red-300 transition-colors whitespace-nowrap shrink-0"
            >
              Reset
            </button>
          </>
        ) : (
          <>
            <span className="text-sm text-neutral-500">
              {formatValue(inheritedValue)}
            </span>
            <span className="text-xs text-neutral-600 whitespace-nowrap">
              from {SOURCE_LABELS[inheritedFrom]}
            </span>
            <button
              onClick={() => onOverride(inheritedValue)}
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors whitespace-nowrap shrink-0"
            >
              Override
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Reusable input renderers ──

const selectClass = "bg-neutral-950 border border-neutral-700 rounded-md px-3 py-1.5 text-neutral-200 text-sm focus:outline-none focus:border-blue-600 transition-colors cursor-pointer appearance-none bg-[url('data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2210%22%20height%3D%2210%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%23666%22%20d%3D%22M6%208L1%203h10z%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_0.75rem_center] pr-8";
const inputClass = "bg-neutral-950 border border-neutral-700 rounded-md px-3 py-1.5 text-neutral-200 text-sm focus:outline-none focus:border-blue-600 transition-colors";

export function renderSelect(
  value: any,
  onChange: (val: any) => void,
  options: { value: string; label: string }[]
) {
  return (
    <select className={selectClass} value={value || ''} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export function renderNumberInput(
  value: any,
  onChange: (val: any) => void,
  opts?: { min?: number; max?: number }
) {
  return (
    <input
      type="number"
      className={inputClass + ' w-24'}
      value={value ?? ''}
      min={opts?.min}
      max={opts?.max}
      onChange={(e) => {
        const num = parseInt(e.target.value);
        if (!isNaN(num)) onChange(num);
      }}
    />
  );
}

export function renderSegmented(
  value: any,
  onChange: (val: any) => void,
  options: { value: string; label: string }[]
) {
  return (
    <div className="flex rounded-md overflow-hidden border border-neutral-700 shrink-0">
      {options.map((opt) => (
        <button
          key={opt.value}
          className={`px-2 sm:px-3 py-1.5 text-xs transition-colors border-r border-neutral-700 last:border-r-0 whitespace-nowrap ${
            value === opt.value
              ? 'bg-blue-950 text-blue-400'
              : 'bg-neutral-900 text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800'
          }`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
