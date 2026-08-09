import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { spawnSync } from "node:child_process";

const projectRoot = process.cwd();
const tempDir = mkdtempSync(join(tmpdir(), "vito-cli-"));

function runVito(args: string[]) {
  return spawnSync(resolve(projectRoot, "vito"), args, {
    cwd: projectRoot,
    encoding: "utf-8",
  });
}

after(() => rmSync(tempDir, { recursive: true, force: true }));

describe("Vito CLI", () => {
  it("shows top-level and app command help", () => {
    const topLevel = runVito(["--help"]);
    assert.equal(topLevel.status, 0);
    assert.match(topLevel.stdout, /config\s+Validate Vito configuration/);

    const apps = runVito(["apps", "--help"]);
    assert.equal(apps.status, 0);
    assert.match(apps.stdout, /vito apps/);
  });

  it("validates a config through the stable command", () => {
    const result = runVito([
      "config",
      "validate",
      "user.example/vito.config.json",
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Valid Vito config/);
  });

  it("returns a failure for malformed configuration", () => {
    const path = join(tempDir, "invalid.json");
    writeFileSync(path, "{not json", "utf-8");
    const result = runVito(["config", "validate", path]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Invalid Vito config/);
    assert.match(result.stderr, /<root>/);
  });

  it("returns a usage error for unknown commands", () => {
    const result = runVito(["unknown"]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Unknown command/);
  });
});
