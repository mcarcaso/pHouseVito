import { z } from "zod";

export const providerIdSchema = z.string().min(1).max(200);
export const providerLoginPromptRequestSchema = z
  .object({
    value: z.unknown().optional(),
  })
  .passthrough();

export type ProviderLoginPromptRequest = z.infer<typeof providerLoginPromptRequestSchema>;
