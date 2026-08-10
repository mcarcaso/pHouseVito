import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateVitoConfig } from "../../src/shared/schemas/vito-config.js";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import { formatDiscordSessionAlias } from "../../src/services/channels/discord/DiscordChannelService.js";
import { DirectChannelService } from "../../src/services/channels/direct/DirectChannelService.js";
import { formatTelegramSessionAlias } from "../../src/services/channels/telegram/TelegramChannelService.js";

describe("channel services", () => {
  it("routes direct requests through the channel transport contract", async () => {
    const x = new ObjectContext({});
    const channel = new DirectChannelService();
    await channel.start(x);
    await channel.listen(x, (event) => {
      const output = channel.createOutputHandler(x, event);
      void output.relay("Direct response").then(() => output.endMessage?.());
    });

    assert.equal(await channel.ask({ question: "Hello" }), "Direct response");
    await channel.stop(x);
  });

  it("preserves Discord guild and DM alias formats", () => {
    assert.equal(
      formatDiscordSessionAlias({ name: "general", guildName: "Server" }),
      "Server / general"
    );
    assert.equal(formatDiscordSessionAlias({ name: "DM: Mike" }), "DM: Mike");
  });

  it("normalizes legacy numeric Telegram allowlist identifiers", () => {
    const result = validateVitoConfig({
      settings: {},
      channels: { telegram: { enabled: true, allowedChatIds: [12345, "67890"] } },
      cron: { jobs: [] },
    });
    assert.equal(result.valid, true);
    if (!result.valid) return;
    assert.deepEqual(result.config.channels.telegram?.allowedChatIds, ["12345", "67890"]);
  });

  it("preserves Telegram DM, group, and topic alias formats", () => {
    assert.equal(
      formatTelegramSessionAlias("telegram:private", { name: "Mike", type: "private" }),
      "telegram: DM: Mike"
    );
    assert.equal(
      formatTelegramSessionAlias("telegram:group", { name: "Group", type: "group" }),
      "telegram: Group"
    );
    assert.equal(
      formatTelegramSessionAlias("telegram:forum:42", { name: "Forum", type: "supergroup" }),
      "telegram: Forum / Topic"
    );
  });
});
