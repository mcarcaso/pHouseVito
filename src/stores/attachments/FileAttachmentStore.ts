import crypto from "node:crypto";
import {
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";
import type { Context } from "../../context/Context.js";
import {
  attachmentIdSchema,
  attachmentMimeTypeSchema,
  attachmentReadCommandSchema,
} from "../../contracts/attachment.js";
import { xAttachmentsDir } from "../../lib/x.js";
import { UnsupportedStoreOperationError } from "../Store.js";
import type {
  AttachmentFilter,
  AttachmentRecord,
  AttachmentStore,
  CreateAttachmentArgs,
  DeleteAttachmentArgs,
} from "./AttachmentStore.js";

function sanitizeFilename(value: string): string {
  const name = value.split(/[\\/]/).at(-1) ?? "";
  const sanitized = name.replace(/[\0-\x1f\x7f]/g, "").trim();
  return sanitized && sanitized !== "." && sanitized !== ".." ? sanitized : "attachment.bin";
}

function extensionForMimeType(mimeType: string): string {
  const subtype = mimeType.split("/")[1];
  return subtype?.replace(/[^A-Za-z0-9._+-]/g, "_") || "bin";
}

function resolveAttachment(rootInput: string, id: string): string | undefined {
  const parsed = attachmentIdSchema.safeParse(id);
  if (!parsed.success) return undefined;
  const root = resolve(rootInput);
  const path = resolve(root, parsed.data);
  if (!path.startsWith(`${root}${sep}`) || !existsSync(path)) return undefined;
  const stats = lstatSync(path);
  return stats.isFile() && !stats.isSymbolicLink() ? path : undefined;
}

function recordFromPath(root: string, id: string, mimeType = "application/octet-stream"): AttachmentRecord | undefined {
  const path = resolveAttachment(root, id);
  if (!path) return undefined;
  return {
    id,
    path,
    url: `/attachments/${id}`,
    filename: id.replace(/^[0-9a-f-]{36}-/, ""),
    mimeType,
    size: lstatSync(path).size,
  };
}

export class FileAttachmentStore implements AttachmentStore {
  list(x: Context, args: AttachmentFilter): AttachmentRecord[] {
    const root = xAttachmentsDir(x);
    if (!existsSync(root)) return [];
    const ids = args.ids ?? readdirSync(root);
    return [...new Set(ids)]
      .flatMap((id) => {
        const record = recordFromPath(root, id);
        return record ? [record] : [];
      })
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  count(x: Context, args: AttachmentFilter): number {
    return this.list(x, args).length;
  }

  create(x: Context, args: CreateAttachmentArgs): AttachmentRecord {
    const mimeType = attachmentMimeTypeSchema.parse(args.mimeType);
    const root = xAttachmentsDir(x);
    mkdirSync(root, { recursive: true });
    const id = crypto.randomUUID();
    const filename = args.filename
      ? sanitizeFilename(args.filename)
      : `${id}.${extensionForMimeType(mimeType)}`;
    const storedName = args.filename ? `${id}-${filename}` : filename;
    const path = join(root, storedName);
    writeFileSync(path, args.content, { mode: 0o600 });
    return {
      id: storedName,
      path,
      url: `/attachments/${storedName}`,
      filename,
      mimeType,
      size: args.content.length,
    };
  }

  update(_x: Context, _args: never): never {
    throw new UnsupportedStoreOperationError("Attachments cannot be updated");
  }

  delete(x: Context, args: DeleteAttachmentArgs): number {
    const root = xAttachmentsDir(x);
    let deleted = 0;
    for (const id of new Set(args.ids)) {
      const path = resolveAttachment(root, id);
      if (!path) continue;
      unlinkSync(path);
      deleted++;
    }
    return deleted;
  }

  cmd(x: Context, command: unknown): unknown {
    const parsed = attachmentReadCommandSchema.safeParse(command);
    if (!parsed.success) return undefined;
    const path = resolveAttachment(xAttachmentsDir(x), parsed.data.id);
    if (!path) return undefined;
    const size = lstatSync(path).size;
    if (parsed.data.start !== undefined && parsed.data.start >= size) return undefined;
    return {
      id: parsed.data.id,
      size,
      stream: createReadStream(path, {
        ...(parsed.data.start !== undefined ? { start: parsed.data.start } : {}),
        ...(parsed.data.end !== undefined ? { end: Math.min(parsed.data.end, size - 1) } : {}),
      }),
    };
  }
}
