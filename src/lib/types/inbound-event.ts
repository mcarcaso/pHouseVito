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

const inboundEventMetadataSchema = z
  .object({
    sendCondition: z.string().nullable().optional(),
    source: z.string().optional(),
    channelPrompt: z.string().optional(),
    requestId: z.string().optional(),
    deliveryKey: z.string().optional(),
    discordMessageId: z.string().optional(),
    discordAuthorId: z.string().optional(),
    discordChannelId: z.string().optional(),
    discordDiscarded: z.number().int().nonnegative().optional(),
    slackDiscarded: z.number().int().nonnegative().optional(),
    commandAuthorized: z.boolean().optional(),
  })
  .passthrough();

export type InboundEventMetadata = z.infer<typeof inboundEventMetadataSchema>;

export function parseInboundEventMetadata(value: unknown): InboundEventMetadata {
  const result = inboundEventMetadataSchema.safeParse(value);
  return result.success ? result.data : {};
}
