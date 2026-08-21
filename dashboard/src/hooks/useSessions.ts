import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { attachmentUploadResponseSchema } from "../../../src/shared/schemas/attachment-api";
import { dashboardChatRequestSchema } from "../../../src/shared/schemas/dashboard-chat";
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
export const messagePageSchema = z.object({
  messages: z.array(dashboardMessageSchema),
  total: z.number(),
  hasMore: z.boolean().optional().default(false),
});

export type DashboardSession = z.infer<typeof dashboardSessionSchema>;
export type DashboardMessage = z.infer<typeof dashboardMessageSchema>;
export type MessagePage = z.infer<typeof messagePageSchema>;

export function useSessions(options?: { refetchInterval?: number | false }) {
  return useQuery({
    queryKey: ["sessions"],
    queryFn: () => requestJson("/api/sessions", z.array(dashboardSessionSchema)),
    refetchInterval: options?.refetchInterval,
  });
}

export function useSessionMessages(
  sessionId: string | null,
  args?: {
    limit?: number;
    before?: number;
    after?: number;
    hideThoughts?: boolean;
    hideTools?: boolean;
    refetchInterval?: number | false;
  },
) {
  const params = new URLSearchParams();
  if (args?.limit !== undefined) params.set("limit", String(args.limit));
  if (args?.before !== undefined) params.set("before", String(args.before));
  if (args?.after !== undefined) params.set("after", String(args.after));
  if (args?.hideThoughts) params.set("hideThoughts", "true");
  if (args?.hideTools) params.set("hideTools", "true");
  return useQuery({
    queryKey: ["sessions", sessionId, "messages", args],
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
    mutationFn: ({ sessionId, alias }: { sessionId: string; alias: string | null }) =>
      requestJson(
        `/api/sessions/${encodeURIComponent(sessionId)}/alias`,
        z.unknown(),
        jsonRequest("PUT", { alias }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sessions"] }),
  });
}

export function useSessionConfig(sessionId: string | null) {
  return useQuery({
    queryKey: ["sessions", sessionId, "config"],
    queryFn: () =>
      requestJson(
        `/api/sessions/${encodeURIComponent(sessionId ?? "")}/config`,
        z.record(z.unknown()),
      ),
    enabled: sessionId !== null,
  });
}

export function useUploadAttachment() {
  return useMutation({
    mutationFn: (attachment: { data: string; filename?: string }) =>
      requestJson(
        "/api/attachments",
        attachmentUploadResponseSchema,
        jsonRequest("POST", attachment),
      ),
  });
}

export function useSendChatMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: z.input<typeof dashboardChatRequestSchema>) => {
      const request = dashboardChatRequestSchema.parse(input);
      return requestJson("/api/chat", z.unknown(), jsonRequest("POST", request));
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      queryClient.invalidateQueries({ queryKey: ["chat-new-messages", input.sessionId] });
    },
  });
}

export function useArchiveSessionMessages() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      requestJson(`/api/sessions/${encodeURIComponent(sessionId)}/messages`, z.unknown(), {
        method: "DELETE",
      }),
    onSuccess: (_data, sessionId) => {
      queryClient.removeQueries({ queryKey: ["chat-messages", sessionId] });
      queryClient.removeQueries({ queryKey: ["chat-new-messages", sessionId] });
      queryClient.invalidateQueries({ queryKey: ["sessions", sessionId, "messages"] });
    },
  });
}
