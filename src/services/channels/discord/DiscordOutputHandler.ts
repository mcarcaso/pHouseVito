import { Client, Message as DiscordMessage, ChatInputCommandInteraction } from "discord.js";
import * as fs from "node:fs";
import * as path from "node:path";
import type { OutputHandler, OutboundMessage } from "../../../output/OutputHandler.js";
import type { InboundEvent } from "../../../contracts/inbound-event.js";

const DISCORD_MAX_LENGTH = 2000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface DiscordOutputChannel {
  id: string;
  send(content: string): Promise<unknown>;
  sendTyping?: () => Promise<unknown>;
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDiscordOutputChannel(value: unknown): value is DiscordOutputChannel {
  return isUnknownRecord(value)
    && typeof value.id === "string"
    && typeof value.send === "function";
}

function isChatInputInteraction(value: unknown): value is ChatInputCommandInteraction {
  return isUnknownRecord(value)
    && typeof value.commandName === "string"
    && typeof value.editReply === "function";
}

export class DiscordOutputHandler implements OutputHandler {
  private buffer = "";
  private typingInterval: ReturnType<typeof setInterval> | null = null;
  private typingTimeout: ReturnType<typeof setTimeout> | null = null;
  private typingStopped = false;
  private channel: DiscordOutputChannel | null = null;
  private channelReady: Promise<void>;
  private interaction: ChatInputCommandInteraction | null = null;
  private interactionReplied = false;

  constructor(
    private client: Client,
    private event: InboundEvent,
    private token?: string
  ) {
    // Check if this is a slash command interaction
    const raw = event.raw;
    if (isChatInputInteraction(raw)) {
      this.interaction = raw;
      // For interactions, we still need the channel for typing indicators
      this.channelReady = this.client.channels.fetch(event.target).then((channel) => {
        if (isDiscordOutputChannel(channel)) this.channel = channel;
      }).catch(() => {});
      return;
    }

    // Get the channel from the raw message, OR fetch by target ID (for cron jobs)
    const rawMessage = raw instanceof DiscordMessage ? raw : undefined;
    if (rawMessage && isDiscordOutputChannel(rawMessage.channel)) {
      this.channel = rawMessage.channel;
      this.channelReady = Promise.resolve();
    } else if (event.target) {
      // Cron job or other non-message trigger — fetch channel by ID
      this.channelReady = this.client.channels.fetch(event.target).then((channel) => {
        if (!isDiscordOutputChannel(channel)) return;
        this.channel = channel;
        console.log(`[Discord] Fetched channel ${event.target} for cron job`);
      }).catch((err) => {
        console.error(`[Discord] Failed to fetch channel ${event.target}: ${err.message}`);
      });
    } else {
      this.channelReady = Promise.resolve();
    }
  }

  async relay(msg: OutboundMessage): Promise<void> {
    this.buffer += msg;
  }

  async startTyping(): Promise<void> {
    await this.channelReady;
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
    this.channel.sendTyping?.().catch(() => {});
  }

  /** Send a message — uses interaction.editReply for the first slash command response, then falls back to channel.send */
  private async sendMessage(content: string): Promise<void> {
    if (this.interaction && !this.interactionReplied) {
      this.interactionReplied = true;
      await this.interaction.editReply(content);
    } else if (this.channel) {
      await this.channel.send(content);
    }
  }

  private async flushBuffer(): Promise<void> {
    await this.channelReady;
    if (!this.buffer) return;
    // Need either channel or interaction to send
    if (!this.channel && !this.interaction) return;

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

    // If no media found, just send as text
    if (parts.length === 0) {
      for (const chunk of splitMessage(text, DISCORD_MAX_LENGTH)) {
        try {
          await this.sendMessage(chunk);
        } catch (error: unknown) {
          console.error(`[Discord] ❌ flushBuffer text send failed: ${errorMessage(error)}`);
          throw error;
        }
      }
      return;
    }

    // Send parts in order
    for (const part of parts) {
      if (part.type === "text") {
        for (const chunk of splitMessage(part.content, DISCORD_MAX_LENGTH)) {
          await this.sendMessage(chunk);
        }
      } else {
        const filePath = part.path;
        if (!fs.existsSync(filePath)) {
          console.error(`[Discord] File not found: ${filePath}`);
          continue;
        }

        try {
          const form = new FormData();
          const fileData = fs.readFileSync(filePath);
          const ext = path.extname(filePath).toLowerCase();
          const mimeMap: Record<string, string> = {
            ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
            ".gif": "image/gif", ".webp": "image/webp", ".mp4": "video/mp4",
            ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg"
          };
          const mime = mimeMap[ext] || "application/octet-stream";
          form.append("files[0]", new Blob([fileData], { type: mime }), path.basename(filePath));

          if (!this.token) throw new Error("DISCORD_BOT_TOKEN not available");
          const channelId = this.channel?.id || this.interaction?.channelId;
          const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
            method: "POST",
            headers: { Authorization: `Bot ${this.token}` },
            body: form,
          });

          if (!res.ok) {
            const body = await res.text();
            throw new Error(`Discord API ${res.status}: ${body}`);
          }
          console.log(`[Discord] ✅ Sent attachment: ${filePath}`);
        } catch (error: unknown) {
          console.error(`[Discord] ❌ Failed to send attachment: ${errorMessage(error)}`);
        }
      }
    }
  }
}

