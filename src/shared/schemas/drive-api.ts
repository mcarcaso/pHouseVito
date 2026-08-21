import { z } from "zod";

export const drivePathSchema = z.string().refine((value) => {
  if (value === "") return true;
  if (value.startsWith("/") || value.includes("\\") || value.includes("\0")) return false;
  return value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}, "Invalid drive path");

export const nonRootDrivePathSchema = drivePathSchema.refine(
  (value) => value !== "",
  "The drive root cannot be modified",
);

export const driveFileVisibilitySchema = z
  .object({
    isPublic: z.boolean(),
  })
  .strict();

export const driveDirectoryMetaSchema = z
  .object({
    isPublic: z.boolean().optional(),
    name: z.string().optional(),
    description: z.string().optional(),
    files: z.record(driveFileVisibilitySchema).optional(),
  })
  .passthrough();

export const driveUploadRequestSchema = z
  .object({
    data: z.string().min(1),
    filename: z.string().min(1),
    folder: drivePathSchema.optional(),
  })
  .strict();

export const driveSiteUploadRequestSchema = z
  .object({
    data: z.string().min(1),
    folder: nonRootDrivePathSchema,
  })
  .strict();

export const driveDirectoryMetaUpdateSchema = z
  .object({
    isPublic: z.boolean().optional(),
    name: z.string().optional(),
    description: z.string().optional(),
  })
  .strict();

export const driveFileMetaUpdateSchema = z
  .object({
    isPublic: z.boolean().nullable().optional(),
  })
  .strict();

export type DriveDirectoryMeta = z.infer<typeof driveDirectoryMetaSchema>;
export type DriveUploadRequest = z.infer<typeof driveUploadRequestSchema>;
export type DriveSiteUploadRequest = z.infer<typeof driveSiteUploadRequestSchema>;
export type DriveDirectoryMetaUpdate = z.infer<typeof driveDirectoryMetaUpdateSchema>;
export type DriveFileMetaUpdate = z.infer<typeof driveFileMetaUpdateSchema>;
