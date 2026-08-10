import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getEffectiveSettings } from "../../src/services/vito/settings.js";
import {
  vitoConfigSchema,
  type Settings,
  type VitoConfig,
} from "../../src/shared/schemas/vito-config.js";

function createConfig(
  args: {
    settings?: Settings;
    channelSettings?: Settings;
    sessionSettings?: Settings;
  } = {},
): VitoConfig {
  return {
    settings: args.settings ?? {},
    channels: {
      discord: {
        enabled: true,
        settings: args.channelSettings,
      },
    },
    sessions: args.sessionSettings ? { "discord:session": args.sessionSettings } : {},
    cron: { jobs: [] },
  };
}

describe("getEffectiveSettings", () => {
  it("migrates legacy Pi configuration into global settings", () => {
    const config = vitoConfigSchema.parse({
      settings: { harness: "pi-coding-agent" },
      harnesses: {
        "pi-coding-agent": {
          model: { provider: "anthropic", name: "legacy-model" },
          thinkingLevel: "low",
        },
      },
      channels: {
        discord: { enabled: true, settings: { harness: "pi-coding-agent" } },
      },
      sessions: { default: { harness: "pi-coding-agent" } },
      cron: { jobs: [] },
    });

    assert.equal(config.settings["pi-coding-agent"]?.model?.name, "legacy-model");
    assert.equal("harness" in config.settings, false);
    assert.equal("harness" in (config.channels.discord.settings ?? {}), false);
    assert.equal("harness" in (config.sessions?.default ?? {}), false);
    assert.equal("harnesses" in config, false);
  });

  it("provides required defaults", () => {
    const settings = getEffectiveSettings(createConfig(), "discord", "discord:session");

    assert.equal(settings.streamMode, "stream");
    assert.equal(settings.traceMessageUpdates, false);
  });

  it("resolves scalar settings from global to channel to session", () => {
    const config = createConfig({
      settings: {
        streamMode: "stream",
        customInstructions: "global",
        requireMention: true,
        traceMessageUpdates: false,
        timezone: "America/Toronto",
      },
      channelSettings: {
        streamMode: "bundled",
        customInstructions: "channel",
        traceMessageUpdates: true,
        timezone: "Europe/London",
      },
      sessionSettings: {
        streamMode: "final",
        customInstructions: "session",
        requireMention: false,
        timezone: "Asia/Tokyo",
      },
    });

    const settings = getEffectiveSettings(config, "discord", "discord:session");

    assert.deepEqual(settings, {
      streamMode: "final",
      customInstructions: "session",
      requireMention: false,
      traceMessageUpdates: true,
      timezone: "Asia/Tokyo",
      "pi-coding-agent": undefined,
      memory: undefined,
    });
  });

  it("merges Pi overrides without dropping inherited fields", () => {
    const config = createConfig({
      settings: {
        "pi-coding-agent": {
          model: { provider: "openrouter", name: "global-model" },
          thinkingLevel: "low",
        },
      },
      channelSettings: {
        "pi-coding-agent": {
          openRouterProvider: "deepinfra",
          thinkingLevel: "medium",
        },
      },
      sessionSettings: {
        "pi-coding-agent": {
          thinkingLevel: "high",
        },
      },
    });

    const settings = getEffectiveSettings(config, "discord", "discord:session");

    assert.deepEqual(settings["pi-coding-agent"], {
      model: { provider: "openrouter", name: "global-model" },
      openRouterProvider: "deepinfra",
      thinkingLevel: "high",
    });
  });

  it("resolves memory settings at channel and session levels", () => {
    const config = createConfig({
      settings: {
        memory: {
          chunkContextualizerModel: { provider: "openai", name: "global-model" },
        },
      },
      channelSettings: {
        memory: {
          chunkContextualizerModel: { provider: "openrouter", name: "channel-model" },
        },
      },
      sessionSettings: {
        memory: {
          chunkContextualizerModel: { provider: "openai-codex", name: "session-model" },
        },
      },
    });

    const settings = getEffectiveSettings(config, "discord", "discord:session");

    assert.deepEqual(settings.memory, {
      chunkContextualizerModel: {
        provider: "openai-codex",
        name: "session-model",
      },
    });
  });

  it("does not mutate source configuration", () => {
    const config = createConfig({
      settings: {
        "pi-coding-agent": { thinkingLevel: "low" },
        memory: {},
      },
      channelSettings: {
        "pi-coding-agent": { thinkingLevel: "high" },
      },
    });
    const before = structuredClone(config);

    getEffectiveSettings(config, "discord", "discord:session");

    assert.deepEqual(config, before);
  });
});
