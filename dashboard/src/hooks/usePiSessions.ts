import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { requestJson } from "../lib/api-client";
const itemSchema = z.object({
  rel: z.string(),
  size: z.number(),
  mtime: z.number(),
  vitoSessionId: z.string(),
  alias: z.string().nullable(),
  piSessionId: z.string(),
  piTimestamp: z.string(),
  piCwd: z.string(),
  messageCount: z.number(),
  lastModel: z.string(),
  lastUserMessage: z.string(),
});
export type PiSessionListItem = z.infer<typeof itemSchema>;
const key = ["pi-sessions"] as const;
export function usePiSessions(autoRefresh = true) {
  return useQuery({
    queryKey: key,
    queryFn: () =>
      requestJson(
        "/api/pi-sessions",
        z.object({ files: z.array(itemSchema) }).transform((response) => response.files),
      ),
    refetchInterval: autoRefresh ? 5_000 : false,
  });
}
export function usePiSessionDetail<Line>(
  rel: string | null,
  lineSchema: z.ZodType<Line>,
  autoRefresh = true,
) {
  return useQuery({
    queryKey: [...key, rel],
    queryFn: () =>
      requestJson(
        `/api/pi-sessions/${(rel ?? "").split("/").map(encodeURIComponent).join("/")}`,
        z.object({ rel: z.string(), format: z.literal("jsonl"), lines: z.array(lineSchema) }),
      ),
    enabled: rel !== null,
    refetchInterval: autoRefresh ? 5_000 : false,
  });
}
export function useDeletePiSession() {
  const q = useQueryClient();
  return useMutation({
    mutationFn: (rel: string | null) =>
      requestJson(
        rel
          ? `/api/pi-sessions/${rel.split("/").map(encodeURIComponent).join("/")}`
          : "/api/pi-sessions",
        z.unknown(),
        { method: "DELETE" },
      ),
    onSuccess: () => q.invalidateQueries({ queryKey: key }),
  });
}
