import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getDefaults } from "../../dashboard/src/utils/defaults.js";
import { getEffectiveSettings } from "../../dashboard/src/utils/settingsResolution.js";

describe("dashboard settings defaults", () => {
  it("provides synchronous defaults before the authenticated API request completes", () => {
    assert.equal(getDefaults().streamMode, "stream");
    assert.deepEqual(getEffectiveSettings({ bot: {}, settings: {}, channels: {}, sessions: {} }), {
      streamMode: "stream",
      traceMessageUpdates: false,
      customInstructions: undefined,
      requireMention: undefined,
      timezone: undefined,
      "pi-coding-agent": undefined,
      memory: undefined,
    });
  });
});
