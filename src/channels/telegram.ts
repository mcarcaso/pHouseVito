import { Bot } from "grammy";
import * as path from "path";
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

  /**
   * Register bot commands with Telegram's command menu
   */
  async setMyCommands(): Promise<{ success: boolean; count: number }> {
    if (!this.bot) throw new Error("Bot not initialized");
    
    const commands = [
      { command: "new", description: "Fresh start — new pi session, archive chat" },
      { command: "compact", description: "Summarize older turns to free context" },
      { command: "stop", description: "Abort the current request" },
    ];
    
    await this.bot.api.setMyCommands(commands);
    return { success: true, count: commands.length };
  }

  /**
   * Get chat info for auto-aliasing
   */
  async getChatInfo(chatId: string): Promise<{ name: string; type: string } | null> {
    if (!this.bot) return null;
    
    try {
      const chat = await this.bot.api.getChat(chatId);
      
      let name: string;
      let type: string;
      
      if (chat.type === "private") {
        // DM - use username or first/last name
        const user = chat as any;
        name = user.username ? `@${user.username}` : `${user.first_name || ""} ${user.last_name || ""}`.trim();
        type = "private";
      } else {
        // Group or channel - use title
        name = (chat as any).title || "Unknown Chat";
        type = chat.type;
      }
      
      return { name, type };
    } catch (err) {
      console.error(`[Telegram] Failed to get chat info for ${chatId}:`, err);
      return null;
    }
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

      // Check if bot was mentioned
      // Private chats are always "mentioned" (direct conversation)
      // Groups: check for @botname in the text
      const isPrivate = ctx.chat.type === "private";
      const botUsername = this.bot!.botInfo.username;
      const isMentionedInText = !!(botUsername && ctx.message.text.toLowerCase().includes(`@${botUsername.toLowerCase()}`));
      const hasMention = isPrivate || isMentionedInText;

      // Normalize bot @mention to @BotName
      const botName = this.config.bot?.name;
      let content = ctx.message.text;
      if (botUsername) {
        content = content.replace(new RegExp(`@${botUsername}`, "gi"), `@${botName}`);
      }

      // Debug: log raw message_thread_id
      console.log(`[Telegram] DEBUG: ctx.message.message_thread_id = ${ctx.message.message_thread_id}, ctx.chat.type = ${ctx.chat.type}, is_forum = ${(ctx.chat as any).is_forum}`);
      
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
      console.log(`[Telegram] ✅ Firing onEvent for chat ${ctx.chat.id}${hasMention ? '' : ' (no @mention)'}${threadId ? ` (thread ${threadId})` : ''}`);
      onEvent(event);
    });

    // Helper to detect @mention in captions/text for groups
    const checkMention = (chatType: string, text?: string): boolean => {
      if (chatType === "private") return true;
      const botUsername = this.bot!.botInfo.username;
      return !!(botUsername && text?.toLowerCase().includes(`@${botUsername.toLowerCase()}`));
    };

    // Helper to normalize @botusername → @BotName in text
    const normalizeContent = (text: string): string => {
      const botUsername = this.bot!.botInfo.username;
      const botName = this.config.bot?.name;
      if (botUsername) {
        return text.replace(new RegExp(`@${botUsername}`, "gi"), `@${botName}`);
      }
      return text;
    };

    // Photo messages
    this.bot.on("message:photo", async (ctx) => {
      if (!isAllowed(ctx.chat.id)) return;

      const photo = ctx.message.photo[ctx.message.photo.length - 1]; // largest
      const file = await ctx.api.getFile(photo.file_id);
      const url = `https://api.telegram.org/file/bot${this.bot!.token}/${file.file_path}`;
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
      onEvent(event);
    });

    // Document messages
    this.bot.on("message:document", async (ctx) => {
      if (!isAllowed(ctx.chat.id)) return;

      const doc = ctx.message.document;
      const file = await ctx.api.getFile(doc.file_id);
      const url = `https://api.telegram.org/file/bot${this.bot!.token}/${file.file_path}`;
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
      onEvent(event);
    });

    // Voice messages
    this.bot.on("message:voice", async (ctx) => {
      if (!isAllowed(ctx.chat.id)) return;

      const voice = ctx.message.voice;
      const file = await ctx.api.getFile(voice.file_id);
      const url = `https://api.telegram.org/file/bot${this.bot!.token}/${file.file_path}`;
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
      onEvent(event);
    });

    // Audio messages
    this.bot.on("message:audio", async (ctx) => {
      if (!isAllowed(ctx.chat.id)) return;

      const audio = ctx.message.audio;
      const file = await ctx.api.getFile(audio.file_id);
      const url = `https://api.telegram.org/file/bot${this.bot!.token}/${file.file_path}`;
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
      "Use plain unformatted text with emojis. No markdown.",
    ].join("\n");
  }
}

class TelegramOutputHandler implements OutputHandler {
  private buffer = "";
  private typingInterval: ReturnType<typeof setInterval> | null = null;
  private chatId: string;
  private threadId?: number;

