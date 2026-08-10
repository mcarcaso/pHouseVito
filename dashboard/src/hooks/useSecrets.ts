import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { jsonRequest, requestJson } from "../lib/api-client";

const secretSchema = z.object({
  key: z.string(),
  value: z.string(),
  system: z.boolean().optional(),
  description: z.string().optional(),
});
export type Secret = z.infer<typeof secretSchema>;
const secretsKey = ["secrets"] as const;

export function useSecrets() {
  return useQuery({
    queryKey: secretsKey,
    queryFn: () => requestJson("/api/secrets", z.array(secretSchema)),
  });
}

export function useSaveSecret() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      requestJson(
        `/api/secrets/${encodeURIComponent(key)}`,
        z.unknown(),
        jsonRequest("PUT", { value }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: secretsKey }),
  });
}

export function useDeleteSecret() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (key: string) =>
      requestJson(`/api/secrets/${encodeURIComponent(key)}`, z.unknown(), { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: secretsKey }),
  });
}
