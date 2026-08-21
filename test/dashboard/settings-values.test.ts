import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  removeSettingsValue,
  setSettingsValue,
} from "../../dashboard/src/components/settings/settings-values.js";
import { settingsSchema } from "../../src/shared/schemas/vito-config.js";

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
    assert.equal(settingsSchema.safeParse(updated).success, true);
  });

  it("updates and removes the same cascading fields at every scope", () => {
    const withMemory = setSettingsValue(setSettingsValue({}, { path: "timezone", value: "UTC" }), {
      path: "memory.chunkContextualizerModel",
      value: { provider: "openrouter", name: "openai/gpt-5.4-nano" },
    });

    assert.equal(settingsSchema.safeParse(withMemory).success, true);
    assert.deepEqual(removeSettingsValue(withMemory, "memory.chunkContextualizerModel"), {
      timezone: "UTC",
    });
    assert.deepEqual(removeSettingsValue(withMemory, "timezone"), {
      memory: {
        chunkContextualizerModel: {
          provider: "openrouter",
          name: "openai/gpt-5.4-nano",
        },
      },
    });
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
