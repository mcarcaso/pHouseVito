import { Bot } from "grammy";
import type {
  Channel,
  InboundEvent,
  OutputHandler,
  OutboundMessage,
} from "../types.js";

const TELEGRAM_MAX_LENGTH = 4096;

export class TelegramChannel implements Channel {
  name = "telegram";
  capabilities = {
    typing: true,
    reactions: false,
    attachments: true,
    streaming: false,
  };

  private bot: Bot | null = null;
  private config: any;

  constructor(config: any) {
    this.config = config;
  }

  async start(): Promise<void> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      throw new Error(
        "TELEGRAM_BOT_TOKEN not set. Get one from @BotFather on Telegram."
      );
    }

    this.bot = new Bot(token);
    await this.bot.init();
    console.log(`Telegram bot started as @${this.bot.botInfo.username}`);

    // Start long polling (non-blocking)
    this.bot.start({ drop_pending_updates: true });
  }

  async stop(): Promise<void> {
    await this.bot?.stop();
    this.bot = null;
  }

  async listen(
    onEvent: (event: InboundEvent) => void
  ): Promise<() => void> {
    if (!this.bot) throw new Error("Bot not initialized — call start() first");

    const allowedChatIds: number[] =
      this.config.channels?.telegram?.allowedChatIds || [];

    const isAllowed = (chatId: number): boolean =>
      allowedChatIds.length === 0 || allowedChatIds.includes(chatId);

    // Text messages
    this.bot.on("message:text", (ctx) => {
      console.log(`[Telegram] 📨 Received text message from chat ${ctx.chat.id}`);
      console.log(`[Telegram] Message content: "${ctx.message.text?.substring(0, 50)}..."`);
      console.log(`[Telegram] Allowed chat IDs: ${JSON.stringify(allowedChatIds)}`);
      console.log(`[Telegram] Is allowed: ${isAllowed(ctx.chat.id)}`);
      
      if (!isAllowed(ctx.chat.id)) {
        console.log(`[Telegram] ❌ Chat ${ctx.chat.id} not allowed - ignoring message`);
        return;
      }

      const event: InboundEvent = {
        sessionKey: `telegram:${ctx.chat.id}`,
        channel: "telegram",
        target: String(ctx.chat.id),
        author: ctx.from?.username || ctx.from?.first_name || "user",
        timestamp: Date.now(),
        content: ctx.message.text,
        raw: ctx,
      };
      console.log(`[Telegram] ✅ Firing onEvent for chat ${ctx.chat.id}`);
      onEvent(event);
    });

    // Photo messages
    this.bot.on("message:photo", async (ctx) => {
      if (!isAllowed(ctx.chat.id)) return;

      const photo = ctx.message.photo[ctx.message.photo.length - 1]; // largest
      const file = await ctx.api.getFile(photo.file_id);
      const url = `https://api.telegram.org/file/bot${this.bot!.token}/${file.file_path}`;

      const event: InboundEvent = {
        sessionKey: `telegram:${ctx.chat.id}`,
        channel: "telegram",
        target: String(ctx.chat.id),
        author: ctx.from?.username || ctx.from?.first_name || "user",
        timestamp: Date.now(),
        content: ctx.message.caption || "",
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
      onEvent(event);
    });

    // Document messages
    this.bot.on("message:document", async (ctx) => {
      if (!isAllowed(ctx.chat.id)) return;

      const doc = ctx.message.document;
      const file = await ctx.api.getFile(doc.file_id);
      const url = `https://api.telegram.org/file/bot${this.bot!.token}/${file.file_path}`;

      const event: InboundEvent = {
        sessionKey: `telegram:${ctx.chat.id}`,
        channel: "telegram",
        target: String(ctx.chat.id),
        author: ctx.from?.username || ctx.from?.first_name || "user",
        timestamp: Date.now(),
        content: ctx.message.caption || "",
        attachments: [
          {
            type: "file",
            url,
            mimeType: doc.mime_type || "application/octet-stream",
            filename: doc.file_name || "document",
          },
        ],
        raw: ctx,
      };
      onEvent(event);
    });

    return () => {
      // Cleanup handled by stop()
    };
  }

  createHandler(event: InboundEvent): OutputHandler {
    return new TelegramOutputHandler(this.bot!, event);
  }

  getSessionKey(event: InboundEvent): string {
    return event.sessionKey;
  }

  getCustomPrompt(): string {
    return [
      "## Channel: Telegram",
      "You are responding in a Telegram chat. Keep responses concise and conversational.",
      "Avoid very long messages — Telegram is a chat app, not a document viewer.",
      "Use plain text formatting (Telegram's markdown is limited).",
    ].join("\n");
  }
}

