import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  vitoConfigSchema,
  type VitoConfig,
  type VitoConfigPatch,
} from "../../../src/shared/schemas/vito-config";
import { errorMessage, jsonRequest, requestJson } from "../lib/api-client";

interface UseConfigReturn {
  config: VitoConfig | null;
  loading: boolean;
  error: string | null;
  saving: boolean;
  saved: boolean;
  updateConfig: (updates: VitoConfigPatch) => Promise<void>;
  reload: () => Promise<void>;
}

const configQueryKey = ["config"] as const;

export function useConfig(): UseConfigReturn {
  const queryClient = useQueryClient();
  const savedTimer = useRef<number>();
  const [saved, setSaved] = useState(false);
  const configQuery = useQuery({
    queryKey: configQueryKey,
    queryFn: () => requestJson("/api/config", vitoConfigSchema),
  });
  const updateMutation = useMutation({
    mutationFn: (updates: VitoConfigPatch) =>
      requestJson("/api/config", vitoConfigSchema, jsonRequest("PUT", updates)),
    onSuccess: (config) => {
      queryClient.setQueryData(configQueryKey, config);
      setSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = window.setTimeout(() => setSaved(false), 2_000);
    },
  });

  useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    [],
  );

  return {
    config: configQuery.data ?? null,
    loading: configQuery.isPending,
    error: configQuery.error
      ? errorMessage(configQuery.error, "Failed to load config")
      : updateMutation.error
        ? errorMessage(updateMutation.error, "Failed to save")
        : null,
    saving: updateMutation.isPending,
    saved,
    updateConfig: async (updates) => {
      await updateMutation.mutateAsync(updates);
    },
    reload: async () => {
      await configQuery.refetch();
    },
  };
}
