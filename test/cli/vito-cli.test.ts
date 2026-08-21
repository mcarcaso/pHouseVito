import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  it("shows top-level, app, and memory command help", () => {
    const topLevel = runVito(["--help"]);
    assert.equal(topLevel.status, 0);
    assert.match(topLevel.stdout, /config\s+Validate Vito configuration/);

    const apps = runVito(["apps", "--help"]);
    assert.equal(apps.status, 0);
    assert.match(apps.stdout, /vito apps/);

    const memory = runVito(["memory", "--help"]);
    assert.equal(memory.status, 0);
    assert.match(memory.stdout, /vito memory search/);
  });

  it("validates a config through the stable command", () => {
    const result = runVito(["config", "validate", "user.example/vito.config.json"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Valid Vito config/);
  });

  it("atomically migrates legacy Pi configuration", () => {
    const path = join(tempDir, "legacy.json");
    writeFileSync(
      path,
      JSON.stringify({
        settings: { harness: "pi-coding-agent", streamMode: "final" },
        harnesses: {
          "pi-coding-agent": {
            model: { provider: "openrouter", name: "legacy-model" },
          },
        },
        channels: {},
        sessions: { default: { harness: "pi-coding-agent" } },
        cron: { jobs: [] },
      }),
      "utf-8",
    );

    const result = runVito(["config", "migrate", path]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Migrated Vito config/);
    const migrated: unknown = JSON.parse(readFileSync(path, "utf-8"));
    assert.deepEqual(migrated, {
      settings: {
        streamMode: "final",
        "pi-coding-agent": {
          model: { provider: "openrouter", name: "legacy-model" },
        },
      },
      channels: {},
      sessions: { default: {} },
      cron: { jobs: [] },
    });

    const secondRun = runVito(["config", "migrate", path]);
    assert.equal(secondRun.status, 0, secondRun.stderr);
    assert.match(secondRun.stdout, /already current/);
  });

  it("returns a failure for malformed configuration", () => {
    const path = join(tempDir, "invalid.json");
    writeFileSync(path, "{not json", "utf-8");
    const result = runVito(["config", "validate", path]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Invalid Vito config/);
    assert.match(result.stderr, /<root>/);
  });

  it("rejects malformed memory search arguments before opening storage", () => {
    const result = runVito(["memory", "search", "query", "--limit", "0"]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /greater than or equal to 1/);
  });

  it("returns a usage error for unknown commands", () => {
    const result = runVito(["unknown"]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Unknown command/);
  });
});
