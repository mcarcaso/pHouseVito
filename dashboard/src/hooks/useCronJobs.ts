import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { cronJobConfigSchema, type CronJobConfig } from "../../../src/shared/schemas/vito-config";
import { jsonRequest, requestJson } from "../lib/api-client";

const jobsKey = ["cron-jobs"] as const;
export function useCronJobs() {
  return useQuery({
    queryKey: jobsKey,
    queryFn: () => requestJson("/api/cron/jobs", z.array(cronJobConfigSchema)),
  });
}
function useJobMutation<T>(mutationFn: (input: T) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: jobsKey }),
  });
}
export function useCreateCronJob() {
  return useJobMutation((job: CronJobConfig) =>
    requestJson("/api/cron/jobs", z.unknown(), jsonRequest("POST", job)),
  );
}
export function useDeleteCronJob() {
  return useJobMutation((name: string) =>
    requestJson(`/api/cron/jobs/${encodeURIComponent(name)}`, z.unknown(), { method: "DELETE" }),
  );
}
export function useTriggerCronJob() {
  return useMutation({
    mutationFn: (name: string) =>
      requestJson(`/api/cron/jobs/${encodeURIComponent(name)}/trigger`, z.unknown(), {
        method: "POST",
      }),
  });
}
export function useUpdateCronJob() {
  return useJobMutation(({ name, updates }: { name: string; updates: Partial<CronJobConfig> }) =>
    requestJson(
      `/api/cron/jobs/${encodeURIComponent(name)}`,
      z.unknown(),
      jsonRequest("PUT", updates),
    ),
  );
}
export function useCronHealth(enabled: boolean) {
  return useQuery({
    queryKey: ["cron-health"],
    queryFn: () => requestJson("/api/cron/health", z.record(z.unknown())),
    enabled,
  });
}
