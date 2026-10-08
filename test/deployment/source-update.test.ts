import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { it } from "node:test";

it("source deployment pulls in place, restarts already-pulled code, and preserves local edits and data", () => {
  const result = execFileSync("python3", ["test/deployment/source-deployment-fixture.py"], {
    encoding: "utf-8",
  });
  assert.match(result, /source deployment scenarios passed/);
});

it("deployment restart guard blocks busy or unverifiable activity after building", () => {
  const script = readFileSync("scripts/restart-vito.sh", "utf8");
  const guard = script.match(/node --input-type=module <<'JS'\n([\s\S]*?)\nJS/)?.[1];
  assert.ok(guard);
  assert.ok(script.indexOf("Building companion") < script.indexOf(guard));
  assert.ok(script.indexOf(guard) < script.indexOf("Publishing companion"));
  for (const runs of [
    { active: 0, queued: 0 },
    { active: 1, queued: 0 },
    { active: 0, queued: 1 },
    {},
  ]) {
    const result = spawnSync(
      "node",
      [
        "--input-type=module",
        "-e",
        `
      globalThis.fetch = async () => ({ ok: true, json: async () => ({ status: "ok", runs: ${JSON.stringify(runs)} }) });
      ${guard}
    `,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, "active" in runs && runs.active === 0 && runs.queued === 0 ? 0 : 1);
  }
});
