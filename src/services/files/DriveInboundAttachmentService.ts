import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import type { Context } from "../../context/Context.js";
import type { InboundEvent } from "../../contracts/inbound-event.js";
import { xDriveDir, xDriveStore } from "../../lib/x.js";
import type { InboundAttachmentService } from "./InboundAttachmentService.js";

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

const MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "audio/mpeg": ".mp3",
  "audio/ogg": ".ogg",
  "audio/wav": ".wav",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "application/pdf": ".pdf",
  "text/plain": ".txt",
};

async function readBoundedBody(response: Response): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    size += result.value.byteLength;
    if (size > MAX_ATTACHMENT_BYTES) {
      await reader.cancel();
      throw new Error(`Attachment exceeds ${MAX_ATTACHMENT_BYTES} bytes`);
    }
    chunks.push(result.value);
  }
  return Buffer.concat(chunks);
}

export class DriveInboundAttachmentService implements InboundAttachmentService {
  async prepare(x: Context, event: InboundEvent): Promise<void> {
    if (!event.attachments?.length) return;

    for (const attachment of event.attachments) {
      if (attachment.path || !attachment.url) continue;
      try {
        const url = new URL(attachment.url);
        if (url.protocol !== "https:" && url.protocol !== "http:") continue;
        const response = await fetch(url);
        if (!response.ok) continue;
        const buffer = await readBoundedBody(response);
        const extension = MIME_EXTENSIONS[attachment.mimeType || "application/octet-stream"] || "";
        const relativePath = `images/${Date.now()}_${randomBytes(4).toString("hex")}${extension}`;
        const entry = xDriveStore(x).create(x, {
          kind: "file",
          path: relativePath,
          content: buffer,
        });
        attachment.path = resolve(xDriveDir(x), entry.path);
        attachment.buffer = buffer;
      } catch (error) {
        console.error("[Attachments] Failed to download inbound attachment:", error);
      }
    }
  }
}
