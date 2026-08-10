import { z } from "zod";

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ]),
);

export const piSessionPersistedLineSchema = z.record(jsonValueSchema);
export type PiSessionPersistedLine = z.infer<typeof piSessionPersistedLineSchema>;

export const piSessionParseErrorSchema = z
  .object({
    type: z.literal("parse_error"),
    raw: z.string(),
  })
  .strict();
export type PiSessionParseError = z.infer<typeof piSessionParseErrorSchema>;

export type PiSessionLine = PiSessionPersistedLine | PiSessionParseError;

export const piSessionRecordIdSchema = z
  .string()
  .min(1)
  .refine((id) => {
    if (id.includes("\\") || id.includes("\0")) return false;
    const parts = id.split("/");
    if (parts.length !== 2 || !parts[1].endsWith(".jsonl")) return false;
    return parts.every((part) => part !== "" && part !== "." && part !== "..");
  }, "Invalid Pi session identifier");
