import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { it } from "node:test";

it("source deployment protects preparation, WAL snapshots, code rollback and unrelated apps", () => {
  const result = execFileSync("python3", ["test/deployment/source-deployment-fixture.py"], {
    encoding: "utf-8",
  });
  assert.match(result, /source deployment scenarios passed/);
});
