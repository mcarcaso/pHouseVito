import { useEffect, useState } from "react";
import type { ModelConfig } from "../../../../src/shared/schemas/vito-config";
import { useModels, useProviders } from "../../hooks/useProviders";
import { errorMessage } from "../../lib/api-client";
import type { InheritSource } from "../../utils/settingsResolution";

interface ModelSettingsFieldProps {
  label: string;
  hint?: string;
  mode: "base" | "override";
  inherited?: ModelConfig;
  inheritedFrom: InheritSource;
  value?: ModelConfig;
  onSave: (model: ModelConfig) => Promise<void>;
  onReset: () => Promise<void>;
}

export default function ModelSettingsField({
  label,
  hint,
  mode,
  inherited,
  inheritedFrom,
  value,
  onSave,
  onReset,
}: ModelSettingsFieldProps) {
  const effective = value ?? inherited;
  const [editing, setEditing] = useState(false);
  const [provider, setProvider] = useState(effective?.provider ?? "");
  const [model, setModel] = useState(effective?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const providersQuery = useProviders();
  const modelsQuery = useModels(provider);

  useEffect(() => {
    if (editing) return;
    setProvider(effective?.provider ?? "");
    setModel(effective?.name ?? "");
  }, [editing, effective?.name, effective?.provider]);

  const availableProviders = (providersQuery.data?.providers ?? []).filter(
    (candidate) => providersQuery.data?.authStatus[candidate]?.hasAuth === true,
  );
  if (provider && !availableProviders.includes(provider)) availableProviders.unshift(provider);

  const beginEdit = () => {
    setProvider(effective?.provider ?? "");
    setModel(effective?.name ?? "");
    setSaveError(null);
    setEditing(true);
  };

  const save = async () => {
    if (!provider || !model) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave({ provider, name: model });
      setEditing(false);
    } catch (error: unknown) {
      setSaveError(errorMessage(error, "Failed to save model"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="py-3 border-b border-neutral-800/50">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm text-neutral-300">{label}</div>
          {hint && <div className="text-xs text-neutral-600 mt-0.5">{hint}</div>}
          {!editing && (
            <div className="text-xs mt-1 font-mono text-neutral-400 truncate">
              {effective ? `${effective.provider}/${effective.name}` : "Not configured"}
              {mode === "override" && (
                <span className="ml-2 font-sans text-neutral-600">
                  {value ? "override" : `from ${inheritedFrom}`}
                </span>
              )}
            </div>
          )}
        </div>
        {!editing && (
          <div className="flex items-center gap-3 shrink-0">
            {mode === "override" && value && (
              <button
                onClick={() => void onReset()}
                className="text-xs text-neutral-500 hover:text-red-400 transition-colors"
              >
                Reset
              </button>
            )}
            <button
              onClick={beginEdit}
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              {value || mode === "base" ? "Edit" : "Override"}
            </button>
          </div>
        )}
      </div>

      {editing && (
        <div className="mt-3 space-y-2">
          {providersQuery.isError ? (
            <div className="text-xs text-red-400">
              {errorMessage(providersQuery.error, "Failed to load providers")}
            </div>
          ) : (
            <select
              value={provider}
              onChange={(event) => {
                setProvider(event.target.value);
                setModel("");
              }}
              className="w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-neutral-200 text-sm focus:outline-none focus:border-blue-600"
            >
              <option value="">Select provider...</option>
              {availableProviders.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {candidate}
                </option>
              ))}
            </select>
          )}
          <select
            value={model}
            onChange={(event) => setModel(event.target.value)}
            disabled={!provider || modelsQuery.isFetching}
            className="w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-neutral-200 text-sm focus:outline-none focus:border-blue-600 disabled:opacity-50"
          >
            <option value="">
              {modelsQuery.isFetching ? "Loading models..." : "Select model..."}
            </option>
            {(modelsQuery.data ?? []).map(({ id }) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
          {saveError && <div className="text-xs text-red-400">{saveError}</div>}
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setEditing(false)}
              className="px-3 py-1.5 text-xs text-neutral-400 hover:text-neutral-300"
            >
              Cancel
            </button>
            <button
              onClick={() => void save()}
              disabled={saving || !provider || !model}
              className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-md"
            >
              {saving ? "Saving..." : mode === "base" ? "Save" : "Save override"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
