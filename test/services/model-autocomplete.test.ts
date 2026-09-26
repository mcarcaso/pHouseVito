import assert from "node:assert/strict";
import { it } from "node:test";
import { modelAutocompleteChoices } from "../../src/services/providers/model-autocomplete.js";

it("filters provider/model choices case-insensitively, prefers prefixes and respects Discord limits", () => {
  const choices = modelAutocompleteChoices(
    [
      "openrouter/openai/gpt-5",
      "openai-codex/gpt-5",
      "anthropic/claude-sonnet",
      ...Array.from({ length: 30 }, (_, i) => `test/gpt-${i}`),
      "long/" + "a".repeat(101),
    ],
    "GPT",
  );
  assert.equal(choices.length, 25);
  assert.ok(choices.every((choice) => choice.toLowerCase().includes("gpt")));
  assert.deepEqual(
    modelAutocompleteChoices(["openrouter/openai/gpt-5", "gpt-provider/model"], "gpt"),
    ["gpt-provider/model", "openrouter/openai/gpt-5"],
  );
});
