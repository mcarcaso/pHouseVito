import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import { driveReadResultSchema } from "../../src/lib/types/drive.js";
import { FileDriveStore } from "../../src/stores/drive/FileDriveStore.js";

function createHarness() {
  const root = mkdtempSync(join(tmpdir(), "vito-drive-store-"));
  const x = new ObjectContext({ driveDir: () => root });
  return { root, x, store: new FileDriveStore() };
}

describe("FileDriveStore", () => {
  it("creates and lists directory aggregates", () => {
    const { root, x, store } = createHarness();
    try {
      store.create(x, { kind: "directory", path: "docs" });
      store.create(x, { kind: "file", path: "docs/readme.txt", content: Buffer.from("hello") });

      const rootEntries = store.list(x, { parentPaths: [""] });
      assert.deepEqual(
        rootEntries.map((entry) => entry.path),
        ["docs"],
      );
      const docsEntries = store.list(x, { parentPaths: ["docs"] });
      assert.equal(docsEntries[0].size, 5);
      assert.equal(store.count(x, { kinds: ["file"] }), 1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("cascades directory visibility and applies file overrides", () => {
    const { root, x, store } = createHarness();
    try {
      store.create(x, { kind: "file", path: "site/index.html", content: Buffer.from("site") });
      store.update(x, {
        path: "site",
        changes: { directoryMeta: { isPublic: true, name: "Site" } },
      });
      assert.equal(store.list(x, { paths: ["site/index.html"] })[0].isPublic, true);

      store.update(x, {
        path: "site/index.html",
        changes: { fileIsPublic: false },
      });
      assert.equal(store.list(x, { paths: ["site/index.html"] })[0].isPublic, false);

      store.update(x, {
        path: "site/index.html",
        changes: { fileIsPublic: null },
      });
      assert.equal(store.list(x, { paths: ["site/index.html"] })[0].isPublic, true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns validated read streams through cmd", async () => {
    const { root, x, store } = createHarness();
    try {
      store.create(x, { kind: "file", path: "file.txt", content: Buffer.from("content") });
      const result = driveReadResultSchema.parse(
        store.cmd(x, {
          type: "read",
          path: "file.txt",
        }),
      );
      const chunks: Buffer[] = [];
      for await (const chunk of result.stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      assert.equal(Buffer.concat(chunks).toString("utf-8"), "content");
      assert.equal(store.cmd(x, { type: "unknown" }), undefined);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("safely extracts single-root site archives", async () => {
    const { root, x, store } = createHarness();
    const source = mkdtempSync(join(tmpdir(), "vito-drive-site-"));
    const archivePath = join(source, "site.zip");
    try {
      mkdirSync(join(source, "bundle"));
      writeFileSync(join(source, "bundle", "index.html"), "site");
      execFileSync("zip", ["-qr", archivePath, "bundle"], { cwd: source });
      store.create(x, {
        kind: "site",
        path: "website",
        archive: readFileSync(archivePath),
      });
      const result = driveReadResultSchema.parse(
        store.cmd(x, {
          type: "read",
          path: "website",
          indexFallback: true,
        }),
      );
      const chunks: Buffer[] = [];
      for await (const chunk of result.stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      assert.equal(Buffer.concat(chunks).toString("utf-8"), "site");
    } finally {
      rmSync(source, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects traversal and symbolic-link access", () => {
    const { root, x, store } = createHarness();
    const outside = join(root, "..", `drive-outside-${Date.now()}.txt`);
    try {
      writeFileSync(outside, "outside");
      symlinkSync(outside, join(root, "link.txt"));
      assert.throws(() =>
        store.create(x, {
          kind: "file",
          path: "../outside.txt",
          content: Buffer.from("bad"),
        }),
      );
      assert.equal(store.list(x, { paths: ["link.txt"] }).length, 0);
      assert.equal(store.cmd(x, { type: "read", path: "link.txt" }), undefined);
      assert.equal(store.delete(x, { paths: [""] }), 0);
    } finally {
      rmSync(outside, { force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });
});
