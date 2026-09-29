import { Bot } from "grammy";
import type { Context } from "../../../context/Context.js";
import { xOrchestratorService, xSecretService, xVitoService } from "../../../lib/x.js";
import type { OutputHandler } from "../../../lib/output/OutputHandler.js";
import type { InboundEvent } from "../../../lib/types/inbound-event.js";
import type { SessionRow } from "../../../stores/sessions/SessionStore.js";
import type { ChannelManagement, ChannelService } from "../ChannelService.js";
import { TelegramOutputHandler } from "./TelegramOutputHandler.js";

export function formatTelegramSessionAlias(
  sessionId: string,
  info: { name: string; type: string },
): string {
  const threadId = sessionId.split(":")[2];
  if (info.type === "private") return `telegram: DM: ${info.name}`;
  if (threadId) return `telegram: ${info.name} / Topic`;
  return `telegram: ${info.name}`;
}

export class TelegramChannelService implements ChannelService {
  readonly name = "telegram";
  readonly capabilities = {
    typing: true,
    reactions: false,
    attachments: true,
    streaming: false,
  };

  private bot: Bot | null = null;
  private readonly steeringNotices = new Map<string, { chatId: number; messageId: number }>();

  readonly management: ChannelManagement = {
    registerCommands: async (x) => await this.setMyCommands(x),
    resolveSessionAlias: async (_x, session) => await this.resolveSessionAlias(session),
  };

  async start(x: Context): Promise<void> {
    const token = xSecretService(x).get(x, "TELEGRAM_BOT_TOKEN");
    if (!token) {
      throw new Error("TELEGRAM_BOT_TOKEN not set. Get one from @BotFather on Telegram.");
    }

    this.bot = new Bot(token);
    await this.bot.init();
    console.log(`Telegram bot started as @${this.bot.botInfo.username}`);

    // Start long polling (non-blocking)
    this.bot.start({ drop_pending_updates: true });
  }

  async stop(_x: Context): Promise<void> {
    await this.bot?.stop();
    this.bot = null;
    this.steeringNotices.clear();
  }

  /**
   * Register bot commands with Telegram's command menu
   */
  async setMyCommands(_x: Context): Promise<{ success: boolean; count: number }> {
    if (!this.bot) throw new Error("Bot not initialized");

    const commands = [
      { command: "new", description: "Fresh start — new pi session, archive chat" },
      { command: "compact", description: "Summarize older turns to free context" },
      { command: "stop", description: "Abort the current request" },
      { command: "restart", description: "Restart Vito (owner only; asks for confirmation)" },
      { command: "model", description: "Show or switch the live pi model" },
    ];

    await this.bot.api.setMyCommands(commands);
    return { success: true, count: commands.length };
  }

  /**
   * Get chat info for auto-aliasing
   */
  private async resolveSessionAlias(session: SessionRow): Promise<string | undefined> {
    const parts = session.id.split(":");
    const chatId = parts[1];
    if (!chatId) return undefined;
    const info = await this.getChatInfo(chatId);
    if (!info) return undefined;
    return formatTelegramSessionAlias(session.id, info);
  }

  private async getChatInfo(chatId: string): Promise<{ name: string; type: string } | null> {
    if (!this.bot) return null;

    try {
      const chat = await this.bot.api.getChat(chatId);

      let name: string;
      let type: string;

      if (chat.type === "private") {
        // DM - use username or first/last name
        name = chat.username
          ? `@${chat.username}`
          : `${chat.first_name || ""} ${chat.last_name || ""}`.trim();
        type = "private";
      } else {
        // Group or channel - use title
        name = chat.title || "Unknown Chat";
        type = chat.type;
      }

      return { name, type };
    } catch (err) {
      console.error(`[Telegram] Failed to get chat info for ${chatId}:`, err);
      return null;
    }
  }