class TelegramOutputHandler implements OutputHandler {
  private buffer = "";
  private typingInterval: ReturnType<typeof setInterval> | null = null;
  private chatId: string;

  constructor(
    private bot: Bot,
    private event: InboundEvent
  ) {
    this.chatId = event.target;
  }

  async relay(msg: OutboundMessage): Promise<void> {
    console.log(`[Telegram] relay() called with: ${msg.substring(0, 100)}...`);
    this.buffer += msg;
    console.log(`[Telegram] buffer now has ${this.buffer.length} chars`);
  }

  async startTyping(): Promise<void> {
    // Send typing action immediately, then repeat every 4s
    this.sendTypingAction();
    this.typingInterval = setInterval(() => this.sendTypingAction(), 4000);
  }

  async stopTyping(): Promise<void> {
    if (this.typingInterval) {
      clearInterval(this.typingInterval);
      this.typingInterval = null;
    }
    await this.flushBuffer();
  }

  async endMessage(): Promise<void> {
    await this.flushBuffer();
  }

  private sendTypingAction(): void {
    this.bot.api
      .sendChatAction(this.chatId, "typing")
      .catch(() => {}); // Ignore errors — typing is best-effort
  }

  private async flushBuffer(): Promise<void> {
    console.log(`[Telegram] flushBuffer() called, buffer has ${this.buffer.length} chars`);
    if (!this.buffer) return;

    const text = this.buffer;
    this.buffer = "";

    // Parse MEDIA: protocol - check if message contains media paths
    // Match MEDIA: followed by an absolute path (must start with /)
    const mediaRegex = /MEDIA:(\/[^\s\n`*"<>|]+)/g;
    const mediaMatches = [...text.matchAll(mediaRegex)];

    if (mediaMatches.length > 0) {
      // Send media files
      for (const match of mediaMatches) {
        const filePath = match[1];
        console.log(`[Telegram] Sending media file: ${filePath}`);
        
        try {
          // Determine if it's an image or document based on extension
          const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(filePath);
          
          // Use InputFile for local files (grammY pattern)
          const { InputFile } = await import("grammy");
          const inputFile = new InputFile(filePath);
          
          if (isImage) {
            await this.bot.api.sendPhoto(this.chatId, inputFile);
            console.log(`[Telegram] ✅ Sent image: ${filePath}`);
          } else {
            await this.bot.api.sendDocument(this.chatId, inputFile);
            console.log(`[Telegram] ✅ Sent document: ${filePath}`);
          }
        } catch (error) {
          console.error(`[Telegram] ❌ Failed to send media: ${error}`);
          // Fallback: send as text
          await this.bot.api.sendMessage(this.chatId, `Error sending media: ${filePath}`);
        }
      }

      // Send any remaining text (with MEDIA: tags stripped)
      const remainingText = text.replace(mediaRegex, '').trim();
      if (remainingText) {
        const chunks = splitMessage(remainingText, TELEGRAM_MAX_LENGTH);
        for (const chunk of chunks) {
          await this.bot.api.sendMessage(this.chatId, chunk);
        }
      }
    } else {
      // No media, send as text
      const chunks = splitMessage(text, TELEGRAM_MAX_LENGTH);
      console.log(`[Telegram] Sending ${chunks.length} chunk(s) to chat ${this.chatId}`);
      for (const chunk of chunks) {
        await this.bot.api.sendMessage(this.chatId, chunk);
        console.log(`[Telegram] ✅ Sent chunk of ${chunk.length} chars`);
      }
    }
  }
}

/**
 * Split text into chunks that fit within Telegram's message limit.
 * Tries to split at paragraph boundaries, then line boundaries,
 * then word boundaries, and finally does a hard split.
 */
function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitAt = -1;

    // Try paragraph boundary
    const paraIdx = remaining.lastIndexOf("\n\n", maxLength);
    if (paraIdx > 0) {
      splitAt = paraIdx;
    }

    // Try line boundary
    if (splitAt === -1) {
      const lineIdx = remaining.lastIndexOf("\n", maxLength);
      if (lineIdx > 0) {
        splitAt = lineIdx;
      }
    }

    // Try word boundary
    if (splitAt === -1) {
      const spaceIdx = remaining.lastIndexOf(" ", maxLength);
      if (spaceIdx > 0) {
        splitAt = spaceIdx;
      }
    }

    // Hard split
    if (splitAt === -1) {
      splitAt = maxLength;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n+/, ""); // trim leading newlines from next chunk
  }

  return chunks;
}
