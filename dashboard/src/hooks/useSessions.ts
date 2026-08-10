import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { jsonRequest, requestJson } from "../lib/api-client";

export const dashboardSessionSchema = z.object({
  id: z.string(),
  channel: z.string(),
  channel_target: z.string(),
  last_active_at: z.number(),
  alias: z.string().nullable().optional(),
  created_at: z.number().optional(),
});
export const dashboardMessageSchema = z.object({
  id: z.number(),
  type: z.string(),
  content: z.string(),
  timestamp: z.number(),
  author: z.string().nullable().optional(),
});
const messagePageSchema = z.object({
  messages: z.array(dashboardMessageSchema),
  total: z.number(),
  hasMore: z.boolean(),
});

export type DashboardSession = z.infer<typeof dashboardSessionSchema>;
export type DashboardMessage = z.infer<typeof dashboardMessageSchema>;

export function useSessions(options?: { refetchInterval?: number | false }) {
  return useQuery({
    queryKey: ["sessions"],
    queryFn: () => requestJson("/api/sessions", z.array(dashboardSessionSchema)),
    refetchInterval: options?.refetchInterval,
  });
}

export function useSessionMessages(
  sessionId: string | null,
  args?: { limit?: number; before?: number; refetchInterval?: number | false },
) {
  const params = new URLSearchParams();
  if (args?.limit !== undefined) params.set("limit", String(args.limit));
  if (args?.before !== undefined) params.set("before", String(args.before));
  return useQuery({
    queryKey: ["sessions", sessionId, "messages", args?.limit, args?.before],
    queryFn: () =>
      requestJson(
        `/api/sessions/${encodeURIComponent(sessionId ?? "")}/messages?${params}`,
        messagePageSchema,
      ),
    enabled: sessionId !== null,
    refetchInterval: args?.refetchInterval,
  });
}

export function useUpdateSessionAlias() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, alias }: { sessionId: string; alias: string }) =>
      requestJson(
        `/api/sessions/${encodeURIComponent(sessionId)}/alias`,
        z.unknown(),
        jsonRequest("PUT", { alias }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sessions"] }),
  });
}

export function useArchiveSessionMessages() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      requestJson(`/api/sessions/${encodeURIComponent(sessionId)}/messages`, z.unknown(), {
        method: "DELETE",
      }),
    onSuccess: (_data, sessionId) =>
      queryClient.invalidateQueries({ queryKey: ["sessions", sessionId, "messages"] }),
  });
}
