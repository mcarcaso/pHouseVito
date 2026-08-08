import { z } from "zod";

export const appNameSchema = z.string().min(1).max(100).regex(
  /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
  "Invalid app name"
);

export const appFilePathSchema = z.string().min(1).refine((value) => {
  if (value.startsWith("/") || value.includes("\\") || value.includes("\0")) return false;
  return value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}, "Invalid app file path");

export const appMetadataSchema = z.object({
  description: z.string().optional(),
  port: z.number().int().min(1).max(65_535),
  url: z.string().url().optional(),
  createdAt: z.string().optional(),
}).passthrough();
export type AppMetadata = z.infer<typeof appMetadataSchema>;

export const appReadFileCommandSchema = z.object({
  type: z.literal("read-file"),
  appName: appNameSchema,
  path: appFilePathSchema,
  maxBytes: z.number().int().positive().max(10 * 1024 * 1024).default(1024 * 1024),
}).strict();

export const appReadFileResultSchema = z.object({
  content: z.string(),
  size: z.number().int().nonnegative(),
}).strict();
export type AppReadFileResult = z.infer<typeof appReadFileResultSchema>;
