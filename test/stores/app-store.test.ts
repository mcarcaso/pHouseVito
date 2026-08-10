import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import { appReadFileResultSchema } from "../../src/shared/schemas/app.js";
import { AppFileTooLargeError, FileAppStore } from "../../src/stores/apps/FileAppStore.js";

function createHarness() {
  const root = mkdtempSync(join(tmpdir(), "vito-app-store-"));
  const x = new ObjectContext({ appsDir: () => root });
  return { root, x, store: new FileAppStore() };
}

function createApp(root: string, name: string): string {
  const directory = join(root, name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, ".vito-app.json"), JSON.stringify({
    description: "Test app",
    port: 4000,
    url: `https://${name}.example.com`,
    createdAt: "2026-01-01T00:00:00.000Z",
  }));
  return directory;
}

describe("FileAppStore", () => {
  it("validates metadata and filters apps consistently", () => {
    const { root, x, store } = createHarness();
    try {
      createApp(root, "alpha");
      const invalid = join(root, "invalid");
      mkdirSync(invalid);
      writeFileSync(join(invalid, ".vito-app.json"), JSON.stringify({ port: "bad" }));

      assert.equal(store.list(x, {}).length, 1);
      assert.equal(store.count(x, { urls: ["https://alpha.example.com"] }), 1);
      assert.equal(store.list(x, { names: ["missing"] }).length, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("discovers safe files while excluding dependencies and hidden files", () => {
    const { root, x, store } = createHarness();
    try {
      const directory = createApp(root, "alpha");
      mkdirSync(join(directory, "src"));
      writeFileSync(join(directory, "src", "index.ts"), "export {};");
      mkdirSync(join(directory, "node_modules"));
      writeFileSync(join(directory, "node_modules", "ignored.js"), "");
      writeFileSync(join(directory, ".secret"), "secret");

      const files = store.list(x, { names: ["alpha"], includeFiles: true })[0].files ?? [];
      assert.deepEqual(files.map((file) => file.path), [
        ".vito-app.json",
        "src",
        "src/index.ts",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reads bounded files and rejects symlinks", () => {
    const { root, x, store } = createHarness();
    const outside = join(root, "..", `app-outside-${Date.now()}.txt`);
    try {
      const directory = createApp(root, "alpha");
      writeFileSync(join(directory, "small.txt"), "hello");
      writeFileSync(join(directory, "large.txt"), "too large");
      writeFileSync(outside, "outside");
      symlinkSync(outside, join(directory, "link.txt"));

      assert.deepEqual(appReadFileResultSchema.parse(store.cmd(x, {
        type: "read-file",
        appName: "alpha",
        path: "small.txt",
      })), { content: "hello", size: 5 });
      assert.equal(store.cmd(x, {
        type: "read-file",
        appName: "alpha",
        path: "link.txt",
      }), undefined);
      assert.throws(() => store.cmd(x, {
        type: "read-file",
        appName: "alpha",
        path: "large.txt",
        maxBytes: 2,
      }), AppFileTooLargeError);
    } finally {
      rmSync(outside, { force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("deletes only validated app records", () => {
    const { root, x, store } = createHarness();
    try {
      createApp(root, "alpha");
      assert.equal(store.delete(x, { names: ["../outside", "alpha"] }), 1);
      assert.equal(store.count(x, {}), 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
