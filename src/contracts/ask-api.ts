import { z } from "zod";

export const askApiRequestSchema = z.object({
  question: z.string().min(1),
  session: z.string().nullable().optional(),
  author: z.string().nullable().optional(),
  channelPrompt: z.string().nullable().optional(),
  timeoutMs: z.number().finite().nullable().optional(),
  relayToSession: z.boolean().nullable().optional(),
});

export type AskApiRequest = z.infer<typeof askApiRequestSchema>;

export interface AskApiOptions {
  question: string;
  session?: string;
  author?: string;
  channelPrompt?: string;
  timeoutMs?: number | null;
  relayToSession?: boolean;
}
