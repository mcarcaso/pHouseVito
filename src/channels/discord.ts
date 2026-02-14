import { Client, GatewayIntentBits, Partials, Message as DiscordMessage, TextChannel, DMChannel } from "discord.js";
import type {
  Channel,
  InboundEvent,
  OutputHandler,
  OutboundMessage,
} from "../types.js";

const DISCORD_MAX_LENGTH = 2000;

export class DiscordChannel implements Channel {
  name = "discord";
  capabilities = {
    typing: true,
    reactions: true,
    attachments: true,
    streaming: false,
  };

  private client: Client | null = null;
  private config: any;

  constructor(config: any) {
    this.config = config;
  }

  async start(): Promise<void> {
    const token = process.env.DISCORD_BOT_TOKEN;
    if (!token) {
      throw new Error(
        "DISCORD_BOT_TOKEN not set. Create a bot at https://discord.com/developers/applications"
      );
    }

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
      partials: [Partials.Channel], // needed for DMs
    });

    await this.client.login(token);
    console.log(`Discord bot started as ${this.client.user?.tag}`);
  }

  async stop(): Promise<void> {
    this.client?.destroy();
    this.client = null;
  }

  async listen(
    onEvent: (event: InboundEvent) => void
  ): Promise<() => void> {
    if (!this.client) throw new Error("Client not initialized — call start() first");

    const allowedGuildIds: string[] =
      this.config.channels?.discord?.allowedGuildIds || [];
    const allowedChannelIds: string[] =
      this.config.channels?.discord?.allowedChannelIds || [];

    const isAllowed = (msg: DiscordMessage): boolean => {
      // Always allow DMs
      if (!msg.guild) return true;
      // Check guild whitelist
      if (allowedGuildIds.length > 0 && !allowedGuildIds.includes(msg.guild.id)) return false;
      // Check channel whitelist
      if (allowedChannelIds.length > 0 && !allowedChannelIds.includes(msg.channel.id)) return false;
      return true;
    };

    this.client.on("messageCreate", async (msg) => {
      // Ignore bot's own messages
      if (msg.author.bot) return;
      // In guilds, check if mention is required
      const requireMention = this.config.channels?.discord?.requireMention !== false;
      if (msg.guild && requireMention && !msg.mentions.has(this.client!.user!.id)) return;

      console.log(`[Discord] 📨 Received message from ${msg.author.tag} in ${msg.guild?.name || 'DM'}`);

      if (!isAllowed(msg)) {
        console.log(`[Discord] ❌ Message not allowed — guild/channel not whitelisted`);
        return;
      }

      // Strip the bot mention from the message content
      const content = msg.content
        .replace(new RegExp(`<@!?${this.client!.user!.id}>`, "g"), "")
        .trim();

      // Build session key: use channel ID for threads/channels, user ID for DMs
      const target = msg.guild ? msg.channel.id : msg.author.id;

      const event: InboundEvent = {
        sessionKey: `discord:${target}`,
        channel: "discord",
        target: target,
        author: msg.author.tag,
        timestamp: Date.now(),
        content,
        raw: msg,
      };

      // Handle attachments
      if (msg.attachments.size > 0) {
        event.attachments = msg.attachments.map((attachment) => ({
          type: attachment.contentType?.startsWith("image/") ? "image" as const : "file" as const,
          url: attachment.url,
          mimeType: attachment.contentType || "application/octet-stream",
          filename: attachment.name || "attachment",
        }));
      }

      console.log(`[Discord] ✅ Firing onEvent for ${target}`);
      onEvent(event);
    });

    return () => {
      // Cleanup handled by stop()
    };
  }

  createHandler(event: InboundEvent): OutputHandler {
    return new DiscordOutputHandler(this.client!, event);
  }

  getSessionKey(event: InboundEvent): string {
    return event.sessionKey;
  }

  getCustomPrompt(): string {
    return [
      "## Channel: Discord",
      "You are responding in a Discord chat. Keep responses concise and conversational.",
      "Discord supports markdown: **bold**, *italic*, `code`, ```code blocks```, > quotes.",
      "Messages are limited to 2000 characters — be concise.",
      "Users mention you with @. You can reference users with <@userId>.",
    ].join("\n");
  }
}

class DiscordOutputHandler implements OutputHandler {
  private buffer = "";
  private typingInterval: ReturnType<typeof setInterval> | null = null;
  private typingTimeout: ReturnType<typeof setTimeout> | null = null;
  private typingStopped = false;
  private channel: TextChannel | DMChannel | null = null;

