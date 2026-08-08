import { Readable } from "node:stream";
import { z } from "zod";

export const drivePathSchema = z.string().refine((value) => {
  if (value === "") return true;
  if (value.startsWith("/") || value.includes("\\") || value.includes("\0")) return false;
  return value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}, "Invalid drive path");

export const nonRootDrivePathSchema = drivePathSchema.refine(
  (value) => value !== "",
  "The drive root cannot be modified"
);

export const driveFileVisibilitySchema = z.object({
  isPublic: z.boolean(),
}).strict();

export const driveDirectoryMetaSchema = z.object({
  isPublic: z.boolean().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  files: z.record(driveFileVisibilitySchema).optional(),
}).passthrough();
export type DriveDirectoryMeta = z.infer<typeof driveDirectoryMetaSchema>;

export const driveReadCommandSchema = z.object({
  type: z.literal("read"),
  path: drivePathSchema,
  indexFallback: z.boolean().optional(),
}).strict();

export const driveReadResultSchema = z.object({
  path: nonRootDrivePathSchema,
  name: z.string().min(1),
  size: z.number().int().nonnegative(),
  isPublic: z.boolean(),
  stream: z.custom<Readable>((value) => value instanceof Readable),
}).strict();
export type DriveReadResult = z.infer<typeof driveReadResultSchema>;
