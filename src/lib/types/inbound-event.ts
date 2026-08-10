import { z } from "zod";

export interface Attachment {
  type: "image" | "file" | "audio" | "video";
  url?: string;
  path?: string;
  buffer?: Buffer;
  mimeType?: string;
  filename?: string;
}

export interface InboundEvent {
  sessionKey: string;
  channel: string;
  target: string;
  author: string;
  timestamp: number;
  content: string;
  attachments?: Attachment[];
  replyTo?: string;
  raw: unknown;
  hasMention?: boolean;
}

const inboundEventMetadataSchema = z.object({
  sendCondition: z.string().nullable().optional(),
  source: z.string().optional(),
  channelPrompt: z.string().optional(),
  requestId: z.string().optional(),
}).passthrough();

export type InboundEventMetadata = z.infer<typeof inboundEventMetadataSchema>;

export function parseInboundEventMetadata(value: unknown): InboundEventMetadata {
  const result = inboundEventMetadataSchema.safeParse(value);
  return result.success ? result.data : {};
}
