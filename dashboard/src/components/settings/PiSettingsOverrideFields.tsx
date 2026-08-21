import { useEffect, useState } from "react";
import type { PiRuntimeConfig } from "../../../../src/shared/schemas/vito-config";
import { useModels, useProviders } from "../../hooks/useProviders";
import { errorMessage } from "../../lib/api-client";
import type { InheritSource } from "../../utils/settingsResolution";
import SettingRow, { renderSelect } from "./SettingRow";
import {
  OPENROUTER_PROVIDER_OPTIONS,
  THINKING_LEVEL_OPTIONS,
  type SettingsPath,
  type SettingsUpdate,
} from "./settings-values";

interface PiSettingsOverrideFieldsProps {
  mode?: "base" | "override";
  inherited?: Partial<PiRuntimeConfig>;
  inheritedFrom: InheritSource;
  overrides?: Partial<PiRuntimeConfig>;
  onUpdate: (update: SettingsUpdate) => Promise<void>;
  onReset: (path: SettingsPath) => Promise<void>;
}

const POPULAR_PROVIDERS = [
  "anthropic",
  "openai",
  "openai-codex",
  "google",
  "xai",
  "groq",
  "mistral",
  "openrouter",
];

export default function PiSettingsOverrideFields({
  mode = "override",
  inherited,
  inheritedFrom,
  overrides = {},
  onUpdate,
  onReset,
}: PiSettingsOverrideFieldsProps) {
  const effectiveModel = overrides.model ?? inherited?.model;
  const [editingModel, setEditingModel] = useState(false);
  const [draftProvider, setDraftProvider] = useState(effectiveModel?.provider ?? "");
  const [draftModel, setDraftModel] = useState(effectiveModel?.name ?? "");
  const [savingModel, setSavingModel] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const providersQuery = useProviders();
  const modelsQuery = useModels(draftProvider);

  useEffect(() => {
    if (editingModel) return;
    setDraftProvider(effectiveModel?.provider ?? "");
    setDraftModel(effectiveModel?.name ?? "");
  }, [editingModel, effectiveModel?.provider, effectiveModel?.name]);

  const authenticatedProviders = (providersQuery.data?.providers ?? []).filter(
    (provider) => providersQuery.data?.authStatus[provider]?.hasAuth === true,
  );
  const providers = [
    ...POPULAR_PROVIDERS.filter((provider) => authenticatedProviders.includes(provider)),
    ...authenticatedProviders.filter((provider) => !POPULAR_PROVIDERS.includes(provider)).sort(),
  ];
  if (draftProvider && !providers.includes(draftProvider)) providers.unshift(draftProvider);

  const beginModelEdit = () => {
    setDraftProvider(effectiveModel?.provider ?? "");
    setDraftModel(effectiveModel?.name ?? "");
    setModelError(null);
    setEditingModel(true);
  };

  const saveModel = async () => {
    if (!draftProvider || !draftModel) return;
    setSavingModel(true);
    setModelError(null);
    try {
      await onUpdate({
        path: "pi-coding-agent.model",
        value: { provider: draftProvider, name: draftModel },
      });
      setEditingModel(false);
    } catch (error: unknown) {
      setModelError(errorMessage(error, "Failed to save model override"));
    } finally {
      setSavingModel(false);
    }
  };

  return (
    <>
      <div className="py-3 border-b border-neutral-800/50">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm text-neutral-300">Model</div>
            {!editingModel && (
              <div className="text-xs mt-1 font-mono text-neutral-400 truncate">
                {effectiveModel
                  ? `${effectiveModel.provider}/${effectiveModel.name}`
                  : "Not configured"}
                {mode === "override" && (
                  <span className="ml-2 font-sans text-neutral-600">
                    {overrides.model ? "override" : `from ${inheritedFrom}`}
                  </span>
                )}
              </div>
            )}
          </div>
          {!editingModel && (
            <div className="flex items-center gap-3 shrink-0">
              {mode === "override" && overrides.model && (
                <button
                  onClick={() => void onReset("pi-coding-agent.model")}
                  className="text-xs text-neutral-500 hover:text-red-400 transition-colors"
                >
                  Reset
                </button>
              )}
              <button
                onClick={beginModelEdit}
                className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
              >
                {overrides.model || mode === "base" ? "Edit" : "Override"}
              </button>
            </div>
          )}
        </div>

        {editingModel && (
          <div className="mt-3 space-y-2">
            {providersQuery.isError ? (
              <div className="text-xs text-red-400">
                {errorMessage(providersQuery.error, "Failed to load providers")}
              </div>
            ) : (
              <select
                value={draftProvider}
                onChange={(event) => {
                  setDraftProvider(event.target.value);
                  setDraftModel("");
                }}
                className="w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-neutral-200 text-sm focus:outline-none focus:border-blue-600"
              >
                <option value="">Select provider...</option>
                {providers.map((provider) => (
                  <option key={provider} value={provider}>
                    {provider}
                  </option>
                ))}
              </select>
            )}
            <select
              value={draftModel}
              onChange={(event) => setDraftModel(event.target.value)}
              disabled={!draftProvider || modelsQuery.isFetching}
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
            {modelError && <div className="text-xs text-red-400">{modelError}</div>}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setEditingModel(false)}
                className="px-3 py-1.5 text-xs text-neutral-400 hover:text-neutral-300"
              >
                Cancel
              </button>
              <button
                onClick={() => void saveModel()}
                disabled={savingModel || !draftProvider || !draftModel}
                className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-md"
              >
                {savingModel ? "Saving..." : mode === "base" ? "Save" : "Save override"}
              </button>
            </div>
          </div>
        )}
      </div>

      {(effectiveModel?.provider === "openrouter" || draftProvider === "openrouter") && (
        <SettingRow
          mode={mode}
          label="OR Route"
          inheritedValue={inherited?.openRouterProvider || "Auto"}
          inheritedFrom={inheritedFrom}
          overrideValue={overrides.openRouterProvider}
          onOverride={(value) => {
            if (value) void onUpdate({ path: "pi-coding-agent.openRouterProvider", value });
            else void onReset("pi-coding-agent.openRouterProvider");
          }}
          onReset={() => void onReset("pi-coding-agent.openRouterProvider")}
          renderInput={(value, onChange) =>
            renderSelect(value || "", onChange, [...OPENROUTER_PROVIDER_OPTIONS])
          }
        />
      )}

      <SettingRow
        mode={mode}
        label="Thinking Level"
        inheritedValue={inherited?.thinkingLevel || "off"}
        inheritedFrom={inheritedFrom}
        overrideValue={overrides.thinkingLevel}
        onOverride={(value) => void onUpdate({ path: "pi-coding-agent.thinkingLevel", value })}
        onReset={() => void onReset("pi-coding-agent.thinkingLevel")}
        renderInput={(value, onChange) =>
          renderSelect(value, onChange, [...THINKING_LEVEL_OPTIONS])
        }
      />
    </>
  );
}
