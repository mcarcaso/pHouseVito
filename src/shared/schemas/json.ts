import { z } from "zod";

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** Validates that a route response can be represented safely as JSON. */
export const jsonValueSchema: z.ZodType<JsonValue, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ]),
);

/** Validates and normalizes values using the same serialization semantics as res.json(). */
export const jsonResponseSchema = z.unknown().transform((value, ctx): JsonValue => {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error("Response is not JSON serializable");
    return jsonValueSchema.parse(JSON.parse(serialized));
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Response is not JSON serializable" });
    return z.NEVER;
  }
});
