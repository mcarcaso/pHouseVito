import { z } from "zod";

export const secretKeySchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
export const secretUpdateRequestSchema = z
  .object({
    value: z.string(),
  })
  .strict();

export type SecretUpdateRequest = z.infer<typeof secretUpdateRequestSchema>;
