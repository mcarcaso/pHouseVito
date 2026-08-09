import { z } from "zod";

export const sessionIdSchema = z.string().min(1);
export const sessionMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().positive().optional(),
  before: z.coerce.number().int().positive().optional(),
  after: z.coerce.number().int().positive().optional(),
  hideThoughts: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  hideTools: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
}).strict();
export const sessionAliasUpdateSchema = z.object({
  alias: z.string().nullable(),
}).strict();

export type SessionMessagesQuery = z.infer<typeof sessionMessagesQuerySchema>;
export type SessionAliasUpdate = z.infer<typeof sessionAliasUpdateSchema>;
