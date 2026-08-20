import { z } from "zod";

const messageErrorSchema = <TCode extends string>(code: TCode) =>
  z.object({
    code: z.literal(code),
    message: z.string().min(1),
  });

export const vitoErrorDataSchema = z.discriminatedUnion("code", [
  messageErrorSchema("BAD_REQUEST"),
  z.object({
    code: z.literal("VALIDATION_FAILED"),
    message: z.string().min(1),
    issues: z.array(
      z.object({
        path: z.string(),
        message: z.string(),
        code: z.string(),
      }),
    ),
  }),
  messageErrorSchema("UNAUTHORIZED"),
  messageErrorSchema("FORBIDDEN"),
  z.object({
    code: z.literal("NOT_FOUND"),
    message: z.string().min(1),
    resource: z.string().min(1).optional(),
  }),
  messageErrorSchema("CONFLICT"),
  messageErrorSchema("SERVICE_UNAVAILABLE"),
  z.object({
    code: z.literal("INTERNAL_ERROR"),
    message: z.literal("Internal server error"),
  }),
]);

export type VitoErrorData = z.infer<typeof vitoErrorDataSchema>;

export const vitoErrorCodeSchema = z.enum([
  "BAD_REQUEST",
  "VALIDATION_FAILED",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "SERVICE_UNAVAILABLE",
  "INTERNAL_ERROR",
]);

export const vitoErrorResponseSchema = z.object({
  error: z.string(),
  code: vitoErrorCodeSchema,
  details: z.record(z.unknown()).optional(),
});

export type VitoErrorResponse = z.infer<typeof vitoErrorResponseSchema>;
