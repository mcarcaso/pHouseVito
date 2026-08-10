import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { requestJson } from "../lib/api-client";
const key = ["traces"] as const;
export function useTraces<Item>(schema: z.ZodType<Item>, autoRefresh = true) {
  return useQuery({
    queryKey: key,
    queryFn: () =>
      requestJson(
        "/api/logs?limit=100",
        z.object({ files: z.array(schema) }).transform((response) => response.files),
      ),
    refetchInterval: autoRefresh ? 5_000 : false,
  });
}
export function useTraceDetail<Detail>(
  filename: string | null,
  schema: z.ZodType<Detail>,
  autoRefresh = true,
) {
  return useQuery({
    queryKey: [...key, filename],
    queryFn: () => requestJson(`/api/logs/${encodeURIComponent(filename ?? "")}`, schema),
    enabled: filename !== null,
    refetchInterval: autoRefresh ? 5_000 : false,
  });
}
export function useDeleteTrace() {
  const q = useQueryClient();
  return useMutation({
    mutationFn: (filename: string | null) =>
      requestJson(
        filename ? `/api/logs/${encodeURIComponent(filename)}` : "/api/logs",
        z.unknown(),
        { method: "DELETE" },
      ),
    onSuccess: () => q.invalidateQueries({ queryKey: key }),
  });
}
