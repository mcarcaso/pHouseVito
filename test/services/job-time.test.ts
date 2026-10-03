import assert from "node:assert/strict";
import { it } from "node:test";
import { resolveJobTime, localJobTime } from "../../src/shared/job-time.js";
it("resolves Toronto wall time in summer and winter", () => {
  assert.equal(
    resolveJobTime("2026-10-03T10:00:00", "America/Toronto"),
    "2026-10-03T14:00:00.000Z",
  );
  assert.equal(resolveJobTime("2026-12-03T10:00", "America/Toronto"), "2026-12-03T15:00:00.000Z");
});
it("rejects gaps, repeated hours, offsets and invalid calendar dates", () => {
  for (const at of [
    "2026-03-08T02:30",
    "2026-11-01T01:30",
    "2026-02-30T10:00",
    "2026-10-03T10:00-04:00",
  ])
    assert.throws(() => resolveJobTime(at, "America/Toronto"));
});
it("preserves an existing instant when converting to local input", () => {
  const old = "2026-10-03T10:00:00-07:00";
  assert.equal(
    resolveJobTime(localJobTime(old, "America/Toronto"), "America/Toronto"),
    new Date(old).toISOString(),
  );
});
