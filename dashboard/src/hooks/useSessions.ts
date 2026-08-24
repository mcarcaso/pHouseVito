import { useMutation, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import {
  messagePageSchema,
  messageSchema as dashboardMessageSchema,
  sessionSchema as dashboardSessionSchema,
  useArchiveSessionMessages,
  useSendChatMessage,
  useSessionMessages,
  useSessions,
  useUpdateSessionAlias,
  type MessagePage,
  type VitoMessage as DashboardMessage,
  type VitoSession as DashboardSession,
} from "@vito/client";
import { attachmentUploadResponseSchema } from "../../../src/shared/schemas/attachment-api";
import { jsonRequest, requestJson } from "../lib/api-client";

export {
  dashboardMessageSchema,
  dashboardSessionSchema,
  messagePageSchema,
  useArchiveSessionMessages,
  useSendChatMessage,
  useSessionMessages,
  useSessions,
  useUpdateSessionAlias,
};
export type { DashboardMessage, DashboardSession, MessagePage };

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
