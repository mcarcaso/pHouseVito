import { z } from "zod";

export const mcpNameSchema = z
  .string()
  .regex(/^[a-zA-Z0-9_-]{1,64}$/, "Use letters, numbers, underscores or hyphens (1–64 characters)")
  .refine((name) => !["__proto__", "constructor", "prototype"].includes(name), "Reserved name");
export const mcpExposureSchema = z.enum(["deferred", "codemode-deferred", "direct", "hidden"]);
// Credentials live in SecretService, never this configuration. No shell interpolation.
const secretReference = z
  .string()
  .max(512)
  .regex(
    /^(?:Bearer )?\$\{[A-Z][A-Z0-9_]*\}$/,
    "Use ${SECRET_NAME} or Bearer ${SECRET_NAME}; add the value in Secrets",
  );
const common = {
  enabled: z.boolean().default(true),
  exposure: mcpExposureSchema.default("deferred"),
  timeout: z.number().int().min(1).max(120).default(30),
  toolExposure: z.record(z.string().min(1).max(128), mcpExposureSchema).optional(),
};
const httpUrl = z
  .string()
  .max(2048)
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
    );
  }, "Use HTTPS (or loopback HTTP), without credentials, query parameters or fragments");
export const mcpServerSchema = z.discriminatedUnion("type", [
  z
    .object({
      ...common,
      type: z.literal("http"),
      url: httpUrl,
      headers: z.record(z.string().min(1).max(128), secretReference).optional(),
      oauth: z
        .object({
          clientId: z.string().min(1).max(512).optional(),
          clientSecret: secretReference.optional(),
          scope: z.string().max(1024).optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal("stdio"),
      command: z.string().min(1).max(512),
      args: z.array(z.string().max(2048)).max(64).default([]),
      cwd: z.string().max(2048).optional(),
      env: z.record(z.string().regex(/^[A-Z][A-Z0-9_]*$/), secretReference).optional(),
    })
    .strict(),
]);
export const mcpConfigSchema = z
  .object({
    servers: z.record(mcpNameSchema, mcpServerSchema).default({}),
    oauthCallbackUrl: httpUrl.optional(),
  })
  .strict();
export type McpServer = z.infer<typeof mcpServerSchema>;
export const mcpSaveSchema = z.object({ name: mcpNameSchema, server: mcpServerSchema }).strict();
