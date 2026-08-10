import { useQuery } from "@tanstack/react-query";
import { settingsSchema, streamModeSchema } from "../../../src/shared/schemas/vito-config";
import { requestJson } from "../lib/api-client";
import { setDefaults } from "../utils/defaults";

const resolvedSettingsSchema = settingsSchema.and(
  settingsSchema.extend({ streamMode: streamModeSchema }),
);

export function useSettingsDefaults(enabled: boolean) {
  return useQuery({
    queryKey: ["settings-defaults"],
    queryFn: async () => {
      const defaults = await requestJson("/api/settings/defaults", resolvedSettingsSchema);
      setDefaults(defaults);
      return defaults;
    },
    staleTime: Number.POSITIVE_INFINITY,
    enabled,
    retry: false,
  });
}
