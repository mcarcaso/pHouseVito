import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSystemPrompt } from "../../src/services/orchestrator/system-prompt.js";

const common = {
  soul: "Vito",
  systemInstructions: "Never restart yourself.",
  botName: "Vito",
};

describe("deployment-specific system prompt", () => {
  it("permits source work while requiring owner-controlled restart", () => {
    const text = buildSystemPrompt({ ...common, deploymentMode: "source-checkout" });
    assert.match(text, /editable source checkout/);
    assert.match(text, /never restart Vito yourself/);
    assert.match(text, /Build companion web assets away from the live served mobile\/dist/);
    assert.doesNotMatch(text, /do not look for src\/ here/);
  });

  it("protects installed releases without removing mutable user extensions", () => {
    const text = buildSystemPrompt({ ...common, deploymentMode: "managed-release" });
    assert.match(text, /not an editable source checkout/);
    assert.match(text, /do not edit them, run a core build, npm install, or look for src\//);
    assert.match(text, /Mutable client config, data, skills and apps live under user\//);
    assert.match(text, /Do not switch release pointers or restart the service yourself/);
    assert.doesNotMatch(text, /Build companion web assets away from the live served/);
  });
});
