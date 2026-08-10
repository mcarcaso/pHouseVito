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
  inherited?: Partial<PiRuntimeConfig>;
  fallback?: Partial<PiRuntimeConfig>;
  inheritedFrom: InheritSource;
  overrides?: Partial<PiRuntimeConfig>;
  onUpdate: (update: SettingsUpdate) => void;
  onReset: (path: SettingsPath) => void;
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
  inherited,
  fallback,
  inheritedFrom,
  overrides = {},
  onUpdate,
  onReset,
}: PiSettingsOverrideFieldsProps) {
  const inheritedPi = inherited?.model ? inherited : fallback;
  const currentProvider = overrides.model?.provider || inheritedPi?.model?.provider || "";
  const providersQuery = useProviders();
  const modelsQuery = useModels(currentProvider);
  const authenticatedProviders = (providersQuery.data?.providers ?? []).filter(
    (provider) => providersQuery.data?.authStatus[provider]?.hasAuth === true,
  );
  const providers = [
    ...POPULAR_PROVIDERS.filter((provider) => authenticatedProviders.includes(provider)),
    ...authenticatedProviders.filter((provider) => !POPULAR_PROVIDERS.includes(provider)).sort(),
  ];
  const providerOptions = providers.map((provider) => ({ value: provider, label: provider }));
  const modelOptions = (modelsQuery.data ?? []).map(({ id }) => ({ value: id, label: id }));

  return (
    <>
      <SettingRow
        label="Provider"
        inheritedValue={inheritedPi?.model?.provider || ""}
        inheritedFrom={inheritedFrom}
        overrideValue={overrides.model?.provider}
        onOverride={(provider) =>
          onUpdate({ path: "pi-coding-agent.model", value: { provider, name: "" } })
        }
        onReset={() => onReset("pi-coding-agent.model")}
        renderInput={(value, onChange) =>
          providersQuery.isError ? (
            <span className="text-xs text-red-400">
              {errorMessage(providersQuery.error, "Failed to load providers")}
            </span>
          ) : (
            renderSelect(value, onChange, [{ value: "", label: "Select..." }, ...providerOptions])
          )
        }
        formatValue={(value) => value || "(not set)"}
      />

      <SettingRow
        label="Model"
        inheritedValue={inheritedPi?.model?.name || ""}
        inheritedFrom={inheritedFrom}
        overrideValue={overrides.model?.name}
        onOverride={(name) =>
          onUpdate({
            path: "pi-coding-agent.model",
            value: { provider: currentProvider, name },
          })
        }
        onReset={() => {
          if (overrides.model?.provider) {
            onUpdate({
              path: "pi-coding-agent.model",
              value: { provider: overrides.model.provider, name: "" },
            });
          } else {
            onReset("pi-coding-agent.model");
          }
        }}
        renderInput={(value, onChange) =>
          modelsQuery.isFetching ? (
            <span className="text-xs text-neutral-500">Loading...</span>
          ) : (
            renderSelect(value, onChange, [{ value: "", label: "Select..." }, ...modelOptions])
          )
        }
        formatValue={(value) => value || "(not set)"}
      />

      {currentProvider === "openrouter" && (
        <SettingRow
          label="OR Route"
          inheritedValue={inheritedPi?.openRouterProvider || "Auto"}
          inheritedFrom={inheritedFrom}
          overrideValue={overrides.openRouterProvider}
          onOverride={(value) => {
            if (value) onUpdate({ path: "pi-coding-agent.openRouterProvider", value });
            else onReset("pi-coding-agent.openRouterProvider");
          }}
          onReset={() => onReset("pi-coding-agent.openRouterProvider")}
          renderInput={(value, onChange) =>
            renderSelect(value || "", onChange, [...OPENROUTER_PROVIDER_OPTIONS])
          }
        />
      )}

      <SettingRow
        label="Thinking Level"
        inheritedValue={inheritedPi?.thinkingLevel || "off"}
        inheritedFrom={inheritedFrom}
        overrideValue={overrides.thinkingLevel}
        onOverride={(value) => onUpdate({ path: "pi-coding-agent.thinkingLevel", value })}
        onReset={() => onReset("pi-coding-agent.thinkingLevel")}
        renderInput={(value, onChange) =>
          renderSelect(value, onChange, [...THINKING_LEVEL_OPTIONS])
        }
      />
    </>
  );
}
