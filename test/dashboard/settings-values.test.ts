import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  removeSettingsValue,
  setSettingsValue,
} from "../../dashboard/src/components/settings/settings-values.js";

describe("settings value helpers", () => {
  it("updates scoped scalar and Pi settings without mutating the source", () => {
    const source = {
      streamMode: "stream" as const,
      "pi-coding-agent": {
        model: { provider: "anthropic", name: "old" },
        thinkingLevel: "low" as const,
      },
    };

    const updated = setSettingsValue(source, {
      path: "pi-coding-agent.model",
      value: { provider: "openrouter", name: "new" },
    });

    assert.deepEqual(source["pi-coding-agent"].model, {
      provider: "anthropic",
      name: "old",
    });
    assert.deepEqual(updated["pi-coding-agent"]?.model, {
      provider: "openrouter",
      name: "new",
    });
    assert.equal(updated["pi-coding-agent"]?.thinkingLevel, "low");
  });

  it("removes empty Pi containers while preserving sibling overrides", () => {
    const withSibling = {
      requireMention: true,
      "pi-coding-agent": { thinkingLevel: "high" as const },
    };
    assert.deepEqual(removeSettingsValue(withSibling, "pi-coding-agent.thinkingLevel"), {
      requireMention: true,
    });

    const withPiSibling = {
      "pi-coding-agent": {
        model: { provider: "anthropic", name: "sonnet" },
        thinkingLevel: "high" as const,
      },
    };
    assert.deepEqual(
      removeSettingsValue(withPiSibling, "pi-coding-agent.thinkingLevel")["pi-coding-agent"],
      { model: { provider: "anthropic", name: "sonnet" } },
    );
  });
});
