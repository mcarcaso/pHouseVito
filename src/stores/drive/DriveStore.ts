import type { Context } from "../../context/Context.js";
import type { DriveDirectoryMeta } from "../../contracts/drive.js";
import type { Store } from "../Store.js";

export type DriveEntryKind = "directory" | "file";

export interface DriveEntry {
  path: string;
  parentPath: string | null;
  name: string;
  kind: DriveEntryKind;
  size: number;
  createdAt: string;
  isPublic: boolean;
  meta?: DriveDirectoryMeta | null;
}

export interface DriveFilter {
  paths?: string[];
  parentPaths?: string[];
  kinds?: DriveEntryKind[];
}

export interface DriveListArgs extends DriveFilter {
  order?: "name" | "created";
}

export type CreateDriveEntryArgs =
  | { kind: "directory"; path: string }
  | { kind: "file"; path: string; content: Buffer }
  | { kind: "site"; path: string; archive: Buffer };

export type UpdateDriveEntryArgs =
  | {
      path: string;
      changes: {
        directoryMeta: {
          isPublic?: boolean;
          name?: string;
          description?: string;
        };
      };
    }
  | {
      path: string;
      changes: { fileIsPublic: boolean | null };
    };

export interface DeleteDriveEntryArgs {
  paths: string[];
}

export interface DriveStore extends Store<
  DriveEntry,
  DriveListArgs,
  CreateDriveEntryArgs,
  UpdateDriveEntryArgs,
  DeleteDriveEntryArgs,
  unknown
> {
  list(x: Context, args: DriveListArgs): DriveEntry[];
  count(x: Context, args: DriveFilter): number;
  create(x: Context, args: CreateDriveEntryArgs): DriveEntry;
  update(x: Context, args: UpdateDriveEntryArgs): DriveEntry;
  delete(x: Context, args: DeleteDriveEntryArgs): number;
  cmd(x: Context, command: unknown): unknown;
}
