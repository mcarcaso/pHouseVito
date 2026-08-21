import { Readable } from "node:stream";
import { z } from "zod";

export const attachmentIdSchema = z
  .string()
  .min(1)
  .max(500)
  .refine(
    (value) =>
      value !== "." &&
      value !== ".." &&
      !value.includes("/") &&
      !value.includes("\\") &&
      !value.includes("\0"),
    "Invalid attachment identifier",
  );

export const attachmentMimeTypeSchema = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => !/[;\0-\x1f\x7f]/.test(value), "Invalid MIME type");

export const attachmentReadCommandSchema = z
  .object({
    type: z.literal("read"),
    id: attachmentIdSchema,
    start: z.number().int().nonnegative().optional(),
    end: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine(
    (value) => value.start === undefined || value.end === undefined || value.end >= value.start,
    "Invalid attachment byte range",
  );

export const attachmentReadResultSchema = z
  .object({
    id: attachmentIdSchema,
    size: z.number().int().nonnegative(),
    stream: z.custom<Readable>((value) => value instanceof Readable),
  })
  .strict();
