import type { Context } from "../../context/Context.js";
import type { Store } from "../Store.js";

export interface AttachmentRecord {
  id: string;
  path: string;
  url: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface AttachmentFilter {
  ids?: string[];
}

export interface CreateAttachmentArgs {
  content: Buffer;
  mimeType: string;
  filename?: string;
}

export interface DeleteAttachmentArgs {
  ids: string[];
}

export interface AttachmentStore extends Store<
  AttachmentRecord,
  AttachmentFilter,
  CreateAttachmentArgs,
  never,
  DeleteAttachmentArgs,
  unknown
> {
  list(x: Context, args: AttachmentFilter): AttachmentRecord[];
  count(x: Context, args: AttachmentFilter): number;
  create(x: Context, args: CreateAttachmentArgs): AttachmentRecord;
  update(x: Context, args: never): never;
  delete(x: Context, args: DeleteAttachmentArgs): number;
  cmd(x: Context, command: unknown): unknown;
}
