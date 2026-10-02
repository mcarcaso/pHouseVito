import assert from "node:assert/strict";
import { it } from "node:test";
import { buildSystemPrompt } from "../../src/services/orchestrator/system-prompt.js";

it("permits source work while requiring owner-controlled restart and safe web builds", () => {
  const text = buildSystemPrompt({
    soul: "Vito",
    systemInstructions: "Never restart yourself.",
    botName: "Vito",
  });
  assert.match(text, /editable source checkout/);
  assert.match(text, /never restart Vito yourself/);
  assert.match(text, /Build companion web assets away from the live served mobile\/dist/);
});
