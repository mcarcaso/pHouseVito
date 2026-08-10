import { z } from "zod";

export const dashboardChatAttachmentSchema = z.object({
  type: z.enum(["image", "file", "audio", "video"]),
  url: z.string().optional(),
  path: z.string().optional(),
  mimeType: z.string().optional(),
  filename: z.string().optional(),
}).passthrough();

export const dashboardChatRequestSchema = z.object({
  type: z.literal("chat"),
  content: z.string().nullable().optional(),
  attachments: z.array(dashboardChatAttachmentSchema).optional(),
  sessionId: z.string().nullable().optional(),
}).passthrough().refine(
  (value) => Boolean(value.content) || Boolean(value.attachments?.length),
  "Chat message must include content or attachments"
);

export type DashboardChatRequest = z.infer<typeof dashboardChatRequestSchema>;