/**
 * Split text into chunks that fit within Discord's message limit.
 * Keeps fenced code blocks valid across chunk boundaries by closing and
 * reopening the fence when a split must happen inside one.
 */
function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;
  let openFence: string | null = null;

  while (remaining.length > 0) {
    const prefix = openFence ? `${openFence}\n` : "";

    if (prefix.length + remaining.length <= maxLength) {
      chunks.push(prefix + remaining);
      break;
    }

    const closeFence = openFence ? "\n```" : "";
    const available = maxLength - prefix.length - closeFence.length;
    if (available <= 0) {
      // Should never happen with normal Discord limits, but avoid an infinite loop.
      chunks.push((prefix + closeFence).slice(0, maxLength));
      openFence = null;
      continue;
    }

    const splitAt = findSplitPoint(remaining, available);
    const body = remaining.slice(0, splitAt);
    chunks.push(prefix + body + closeFence);

    openFence = getOpenFenceAfter(prefix + body);
    remaining = remaining.slice(splitAt).replace(/^\n+/, "");
  }

  return chunks;
}

function findSplitPoint(text: string, maxBodyLength: number): number {
  if (text.length <= maxBodyLength) return text.length;

  // Prefer splitting immediately after a complete fenced code block.
  const fenceBoundary = findLastClosedFenceBoundary(text, maxBodyLength);
  if (fenceBoundary > 0) return fenceBoundary;

  const paraIdx = text.lastIndexOf("\n\n", maxBodyLength);
  if (paraIdx > 0) return paraIdx;

  const lineIdx = text.lastIndexOf("\n", maxBodyLength);
  if (lineIdx > 0) return lineIdx;

  const spaceIdx = text.lastIndexOf(" ", maxBodyLength);
  if (spaceIdx > 0) return spaceIdx;

  return maxBodyLength;
}

function findLastClosedFenceBoundary(text: string, limit: number): number {
  let inFence = false;
  let lastClosedBoundary = -1;
  const fenceRegex = /(^|\n)(```[^\n]*)/g;
  let match: RegExpExecArray | null;

  while ((match = fenceRegex.exec(text)) !== null) {
    const fenceStart = match.index + match[1].length;
    if (fenceStart >= limit) break;

    const lineEnd = text.indexOf("\n", fenceStart);
    const boundary = lineEnd === -1 ? text.length : lineEnd + 1;
    inFence = !inFence;

    if (!inFence && boundary <= limit) {
      lastClosedBoundary = boundary;
    }
  }

  return lastClosedBoundary;
}

function getOpenFenceAfter(text: string): string | null {
  let openFence: string | null = null;
  const fenceRegex = /(^|\n)(```[^\n]*)/g;
  let match: RegExpExecArray | null;

  while ((match = fenceRegex.exec(text)) !== null) {
    const fenceLine = match[2];
    openFence = openFence ? null : fenceLine;
  }

  return openFence;
}
