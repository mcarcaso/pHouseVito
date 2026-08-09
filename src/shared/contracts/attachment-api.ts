import { z } from "zod";

export const attachmentUploadRequestSchema = z.object({
  data: z.unknown().optional(),
  filename: z.unknown().optional(),
}).passthrough();

export const attachmentUploadResponseSchema = z.object({
  path: z.string(),
  url: z.string(),
  filename: z.string(),
  mimeType: z.string(),
}).strict();

export type AttachmentUploadRequest = z.infer<typeof attachmentUploadRequestSchema>;
export type AttachmentUploadResponse = z.infer<typeof attachmentUploadResponseSchema>;