  constructor(
    private client: Client,
    private event: InboundEvent
  ) {
    // Get the channel from the raw message
    const rawMsg = event.raw as DiscordMessage;
    this.channel = rawMsg.channel as TextChannel | DMChannel;
  }

  async relay(msg: OutboundMessage): Promise<void> {
    this.buffer += msg;
  }

  async startTyping(): Promise<void> {
    if (!this.channel || this.typingStopped) return;
    // Clear any existing typing state
    if (this.typingInterval) {
      clearInterval(this.typingInterval);
      this.typingInterval = null;
    }
    if (this.typingTimeout) {
      clearTimeout(this.typingTimeout);
      this.typingTimeout = null;
    }
    // Delay the first sendTyping by 500ms — if stopTyping comes quickly
    // (e.g., last message_end followed by session end), we avoid the stale indicator
    this.typingTimeout = setTimeout(() => {
      if (this.typingStopped) return;
      this.sendTyping();
      this.typingInterval = setInterval(() => {
        if (this.typingStopped) return;
        this.sendTyping();
      }, 8000);
    }, 500);
  }

  async stopTyping(): Promise<void> {
    this.typingStopped = true;
    if (this.typingInterval) {
      clearInterval(this.typingInterval);
      this.typingInterval = null;
    }
    if (this.typingTimeout) {
      clearTimeout(this.typingTimeout);
      this.typingTimeout = null;
    }
    await this.flushBuffer();
  }

  async endMessage(): Promise<void> {
    await this.flushBuffer();
  }

  private sendTyping(): void {
    if (!this.channel) return;
    (this.channel as TextChannel).sendTyping?.().catch(() => {});
  }

  private async flushBuffer(): Promise<void> {
    if (!this.buffer || !this.channel) return;

    const text = this.buffer;
    this.buffer = "";

    // Parse MEDIA: protocol for local file attachments
    const mediaRegex = /MEDIA:(\/[^\s\n`*"<>|]+)/g;
    const mediaMatches = [...text.matchAll(mediaRegex)];

    if (mediaMatches.length > 0) {
      // Collect file paths for Discord attachments
      const files: string[] = [];
      for (const match of mediaMatches) {
        files.push(match[1]);
      }

      // Send remaining text (with MEDIA: tags stripped)
      const remainingText = text.replace(mediaRegex, "").trim();

      try {
        await this.channel.send({
          content: remainingText || undefined,
          files: files.map((f) => ({ attachment: f })),
        });
      } catch (error) {
        console.error(`[Discord] ❌ Failed to send media:`, error);
        // Fallback: send as text
        const chunks = splitMessage(`${remainingText}\n\n(Failed to attach files: ${files.join(", ")})`, DISCORD_MAX_LENGTH);
        for (const chunk of chunks) {
          await this.channel.send(chunk);
        }
      }
    } else {
      // No media, send as text
      const chunks = splitMessage(text, DISCORD_MAX_LENGTH);
      for (const chunk of chunks) {
        await this.channel.send(chunk);
      }
    }
  }
}

/**
 * Split text into chunks that fit within Discord's message limit.
 * Tries to split at code block boundaries, then paragraphs,
 * then lines, then words, and finally does a hard split.
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

    // Try code block boundary
    const codeBlockIdx = remaining.lastIndexOf("\n```", maxLength);
    if (codeBlockIdx > 0) {
      // Include the closing ``` in this chunk
      const endOfBlock = remaining.indexOf("\n", codeBlockIdx + 4);
      if (endOfBlock > 0 && endOfBlock <= maxLength) {
        splitAt = endOfBlock;
      }
    }

    // Try paragraph boundary
    if (splitAt === -1) {
      const paraIdx = remaining.lastIndexOf("\n\n", maxLength);
      if (paraIdx > 0) splitAt = paraIdx;
    }

    // Try line boundary
    if (splitAt === -1) {
      const lineIdx = remaining.lastIndexOf("\n", maxLength);
      if (lineIdx > 0) splitAt = lineIdx;
    }

    // Try word boundary
    if (splitAt === -1) {
      const spaceIdx = remaining.lastIndexOf(" ", maxLength);
      if (spaceIdx > 0) splitAt = spaceIdx;
    }

    // Hard split
    if (splitAt === -1) splitAt = maxLength;

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n+/, "");
  }

  return chunks;
}