  constructor(
    private bot: Bot,
    private event: InboundEvent
  ) {
    this.chatId = event.target;
    // Extract threadId from session key: "telegram:chatId:threadId" or "telegram:chatId"
    const parts = event.sessionKey.split(":");
    this.threadId = parts.length > 2 ? parseInt(parts[2], 10) : undefined;
  }

  async relay(msg: OutboundMessage): Promise<void> {
    console.log(`[Telegram] relay() called with: ${msg.substring(0, 100)}...`);
    this.buffer += msg;
    console.log(`[Telegram] buffer now has ${this.buffer.length} chars`);
  }

  async startTyping(): Promise<void> {
    console.log(`[Telegram] startTyping() called for chat ${this.chatId}${this.threadId ? ` thread ${this.threadId}` : ''}`);
    // Idempotent: clear any existing interval before starting a new one so that
    // double-call (e.g., early start in orchestrator + typing harness) doesn't leak.
    if (this.typingInterval) {
      clearInterval(this.typingInterval);
      this.typingInterval = null;
    }
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
    // For General topic (no threadId) or DMs, don't pass message_thread_id at all
    // This treats General topic like a DM - just send to the chat, no thread params
    if (this.threadId) {
      console.log(`[Telegram] sendTypingAction() to chat ${this.chatId} thread ${this.threadId}`);
      this.bot.api
        .sendChatAction(this.chatId, "typing", { message_thread_id: this.threadId })
        .then(() => console.log(`[Telegram] ✅ Typing indicator sent to thread ${this.threadId}`))
        .catch((err) => console.log(`[Telegram] ❌ Typing failed for thread ${this.threadId}: ${err.message || err}`));
    } else {
      // No thread ID = General topic or DM - just send to the chat directly
      console.log(`[Telegram] sendTypingAction() to chat ${this.chatId} (no thread - General/DM mode)`);
      this.bot.api
        .sendChatAction(this.chatId, "typing")
        .then(() => console.log(`[Telegram] ✅ Typing indicator sent (General/DM mode)`))
        .catch((err) => console.log(`[Telegram] ❌ Typing failed (General/DM mode): ${err.message || err}`));
    }
  }

  private async flushBuffer(): Promise<void> {
    console.log(`[Telegram] flushBuffer() called, buffer has ${this.buffer.length} chars`);
    if (!this.buffer) return;

    const text = this.buffer;
    this.buffer = "";

    // Split message at MEDIA: markers and send in order: text, attachment, text, attachment, etc.
    // Accept both absolute (/Users/...) and relative (user/...) paths
    const mediaRegex = /MEDIA:([^\s\n`*"<>|]+)/g;
    const parts: Array<{ type: "text"; content: string } | { type: "media"; path: string }> = [];
    
    let lastIndex = 0;
    let match;
    while ((match = mediaRegex.exec(text)) !== null) {
      // Add text before this match
      const before = text.slice(lastIndex, match.index).trim();
      if (before) {
        parts.push({ type: "text", content: before });
      }
      // Resolve relative paths to absolute using project root
      let mediaPath = match[1];
      if (!path.isAbsolute(mediaPath)) {
        mediaPath = path.resolve(process.cwd(), mediaPath);
      }
      // Add the media
      parts.push({ type: "media", path: mediaPath });
      lastIndex = match.index + match[0].length;
    }
    // Add remaining text after last match
    const after = text.slice(lastIndex).trim();
    if (after) {
      parts.push({ type: "text", content: after });
    }

    // Message options for thread support
    const msgOptions = this.threadId ? { message_thread_id: this.threadId } : undefined;

    // If no media found, just send as text
    if (parts.length === 0) {
      const chunks = splitMessage(text, TELEGRAM_MAX_LENGTH);
      console.log(`[Telegram] Sending ${chunks.length} chunk(s) to chat ${this.chatId}${this.threadId ? ` thread ${this.threadId}` : ''}`);
      for (const chunk of chunks) {
        await this.bot.api.sendMessage(this.chatId, chunk, msgOptions);
        console.log(`[Telegram] ✅ Sent chunk of ${chunk.length} chars`);
      }
      return;
    }

    // Send parts in order
    for (const part of parts) {
      if (part.type === "text") {
        const chunks = splitMessage(part.content, TELEGRAM_MAX_LENGTH);
        for (const chunk of chunks) {
          await this.bot.api.sendMessage(this.chatId, chunk, msgOptions);
          console.log(`[Telegram] ✅ Sent text chunk of ${chunk.length} chars`);
        }
      } else {
        const filePath = part.path;
        console.log(`[Telegram] Sending media file: ${filePath}`);
        
        try {
          const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(filePath);
          const { InputFile } = await import("grammy");
          const inputFile = new InputFile(filePath);
          
          if (isImage) {
            await this.bot.api.sendPhoto(this.chatId, inputFile, msgOptions);
            console.log(`[Telegram] ✅ Sent image: ${filePath}`);
          } else {
            await this.bot.api.sendDocument(this.chatId, inputFile, msgOptions);
            console.log(`[Telegram] ✅ Sent document: ${filePath}`);
          }
        } catch (error) {
          console.error(`[Telegram] ❌ Failed to send media: ${error}`);
          await this.bot.api.sendMessage(this.chatId, `Error sending media: ${filePath}`, msgOptions);
        }
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