  async listen(x: Context, onEvent: (event: InboundEvent) => void): Promise<() => void> {
    const bot = this.bot;
    if (!bot) throw new Error("Bot not initialized — call start() first");

    const getAllowedChatIds = (): string[] =>
      xVitoService(x).getConfig(x).channels.telegram?.allowedChatIds ?? [];

    const isAllowed = (chatId: number): boolean => {
      const allowedChatIds = getAllowedChatIds();
      return allowedChatIds.length === 0 || allowedChatIds.includes(String(chatId));
    };

    bot.callbackQuery(/^vito-steer:(\d+)$/, async (ctx) => {
      const origin = ctx.callbackQuery.message;
      if (!origin || !isAllowed(origin.chat.id)) {
        await ctx.answerCallbackQuery({ text: "This message is no longer available." });
        return;
      }
      const threadId = "message_thread_id" in origin ? origin.message_thread_id : undefined;
      const sessionKey = threadId
        ? `telegram:${origin.chat.id}:${threadId}`
        : `telegram:${origin.chat.id}`;
      const id = `${origin.chat.id}:${ctx.match[1]}`;
      const result = await xOrchestratorService(x).steerQueued(
        x,
        sessionKey,
        id,
        String(ctx.from.id),
      );
      await ctx.answerCallbackQuery({
        text: result === "steered" ? "Steering requested." : `Cannot steer: ${result}.`,
      });
      if (result === "steered" || result === "expired") {
        const notice = this.steeringNotices.get(id);
        this.steeringNotices.delete(id);
        if (notice) await bot.api.deleteMessage(notice.chatId, notice.messageId).catch(() => {});
        else {
          await bot.api
            .editMessageReplyMarkup(origin.chat.id, origin.message_id, {
              reply_markup: { inline_keyboard: [] },
            })
            .catch(() => {});
        }
      }
    });

    const dispatch = (event: InboundEvent, messageId: number, senderId?: number) => {
      const id = `${event.target}:${messageId}`;
      const active = xOrchestratorService(x)
        .listRuns(x)
        .some((run) => run.sessionKey === event.sessionKey && run.status === "active");
      event.raw = {
        ...(event.raw as object),
        message: (event.raw as { message?: unknown }).message,
        steeringAuthorId: senderId === undefined ? undefined : String(senderId),
      };
      const completion = Promise.resolve(onEvent(event));
      if (
        active &&
        senderId !== undefined &&
        !event.attachments?.length &&
        event.content.trim() &&
        !event.content.startsWith("/")
      ) {
        void bot.api
          .sendMessage(event.target, "Message queued. Redirect the current turn?", {
            ...(event.sessionKey.split(":")[2]
              ? { message_thread_id: Number(event.sessionKey.split(":")[2]) }
              : {}),
            disable_notification: true,
            reply_parameters: { message_id: messageId, allow_sending_without_reply: true },
            reply_markup: {
              inline_keyboard: [[{ text: "Steer now", callback_data: `vito-steer:${messageId}` }]],
            },
          })
          .then((notice) => {
            this.steeringNotices.set(id, { chatId: notice.chat.id, messageId: notice.message_id });
            void completion.then(() => {
              const current = this.steeringNotices.get(id);
              this.steeringNotices.delete(id);
              if (current)
                void bot.api.deleteMessage(current.chatId, current.messageId).catch(() => {});
            });
          })
          .catch((error) => console.warn(`[Telegram] Could not offer steering: ${error}`));
      }
      void completion.catch((error) => console.error(`[Telegram] Inbound failed: ${error}`));
    };

    // Text messages
    bot.on("message:text", (ctx) => {
      console.log(`[Telegram] 📨 Received text message from chat ${ctx.chat.id}`);
      console.log(`[Telegram] Message content: "${ctx.message.text?.substring(0, 50)}..."`);
      console.log(`[Telegram] Allowed chat IDs: ${JSON.stringify(getAllowedChatIds())}`);
      console.log(`[Telegram] Is allowed: ${isAllowed(ctx.chat.id)}`);

      if (!isAllowed(ctx.chat.id)) {
        console.log(`[Telegram] ❌ Chat ${ctx.chat.id} not allowed - ignoring message`);
        return;
      }

      // Check if bot was mentioned
      // Private chats are always "mentioned" (direct conversation)
      // Groups: check for @botname in the text
      const isPrivate = ctx.chat.type === "private";
      const botUsername = bot.botInfo.username;
      const isMentionedInText = !!(
        botUsername && ctx.message.text.toLowerCase().includes(`@${botUsername.toLowerCase()}`)
      );
      const hasMention = isPrivate || isMentionedInText;

      // Normalize bot @mention to @BotName
      const botName = xVitoService(x).getConfig(x).bot?.name || "Vito";
      let content = ctx.message.text;
      if (botUsername) {
        // In groups, Telegram commands arrive as /command@botusername.
        // Strip that suffix so orchestrator command matching sees /command.
        content = content.replace(new RegExp(`^/(\\w+)@${botUsername}(?=\\s|$)`, "i"), "/$1");
        content = content.replace(new RegExp(`@${botUsername}`, "gi"), `@${botName}`);
      }

      // Include thread ID in session key for forum topics (each topic = separate session)
      const threadId = ctx.message.message_thread_id;
      const sessionKey = threadId
        ? `telegram:${ctx.chat.id}:${threadId}`
        : `telegram:${ctx.chat.id}`;

      const event: InboundEvent = {
        sessionKey,
        channel: "telegram",
        target: String(ctx.chat.id),
        author: ctx.from?.username || ctx.from?.first_name || "user",
        timestamp: Date.now(),
        content,
        raw: ctx,
        hasMention,
      };
      console.log(
        `[Telegram] ✅ Firing onEvent for chat ${ctx.chat.id}${hasMention ? "" : " (no @mention)"}${threadId ? ` (thread ${threadId})` : ""}`,
      );
      dispatch(event, ctx.message.message_id, ctx.from?.id);
    });

    // Helper to detect @mention in captions/text for groups
    const checkMention = (chatType: string, text?: string): boolean => {
      if (chatType === "private") return true;
      const botUsername = bot.botInfo.username;
      return !!(botUsername && text?.toLowerCase().includes(`@${botUsername.toLowerCase()}`));
    };

    // Helper to normalize @botusername → @BotName in text
    const normalizeContent = (text: string): string => {
      const botUsername = bot.botInfo.username;
      const botName = xVitoService(x).getConfig(x).bot?.name || "Vito";
      if (botUsername) {
        return text
          .replace(new RegExp(`^/(\\w+)@${botUsername}(?=\\s|$)`, "i"), "/$1")
          .replace(new RegExp(`@${botUsername}`, "gi"), `@${botName}`);
      }
      return text;
    };

    // Photo messages
    bot.on("message:photo", async (ctx) => {
      if (!isAllowed(ctx.chat.id)) return;

      const photo = ctx.message.photo[ctx.message.photo.length - 1]; // largest
      const file = await ctx.api.getFile(photo.file_id);
      const url = `https://api.telegram.org/file/bot${bot.token}/${file.file_path}`;
      const hasMention = checkMention(ctx.chat.type, ctx.message.caption);
      const threadId = ctx.message.message_thread_id;
      const sessionKey = threadId
        ? `telegram:${ctx.chat.id}:${threadId}`
        : `telegram:${ctx.chat.id}`;

      const event: InboundEvent = {
        sessionKey,
        channel: "telegram",
        target: String(ctx.chat.id),
        author: ctx.from?.username || ctx.from?.first_name || "user",
        timestamp: Date.now(),
        content: normalizeContent(ctx.message.caption || ""),
        hasMention,
        attachments: [
          {
            type: "image",
            url,
            mimeType: "image/jpeg",
            filename: file.file_path?.split("/").pop() || "photo.jpg",
          },
        ],
        raw: ctx,
      };
      dispatch(event, ctx.message.message_id, ctx.from?.id);
    });

    // Document messages
    bot.on("message:document", async (ctx) => {
      if (!isAllowed(ctx.chat.id)) return;

      const doc = ctx.message.document;
      const file = await ctx.api.getFile(doc.file_id);
      const url = `https://api.telegram.org/file/bot${bot.token}/${file.file_path}`;
      const hasMention = checkMention(ctx.chat.type, ctx.message.caption);
      const threadId = ctx.message.message_thread_id;
      const sessionKey = threadId
        ? `telegram:${ctx.chat.id}:${threadId}`
        : `telegram:${ctx.chat.id}`;

      const event: InboundEvent = {
        sessionKey,
        channel: "telegram",
        target: String(ctx.chat.id),
        author: ctx.from?.username || ctx.from?.first_name || "user",
        timestamp: Date.now(),
        content: normalizeContent(ctx.message.caption || ""),
        hasMention,
        attachments: [
          {
            type: doc.mime_type?.startsWith("audio/") ? "audio" : "file",
            url,
            mimeType: doc.mime_type || "application/octet-stream",
            filename: doc.file_name || "document",
          },
        ],
        raw: ctx,
      };
      dispatch(event, ctx.message.message_id, ctx.from?.id);
    });

    // Voice messages
    bot.on("message:voice", async (ctx) => {
      if (!isAllowed(ctx.chat.id)) return;

      const voice = ctx.message.voice;
      const file = await ctx.api.getFile(voice.file_id);
      const url = `https://api.telegram.org/file/bot${bot.token}/${file.file_path}`;
      // Voice messages don't have captions, treat as hasMention in private chats
      const hasMention = ctx.chat.type === "private";
      const threadId = ctx.message.message_thread_id;
      const sessionKey = threadId
        ? `telegram:${ctx.chat.id}:${threadId}`
        : `telegram:${ctx.chat.id}`;

      const event: InboundEvent = {
        sessionKey,
        channel: "telegram",
        target: String(ctx.chat.id),
        author: ctx.from?.username || ctx.from?.first_name || "user",
        timestamp: Date.now(),
        content: normalizeContent(ctx.message.caption || ""),
        hasMention,
        attachments: [
          {
            type: "audio",
            url,
            mimeType: voice.mime_type || "audio/ogg",
            filename: "voice_message.ogg",
          },
        ],
        raw: ctx,
      };
      dispatch(event, ctx.message.message_id, ctx.from?.id);
    });

    // Audio messages
    bot.on("message:audio", async (ctx) => {
      if (!isAllowed(ctx.chat.id)) return;

      const audio = ctx.message.audio;
      const file = await ctx.api.getFile(audio.file_id);
      const url = `https://api.telegram.org/file/bot${bot.token}/${file.file_path}`;
      // Audio files can have captions
      const hasMention = checkMention(ctx.chat.type, ctx.message.caption);
      const threadId = ctx.message.message_thread_id;
      const sessionKey = threadId
        ? `telegram:${ctx.chat.id}:${threadId}`
        : `telegram:${ctx.chat.id}`;

      const event: InboundEvent = {
        sessionKey,
        channel: "telegram",
        target: String(ctx.chat.id),
        author: ctx.from?.username || ctx.from?.first_name || "user",
        timestamp: Date.now(),
        content: normalizeContent(ctx.message.caption || ""),
        hasMention,
        attachments: [
          {
            type: "audio",
            url,
            mimeType: audio.mime_type || "audio/mpeg",
            filename: audio.file_name || "audio.mp3",
          },
        ],
        raw: ctx,
      };
      dispatch(event, ctx.message.message_id, ctx.from?.id);
    });

    return () => {
      // Cleanup handled by stop()
    };
  }

  createOutputHandler(_x: Context, event: InboundEvent): OutputHandler {
    if (!this.bot) throw new Error("Telegram bot not initialized");
    return new TelegramOutputHandler(this.bot, event);
  }

  getCustomPrompt(_x: Context): string {
    return [
      "## Channel: Telegram",
      "You are responding in a Telegram chat. Keep responses concise and conversational.",
      "Avoid very long messages — Telegram is a chat app, not a document viewer.",
      "Use plain unformatted text with emojis. No markdown.",
    ].join("\n");
  }
}
