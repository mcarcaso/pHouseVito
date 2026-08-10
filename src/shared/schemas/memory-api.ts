import { z } from "zod";

export const memorySearchModeSchema = z.enum(["hybrid", "embedding", "bm25"]);
export const memorySearchQuerySchema = z.object({
  q: z.string().min(1),
  mode: memorySearchModeSchema.default("hybrid"),
  limit: z.coerce.number().int().positive().max(100).default(10),
  session: z.string().min(1).optional(),
}).strict();

export type MemorySearchMode = z.infer<typeof memorySearchModeSchema>;
export type MemorySearchQuery = z.infer<typeof memorySearchQuerySchema>;
