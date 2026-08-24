import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { jsonRequest, requestJson, useVitoClient } from "./client";

export const sessionSchema = z.object({
  id: z.string(),
  channel: z.string(),
  channel_target: z.string().optional(),
  last_active_at: z.number(),
  alias: z.string().nullable().optional(),
  created_at: z.number().optional(),
});
export const messageSchema = z.object({
  id: z.number(),
  type: z.string(),
  content: z.string(),
  timestamp: z.number(),
  author: z.string().nullable().optional(),
});
export const messagePageSchema = z.object({
  messages: z.array(messageSchema),
  total: z.number(),
  hasMore: z.boolean().optional().default(false),
});
export type VitoSession = z.infer<typeof sessionSchema>;
export type VitoMessage = z.infer<typeof messageSchema>;
export type MessagePage = z.infer<typeof messagePageSchema>;
export const sessionKeys = {
  all: ["sessions"] as const,
  messages: (id: string | null, args: unknown) => ["sessions", id, "messages", args] as const,
};

export interface MessageFilters {
  thoughts: boolean;
  tools: boolean;
}
export interface MessageQuery {
  limit?: number;
  before?: number;
  after?: number;
  hideThoughts?: boolean;
  hideTools?: boolean;
  refetchInterval?: number | false;
}

function messageUrl(sessionId: string, args?: MessageQuery): string {
  const params = new URLSearchParams();
  if (args?.limit !== undefined) params.set("limit", String(args.limit));
  if (args?.before !== undefined) params.set("before", String(args.before));
  if (args?.after !== undefined) params.set("after", String(args.after));
  if (args?.hideThoughts) params.set("hideThoughts", "true");
  if (args?.hideTools) params.set("hideTools", "true");
  return `/api/sessions/${encodeURIComponent(sessionId)}/messages?${params}`;
}

export function useSessions(options?: { refetchInterval?: number | false }) {
  const client = useVitoClient();
  return useQuery({
    queryKey: sessionKeys.all,
    queryFn: () => requestJson(client, "/api/sessions", z.array(sessionSchema)),
    refetchInterval: options?.refetchInterval,
  });
}

export function useSessionMessages(sessionId: string | null, args?: MessageQuery) {
  const client = useVitoClient();
  return useQuery({
    queryKey: sessionKeys.messages(sessionId, args),
    queryFn: () => requestJson(client, messageUrl(sessionId ?? "", args), messagePageSchema),
    enabled: sessionId !== null,
    refetchInterval: args?.refetchInterval,
  });
}

export function useUpdateSessionAlias() {
  const client = useVitoClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, alias }: { sessionId: string; alias: string | null }) =>
      requestJson(
        client,
        `/api/sessions/${encodeURIComponent(sessionId)}/alias`,
        z.unknown(),
        jsonRequest("PUT", { alias }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: sessionKeys.all }),
  });
}

export function useSendChatMessage() {
  const client = useVitoClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      sessionId: string;
      content: string;
      type?: "chat";
      attachments?: unknown[];
    }) =>
      requestJson(
        client,
        "/api/chat",
        z.unknown(),
        jsonRequest("POST", { type: "chat", ...input }),
      ),
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({ queryKey: sessionKeys.all });
      void queryClient.invalidateQueries({ queryKey: ["sessions", input.sessionId, "messages"] });
      void queryClient.invalidateQueries({ queryKey: ["chat-messages", input.sessionId] });
      void queryClient.invalidateQueries({ queryKey: ["chat-new-messages", input.sessionId] });
    },
  });
}

export function useArchiveSessionMessages() {
  const client = useVitoClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      requestJson(client, `/api/sessions/${encodeURIComponent(sessionId)}/messages`, z.unknown(), {
        method: "DELETE",
      }),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: ["chat-messages", id] });
      queryClient.removeQueries({ queryKey: ["chat-new-messages", id] });
      void queryClient.invalidateQueries({ queryKey: ["sessions", id, "messages"] });
    },
  });
}

export { messageUrl };
