import { useState, useEffect, useRef, type ReactNode } from 'react';
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

function NumberField({ value, onChange, min, max, step, className }: {
  value: any;
  onChange: (val: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
}) {
  const [local, setLocal] = useState(String(value ?? ''));

  useEffect(() => {
    setLocal(String(value ?? ''));
  }, [value]);

  const commit = () => {
    const num = step != null && step < 1 ? parseFloat(local) : parseInt(local);
    if (isNaN(num) || local === '') {
      setLocal(String(value ?? ''));
    } else {
      onChange(num);
    }
  };

  return (
    <input
      type="number"
      className={className}
      value={local}
      min={min}
      max={max}
      step={step}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
    />
  );
}

export function renderNumberInput(
  value: any,
  onChange: (val: any) => void,
  opts?: { min?: number; max?: number; step?: number }
) {
  return (
    <NumberField
      className={inputClass + ' w-24'}
      value={value}
      onChange={onChange}
      min={opts?.min}
      max={opts?.max}
      step={opts?.step}
    />
  );
}

export function renderSegmented(
  value: any,
  onChange: (val: any) => void,
  options: { value: string; label: string }[]
) {
  return (
    <div className="inline-flex rounded-md overflow-hidden border border-neutral-700 shrink-0 w-fit">
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

export function renderToggle(value: boolean, onChange: (val: boolean) => void) {
  return (
    <div className="flex rounded-md overflow-hidden border border-neutral-700 shrink-0">
      <button
        className={`px-3 py-1.5 text-xs transition-colors border-r border-neutral-700 whitespace-nowrap ${
          value
            ? 'bg-blue-950 text-blue-400'
            : 'bg-neutral-900 text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800'
        }`}
        onClick={() => onChange(true)}
      >
        On
      </button>
      <button
        className={`px-3 py-1.5 text-xs transition-colors whitespace-nowrap ${
          !value
            ? 'bg-blue-950 text-blue-400'
            : 'bg-neutral-900 text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800'
        }`}
        onClick={() => onChange(false)}
      >
        Off
      </button>
    </div>
  );
}

export function renderTextarea(
  value: string,
  onChange: (val: string) => void,
  opts?: { placeholder?: string; rows?: number }
) {
  return (
    <AutoResizeTextarea
      value={value}
      onChange={onChange}
      placeholder={opts?.placeholder}
      rows={opts?.rows}
    />
  );
}

function AutoResizeTextarea({ value, onChange, placeholder, rows = 2 }: {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  const [local, setLocal] = useState(value || '');
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setLocal(value || '');
  }, [value]);

  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = 'auto';
      ref.current.style.height = ref.current.scrollHeight + 'px';
    }
  }, [local]);

  return (
    <textarea
      ref={ref}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        if (local !== (value || '')) onChange(local);
      }}
      placeholder={placeholder || ''}
      rows={rows}
      className="w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-1.5 text-neutral-200 text-sm focus:outline-none focus:border-blue-600 transition-colors resize-none overflow-hidden"
    />
  );
}

export function renderSliderToggle(value: boolean, onChange: (val: boolean) => void) {
  return (
    <label className="relative inline-block w-11 h-6 cursor-pointer shrink-0">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="opacity-0 w-0 h-0 peer"
      />
      <span className="absolute inset-0 bg-neutral-700 rounded-full transition-colors peer-checked:bg-blue-800" />
      <span className="absolute left-[3px] top-[3px] w-[18px] h-[18px] bg-neutral-400 rounded-full transition-all peer-checked:translate-x-5 peer-checked:bg-blue-400" />
    </label>
  );
}
