import { z } from "zod";

export const memorySearchModeSchema = z.enum(["hybrid", "embedding", "bm25"]);
export const memorySearchQuerySchema = z
  .object({
    q: z.string().min(1),
    mode: memorySearchModeSchema.default("hybrid"),
    limit: z.coerce.number().int().positive().max(100).default(10),
    session: z.string().min(1).optional(),
  })
  .strict();

export const factSearchQuerySchema = z
  .object({
    q: z.string().min(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    current: z.enum(["true", "false"]).optional(),
    asOf: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .strict();

export const memoryRecentQuerySchema = z
  .object({
    limit: z.coerce.number().int().positive().max(100).default(20),
    current: z.enum(["true", "false"]).optional(),
  })
  .strict();

export const memoryAnswerRequestSchema = z
  .object({
    query: z.string().trim().min(1),
    asOf: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .strict();

export type MemorySearchMode = z.infer<typeof memorySearchModeSchema>;
export type MemorySearchQuery = z.infer<typeof memorySearchQuerySchema>;
