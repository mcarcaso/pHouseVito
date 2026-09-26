import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const publisher = fileURLToPath(new URL("../../scripts/publish-mobile-web.mjs", import.meta.url));

describe("companion web publisher", () => {
  it("publishes new assets and the entry point without removing old hashed assets", () => {
    const root = mkdtempSync(join(tmpdir(), "vito-web-publish-"));
    try {
      const stage = join(root, "stage");
      const live = join(root, "live");
      mkdirSync(join(stage, "assets"), { recursive: true });
      mkdirSync(join(live, "assets"), { recursive: true });
      writeFileSync(join(stage, "index.html"), "new entry");
      writeFileSync(join(stage, "assets", "new.js"), "new bundle");
      writeFileSync(join(live, "index.html"), "old entry");
      writeFileSync(join(live, "assets", "old.js"), "old bundle");
      execFileSync(process.execPath, [publisher, stage, live]);
      assert.equal(readFileSync(join(live, "index.html"), "utf8"), "new entry");
      assert.equal(readFileSync(join(live, "assets", "new.js"), "utf8"), "new bundle");
      assert.equal(readFileSync(join(live, "assets", "old.js"), "utf8"), "old bundle");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses incomplete exports without changing the live entry point", () => {
    const root = mkdtempSync(join(tmpdir(), "vito-web-publish-"));
    try {
      const stage = join(root, "stage");
      const live = join(root, "live");
      mkdirSync(stage);
      mkdirSync(live);
      writeFileSync(join(live, "index.html"), "old entry");
      const attempt = spawnSync(process.execPath, [publisher, stage, live]);
      assert.notEqual(attempt.status, 0);
      assert.equal(readFileSync(join(live, "index.html"), "utf8"), "old entry");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
