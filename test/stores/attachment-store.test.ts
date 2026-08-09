import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import { attachmentReadResultSchema } from "../../src/contracts/attachment.js";
import { FileAttachmentStore } from "../../src/stores/attachments/FileAttachmentStore.js";

function createHarness() {
  const root = mkdtempSync(join(tmpdir(), "vito-attachment-store-"));
  const x = new ObjectContext({ attachmentsDir: () => root });
  return { root, x, store: new FileAttachmentStore() };
}

describe("FileAttachmentStore", () => {
  it("creates attachments with backward-compatible response fields", () => {
    const { root, x, store } = createHarness();
    try {
      const attachment = store.create(x, {
        content: Buffer.from("image"),
        mimeType: "image/png",
        filename: "photo.png",
      });
      assert.match(attachment.id, /^[0-9a-f-]{36}-photo\.png$/);
      assert.equal(attachment.filename, "photo.png");
      assert.equal(attachment.mimeType, "image/png");
      assert.equal(attachment.url, `/attachments/${attachment.id}`);
      assert.equal(store.count(x, {}), 1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("sanitizes supplied filenames and reads attachment streams", async () => {
    const { root, x, store } = createHarness();
    try {
      const attachment = store.create(x, {
        content: Buffer.from("content"),
        mimeType: "application/octet-stream",
        filename: "../unsafe.bin",
      });
      assert.equal(attachment.filename, "unsafe.bin");
      const result = attachmentReadResultSchema.parse(store.cmd(x, {
        type: "read",
        id: attachment.id,
      }));
      const chunks: Buffer[] = [];
      for await (const chunk of result.stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      assert.equal(Buffer.concat(chunks).toString("utf-8"), "content");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("ignores traversal and symbolic links during reads and deletion", () => {
    const { root, x, store } = createHarness();
    const outside = join(root, "..", `attachment-outside-${Date.now()}.txt`);
    try {
      writeFileSync(outside, "outside");
      symlinkSync(outside, join(root, "link.txt"));
      assert.equal(store.cmd(x, { type: "read", id: "../outside" }), undefined);
      assert.equal(store.cmd(x, { type: "read", id: "link.txt" }), undefined);
      assert.equal(store.delete(x, { ids: ["../outside", "link.txt"] }), 0);
    } finally {
      rmSync(outside, { force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });
});
