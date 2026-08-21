import { Readable } from "node:stream";
import { z } from "zod";
import {
  driveDirectoryMetaSchema,
  drivePathSchema,
  nonRootDrivePathSchema,
} from "../../shared/schemas/drive-api.js";

export {
  driveDirectoryMetaSchema,
  driveFileVisibilitySchema,
  drivePathSchema,
  nonRootDrivePathSchema,
} from "../../shared/schemas/drive-api.js";
export type { DriveDirectoryMeta } from "../../shared/schemas/drive-api.js";

export const driveReadCommandSchema = z
  .object({
    type: z.literal("read"),
    path: drivePathSchema,
    indexFallback: z.boolean().optional(),
  })
  .strict();

export const driveReadResultSchema = z
  .object({
    path: nonRootDrivePathSchema,
    name: z.string().min(1),
    size: z.number().int().nonnegative(),
    isPublic: z.boolean(),
    stream: z.custom<Readable>((value) => value instanceof Readable),
  })
  .strict();
export type DriveReadResult = z.infer<typeof driveReadResultSchema>;
