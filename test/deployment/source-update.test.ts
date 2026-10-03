import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { it } from "node:test";

it("source deployment pulls in place, restarts already-pulled code, and preserves local edits and data", () => {
  const result = execFileSync("python3", ["test/deployment/source-deployment-fixture.py"], {
    encoding: "utf-8",
  });
  assert.match(result, /source deployment scenarios passed/);
});
