import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import { FileVitoService } from "../../src/services/vito/FileVitoService.js";

describe("FileVitoService system content", () => {
  it("atomically persists user-owned soul content", () => {
    const root = mkdtempSync(join(tmpdir(), "vito-content-service-"));
    const x = new ObjectContext({ userDir: () => root, projectDir: () => root });
    const service = new FileVitoService();
    try {
      service.saveSoul(x, "Updated soul");
      assert.equal(service.getSoul(x), "Updated soul");
      assert.equal(readFileSync(join(root, "SOUL.md"), "utf-8"), "Updated soul");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reads project-owned system content without caching direct edits", () => {
    const root = mkdtempSync(join(tmpdir(), "vito-content-service-"));
    const x = new ObjectContext({ userDir: () => root, projectDir: () => root });
    const service = new FileVitoService();
    try {
      assert.equal(service.getSystemPrompt(x), "");
      mkdirSync(join(root, "system"));
      writeFileSync(join(root, "system", "SYSTEM.md"), "First version", "utf-8");
      assert.equal(service.getSystemPrompt(x), "First version");
      writeFileSync(join(root, "system", "SYSTEM.md"), "Direct edit", "utf-8");
      assert.equal(service.getSystemPrompt(x), "Direct edit");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
