import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import { FileSystemFileService } from "../../src/services/files/FileSystemFileService.js";

const x = new ObjectContext({});

describe("FileSystemFileService", () => {
  it("preserves MIME and disposition behavior", async () => {
    const root = mkdtempSync(join(tmpdir(), "vito-file-service-"));
    try {
      const imagePath = join(root, "image.png");
      const archivePath = join(root, "archive.zip");
      writeFileSync(imagePath, "image");
      writeFileSync(archivePath, "archive");
      const service = new FileSystemFileService();
      const image = service.read(x, imagePath);
      const archive = service.read(x, archivePath);
      assert.equal(image?.mimeType, "image/png");
      assert.equal(image?.disposition, "inline");
      assert.equal(archive?.mimeType, "application/zip");
      assert.equal(archive?.disposition, "attachment");
      if (image) {
        for await (const _chunk of image.stream) {
          // Consume the stream before removing its fixture.
        }
      }
      if (archive) {
        for await (const _chunk of archive.stream) {
          // Consume the stream before removing its fixture.
        }
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects missing files, directories, and symbolic links", () => {
    const root = mkdtempSync(join(tmpdir(), "vito-file-service-"));
    try {
      const target = join(root, "target.txt");
      writeFileSync(target, "target");
      const link = join(root, "link.txt");
      symlinkSync(target, link);
      const service = new FileSystemFileService();
      assert.equal(service.read(x, join(root, "missing.txt")), undefined);
      assert.equal(service.read(x, root), undefined);
      assert.equal(service.read(x, link), undefined);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
