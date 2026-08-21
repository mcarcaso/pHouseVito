import { z } from "zod";

export const systemContentUpdateSchema = z.object({
  content: z.string(),
});

export type SystemContentUpdate = z.infer<typeof systemContentUpdateSchema>;
