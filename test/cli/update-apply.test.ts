import assert from "node:assert/strict";
import { test } from "node:test";
import { applyWithRollback, type ApplyHooks } from "../../src/cli/update-apply.js";
import { dataImpactSchema, updateManifestSchema } from "../../src/cli/update-manifest.js";

function hooks(failure?: string) {
  const calls: string[] = [];
  let healthCalls = 0;
  const step = (name: string) => async () => {
    calls.push(name);
    if (failure === name) throw new Error(name);
  };
  const value: ApplyHooks = {
    install: step("install"),
    stop: step("stop"),
    backup: step("backup"),
    activate: step("activate"),
    start: step("start"),
    rollback: step("rollback"),
    healthy: async () => {
      calls.push("health");
      return failure !== "health" || ++healthCalls > 1;
    },
    record: async (state) => {
      calls.push(`state:${state}`);
    },
  };
  return { calls, value };
}
test("installs before downtime, stops before backup, health-checks after activation", async () => {
  const { calls, value } = hooks();
  await applyWithRollback(value);
  assert.deepEqual(
    calls.filter((s) => !s.startsWith("state:")),
    ["install", "stop", "backup", "activate", "start", "health"],
  );
  assert.equal(calls.at(-1), "state:succeeded");
});
test("failed health stops new release and rolls back before restarting old release", async () => {
  const { calls, value } = hooks("health");
  await assert.rejects(applyWithRollback(value), /health/);
  assert.deepEqual(calls.filter((s) => !s.startsWith("state:")).slice(-4), [
    "stop",
    "rollback",
    "start",
    "health",
  ]);
  assert.equal(calls.at(-1), "state:rolled-back");
});
test("failed backup restarts unchanged release and never activates", async () => {
  const { calls, value } = hooks("backup");
  await assert.rejects(applyWithRollback(value), /backup/);
  assert.ok(!calls.includes("activate") && !calls.includes("rollback"));
  assert.ok(calls.includes("start"));
});
test("failed staging does not stop production", async () => {
  const { calls, value } = hooks("install");
  await assert.rejects(applyWithRollback(value), /install/);
  assert.ok(!calls.includes("stop"));
});
test("failed rollback is explicitly recovery-required", async () => {
  const { calls, value } = hooks("health");
  value.rollback = async () => {
    throw new Error("rollback failed");
  };
  await assert.rejects(applyWithRollback(value), /recovery failed/);
  assert.equal(calls.at(-1), "state:recovery-required");
});
test("classification cannot silently omit migration targets or claim incompatible rollback", () => {
  assert.deepEqual(dataImpactSchema.parse({ kind: "none" }), { kind: "none" });
  assert.throws(() =>
    dataImpactSchema.parse({
      kind: "compatible-migration",
      files: [],
      notes: "x",
      backwardCompatible: true,
    }),
  );
  assert.throws(() =>
    dataImpactSchema.parse({
      kind: "compatible-migration",
      files: ["../secrets.json"],
      notes: "x",
      backwardCompatible: true,
    }),
  );
  assert.throws(() =>
    dataImpactSchema.parse({
      kind: "compatible-migration",
      files: ["vito.db"],
      notes: "x",
      backwardCompatible: false,
    }),
  );
  assert.throws(() => updateManifestSchema.parse({ schema: 2, sequence: 1 }));
});
