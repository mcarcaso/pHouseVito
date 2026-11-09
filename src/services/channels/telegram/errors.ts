import { GrammyError, HttpError } from "grammy";
import type { Bot, Context } from "grammy";

function isExpiredCallback(error: unknown): boolean {
  return (
    error instanceof GrammyError &&
    error.method === "answerCallbackQuery" &&
    error.error_code === 400 &&
    /query is too old|query ID is invalid/i.test(error.description)
  );
}

/** An expired acknowledgement must not interrupt steering or button cleanup. */
export async function answerTelegramCallback(ctx: Context, text: string): Promise<void> {
  try {
    await ctx.answerCallbackQuery({ text });
  } catch (error) {
    if (!isExpiredCallback(error)) throw error;
  }
}

export function installTelegramErrorHandler(bot: Bot): void {
  bot.catch(async ({ error, ctx }) => {
    // Never log the wrapped context, HTTP URL, or payload: they can contain tokens
    // and private messages. API error codes are enough to diagnose this boundary.
    const kind =
      error instanceof GrammyError
        ? `API ${error.method} (${error.error_code})`
        : error instanceof HttpError
          ? "network request"
          : "update handler";
    console.error(`[Telegram] ${kind} failed for update ${ctx.update.update_id}`);

    if (
      error instanceof GrammyError &&
      error.method === "getFile" &&
      error.error_code === 400 &&
      /file is too big/i.test(error.description) &&
      ctx.chat
    ) {
      try {
        await ctx.reply(
          "Telegram couldn't download that attachment because it is too large. Please send a smaller file.",
        );
      } catch {
        console.warn(
          `[Telegram] Could not send attachment error for update ${ctx.update.update_id}`,
        );
      }
    }
  });
}
