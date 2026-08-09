import { z } from "zod";

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
