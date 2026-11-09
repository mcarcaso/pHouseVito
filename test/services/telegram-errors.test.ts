import assert from "node:assert/strict";
import { test } from "node:test";
import { Bot, Context, GrammyError } from "grammy";
import {
  answerTelegramCallback,
  installTelegramErrorHandler,
} from "../../src/services/channels/telegram/errors.js";

const botInfo = {
  id: 1,
  is_bot: true as const,
  first_name: "Test",
  username: "test_bot",
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
};
const user = { id: 2, is_bot: false as const, first_name: "Test user" };
const chat = { id: 2, type: "private" as const, first_name: "Test user" };

test("expired callback acknowledgements resolve; other errors still propagate", async () => {
  const bot = new Bot("test-token", { botInfo });
  let description =
    "Bad Request: query is too old and response timeout expired or query ID is invalid";
  bot.api.config.use(async () => ({ ok: false, error_code: 400, description }));
  const ctx = new Context(
    {
      update_id: 1,
      callback_query: { id: "old", from: user, chat_instance: "test", data: "test" },
    },
    bot.api,
    botInfo,
  );
  await assert.doesNotReject(answerTelegramCallback(ctx, "Steering requested."));
  description = "Bad Request: unrelated failure";
  await assert.rejects(answerTelegramCallback(ctx, "test"), GrammyError);
});

test(
  "polling survives oversized files, failed error replies, and unexpected middleware errors",
  { timeout: 5000 },
  async (t) => {
    const bot = new Bot("test-token", { botInfo });
    const errors: string[] = [];
    t.mock.method(console, "error", (...args: unknown[]) => errors.push(args.join(" ")));
    t.mock.method(console, "warn", (...args: unknown[]) => errors.push(args.join(" ")));
    installTelegramErrorHandler(bot);
    const replies: string[] = [];
    const processed: string[] = [];
    let finish!: () => void;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let sentUpdates = false;
    bot.api.config.use(async (_previous, method, payload) => {
      if (method === "getFile")
        return { ok: false, error_code: 400, description: "Bad Request: file is too big" };
      if (method === "sendMessage") {
        replies.push(String((payload as { text: string }).text));
        return { ok: false, error_code: 403, description: "Forbidden: blocked" };
      }
      if (method === "getUpdates") {
        if (sentUpdates) return { ok: true, result: [] };
        sentUpdates = true;
        return {
          ok: true,
          result: ["oversized", "unexpected", "healthy"].map((text, index) => ({
            update_id: index + 1,
            message: { message_id: index + 1, date: 1, chat, from: user, text },
          })),
        };
      }
      return { ok: true, result: true };
    });
    bot.on("message:text", async (ctx) => {
      const text = ctx.message.text;
      processed.push(text);
      if (text === "oversized") await ctx.api.getFile("private-file-id");
      if (text === "unexpected") throw new Error("private-message-and-token");
      if (text === "healthy") {
        await bot.stop();
        finish();
      }
    });
    const polling = bot.start();
    try {
      await done;
      await polling;
      assert.deepEqual(processed, ["oversized", "unexpected", "healthy"]);
      assert.equal(replies.length, 1);
      assert.match(replies[0], /too large/);
      assert.equal(bot.isRunning(), false);
      assert.ok(errors.some((line) => line.includes("getFile (400)")));
      assert.ok(errors.some((line) => line.includes("Could not send attachment error")));
      assert.ok(!errors.join(" ").includes("private-message-and-token"));
      assert.ok(!errors.join(" ").includes("private-file-id"));
    } finally {
      if (bot.isRunning()) await bot.stop();
    }
  },
);
