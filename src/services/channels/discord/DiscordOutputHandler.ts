import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import {
  AttachmentBuilder,
  ChatInputCommandInteraction,
  Client,
  Message as DiscordMessage,
  MessageFlags,
} from "discord.js";
import type { Context } from "../../../context/Context.js";
import { ProgressPresenter } from "../../../lib/output/ProgressPresenter.js";
import { xDiscordQueueStore, xDriveDir, xVitoService } from "../../../lib/x.js";
import type {
  AgentActivityEvent,
  OutputHandler,
  OutboundMessage,
} from "../../../lib/output/OutputHandler.js";
import { parseInboundEventMetadata, type InboundEvent } from "../../../lib/types/inbound-event.js";

const DISCORD_MAX_LENGTH = 2_000;
const DISCORD_UPLOAD_DEADLINE_MS = 20_000;

async function withDeadline<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Discord attachment upload timed out")),
          milliseconds,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function dashboardUrl(x: Context): string {
  const configured = process.env.VITO_DASHBOARD_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const domain = xVitoService(x).getConfig(x).apps?.baseDomain?.trim();
  return domain ? `https://${domain}` : "http://localhost:3030";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface SentDiscordMessage {
  edit?(content: string): Promise<unknown>;
  delete?(): Promise<unknown>;
}

interface DiscordOutputChannel {
  id: string;
  send(
    content:
      | string
      | {
          content?: string;
          files?: AttachmentBuilder[];
          nonce?: string;
          enforceNonce?: boolean;
          flags?: number;
        },
  ): Promise<unknown>;
  sendTyping?: () => Promise<unknown>;
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDiscordOutputChannel(value: unknown): value is DiscordOutputChannel {
  return isUnknownRecord(value) && typeof value.id === "string" && typeof value.send === "function";
}

function isChatInputInteraction(value: unknown): value is ChatInputCommandInteraction {
  return (
    isUnknownRecord(value) &&
    typeof value.commandName === "string" &&
    typeof value.editReply === "function"
  );
}

function rawDiscordValue(event: InboundEvent): unknown {
  const metadata = isUnknownRecord(event.raw) ? event.raw : undefined;
  return metadata?.discordRaw ?? event.raw;
}

function deliveryBase(event: InboundEvent): string {
  const metadata = parseInboundEventMetadata(event.raw);
  const raw = rawDiscordValue(event);
  if (typeof metadata.deliveryKey === "string" && metadata.deliveryKey) {
    return `discord:${metadata.deliveryKey}`;
  }
  if (typeof metadata.discordMessageId === "string" && metadata.discordMessageId) {
    return `discord:reply:${metadata.discordMessageId}`;
  }
  if (raw instanceof DiscordMessage || isChatInputInteraction(raw)) {
    return `discord:reply:${raw.id}`;
  }
  return `discord:reply:${createHash("sha256")
    .update(`${event.sessionKey}\0${event.timestamp}\0${event.author}`)
    .digest("hex")}`;
}

function nonce(key: string, piece: number): string {
  return createHash("sha256").update(`${key}:${piece}`).digest("hex").slice(0, 24);
}

type DeliveryPiece = { type: "text"; content: string } | { type: "media"; path: string };

function parsePieces(text: string): DeliveryPiece[] {
  const pieces: DeliveryPiece[] = [];
  const marker = /^MEDIA:(.+)$/gm;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(text)) !== null) {
    const before = text.slice(lastIndex, match.index).trim();
    if (before) {
      for (const chunk of splitMessage(before, DISCORD_MAX_LENGTH)) {
        pieces.push({ type: "text", content: chunk });
      }
    }
    const supplied = (match[1] ?? "").trim();
    if (supplied) {
      pieces.push({
        type: "media",
        path: isAbsolute(supplied) ? supplied : resolve(process.cwd(), supplied),
      });
    }
    lastIndex = match.index + match[0].length;
  }
  const after = text.slice(lastIndex).trim();
  if (after) {
    for (const chunk of splitMessage(after, DISCORD_MAX_LENGTH)) {
      pieces.push({ type: "text", content: chunk });
    }
  }
  if (pieces.length === 0 && text) {
    for (const chunk of splitMessage(text, DISCORD_MAX_LENGTH)) {
      pieces.push({ type: "text", content: chunk });
    }
  }
  return pieces;
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
  private flushSequence = 0;
  private progressSequence = 0;
  private readonly progress: ProgressPresenter;

  constructor(
    private x: Context,
    private client: Client,
    private event: InboundEvent,
    _token?: string,
  ) {
    this.progress = new ProgressPresenter(
      {
        sendProgress: async (text) => {
          await this.channelReady;
          if (!this.channel) throw new Error("Discord output channel unavailable");
          return await this.channel.send({
            content: text,
            nonce: nonce(`${deliveryBase(this.event)}:progress`, this.progressSequence++),
            enforceNonce: true,
            flags: MessageFlags.SuppressNotifications,
          });
        },
        editProgress: async (handle, text) => {
          await (handle as SentDiscordMessage).edit?.(text);
        },
        deleteProgress: async (handle) => {
          await (handle as SentDiscordMessage).delete?.();
        },
      },
      () => `${dashboardUrl(x)}/chat/${encodeURIComponent(event.sessionKey)}`,
      (url) => `[Open conversation](<${url}>)`,
    );
    const raw = rawDiscordValue(event);
    const metadata = parseInboundEventMetadata(event.raw);
    const outputTarget = metadata.discordChannelId ?? event.target;
    if (isChatInputInteraction(raw)) {
      this.interaction = raw;
      this.channelReady = this.client.channels
        .fetch(outputTarget)
        .then((channel) => {
          if (isDiscordOutputChannel(channel)) this.channel = channel;
        })
        .catch(() => {});
      return;
    }

    const rawMessage = raw instanceof DiscordMessage ? raw : undefined;
    if (rawMessage && isDiscordOutputChannel(rawMessage.channel)) {
      this.channel = rawMessage.channel;
      this.channelReady = Promise.resolve();
    } else if (outputTarget) {
      this.channelReady = this.client.channels
        .fetch(outputTarget)
        .catch(async () => await (await this.client.users.fetch(outputTarget)).createDM())
        .then((channel) => {
          if (isDiscordOutputChannel(channel)) this.channel = channel;
        })
        .catch((error) => {
          console.error(
            `[Discord] Failed to fetch channel ${outputTarget}: ${errorMessage(error)}`,
          );
        });
    } else {
      this.channelReady = Promise.resolve();
    }
  }

  async relay(msg: OutboundMessage): Promise<void> {
    this.buffer += msg;
  }

  async relayEvent(event: AgentActivityEvent): Promise<void> {
    await this.progress.onEvent(event);
  }

  async startTyping(): Promise<void> {
    await this.channelReady;
    if (!this.channel || this.typingStopped) return;
    if (this.typingInterval) clearInterval(this.typingInterval);
    if (this.typingTimeout) clearTimeout(this.typingTimeout);
    this.typingTimeout = setTimeout(() => {
      if (this.typingStopped) return;
      this.sendTyping();
      this.typingInterval = setInterval(() => {
        if (!this.typingStopped) this.sendTyping();
      }, 8_000);
    }, 500);
  }

  async stopTyping(): Promise<void> {
    this.typingStopped = true;
    if (this.typingInterval) clearInterval(this.typingInterval);
    if (this.typingTimeout) clearTimeout(this.typingTimeout);
    this.typingInterval = null;
    this.typingTimeout = null;
    await this.flushBuffer();
    await this.progress.close();
  }

  async endMessage(): Promise<void> {
    await this.flushBuffer();
    await this.progress.clear();
  }

  private sendTyping(): void {
    this.channel?.sendTyping?.().catch(() => {});
  }

  private async sendText(content: string, messageNonce: string, quiet = false): Promise<void> {
    if (this.interaction && !this.interactionReplied) {
      this.interactionReplied = true;
      await this.interaction.editReply(content);
      return;
    }
    if (!this.channel) throw new Error("Discord output channel is unavailable");
    await this.channel.send({
      content,
      nonce: messageNonce,
      enforceNonce: true,
      ...(quiet ? { flags: MessageFlags.SuppressNotifications } : {}),
    });
  }

  private driveFallback(filePath: string): string | undefined {
    const driveDir = xDriveDir(this.x);
    if (typeof driveDir !== "string" || !existsSync(driveDir) || !existsSync(filePath)) return;
    const path = relative(realpathSync(driveDir), realpathSync(filePath));
    if (!path || path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) return;
    const encoded = path.split(sep).map(encodeURIComponent).join("/");
    return `Attachment upload unavailable. Open the file in Vito (sign in if prompted): ${dashboardUrl(this.x)}/api/drive/file/${encoded}`;
  }

  private async sendFile(filePath: string, messageNonce: string, quiet = false): Promise<void> {
    if (!existsSync(filePath)) throw new Error(`Discord attachment does not exist: ${filePath}`);
    const stats = statSync(filePath);
    if (!stats.isFile()) throw new Error(`Discord attachment is not a regular file: ${filePath}`);
    if (stats.size > 20 * 1024 * 1024) {
      throw new Error(`Discord attachment exceeds the 20 MiB delivery limit: ${filePath}`);
    }
    const attachment = new AttachmentBuilder(readFileSync(filePath), { name: basename(filePath) });
    if (this.interaction && !this.interactionReplied) {
      this.interactionReplied = true;
      await withDeadline(
        this.interaction.editReply({ files: [attachment] }),
        DISCORD_UPLOAD_DEADLINE_MS,
      );
      return;
    }
    if (!this.channel) throw new Error("Discord output channel is unavailable");
    await withDeadline(
      this.channel.send({
        files: [attachment],
        nonce: messageNonce,
        enforceNonce: true,
        ...(quiet ? { flags: MessageFlags.SuppressNotifications } : {}),
      }),
      DISCORD_UPLOAD_DEADLINE_MS,
    );
  }

  private async flushBuffer(): Promise<void> {
    await this.channelReady;
    if (!this.buffer) return;
    if (!this.channel && !this.interaction) throw new Error("Discord output target is unavailable");

    const text = this.buffer;
    this.buffer = "";
    const pieces = parsePieces(text);
    // RelayPiRuntime prefixes commentary with 💬; keep every split chunk quiet.
    const quiet = text.startsWith("💬");
    const key = `${deliveryBase(this.event)}:${this.flushSequence++}`;
    const fingerprint = createHash("sha256").update(JSON.stringify(pieces)).digest("hex");
    const store = xDiscordQueueStore(this.x);
    const delivery = store.createDelivery(this.x, key, fingerprint);
    if (delivery.status === "completed") return;
    if (delivery.status === "unknown") {
      throw new Error("Discord delivery has an uncertain prior side effect; refusing to replay it");
    }

    for (let index = delivery.nextPiece; index < pieces.length; index++) {
      const piece = pieces[index];
      store.advanceDelivery(this.x, key, index);
      try {
        if (piece.type === "text") {
          await this.sendText(piece.content, nonce(key, index), quiet);
        } else {
          try {
            await this.sendFile(piece.path, nonce(key, index), quiet);
          } catch (uploadError) {
            const fallback = this.driveFallback(piece.path);
            if (!fallback) throw uploadError;
            console.warn(
              `[Discord] Upload failed; sending Drive link: ${errorMessage(uploadError)}`,
            );
            // Distinct nonce: an upload timed out locally but may still complete.
            await withDeadline(
              this.sendText(fallback, nonce(`${key}:fallback`, index), quiet),
              10_000,
            );
          }
        }
      } catch (error) {
        // Enforced deterministic nonces make a retry safe even if the network
        // failed after Discord accepted the piece.
        store.failDelivery(this.x, key, true);
        console.error(`[Discord] Delivery ${key} failed at piece ${index}: ${errorMessage(error)}`);
        throw error;
      }
      store.advanceDelivery(this.x, key, index + 1);
    }
    store.finishDelivery(this.x, key);
  }
}

/** Split safely at natural boundaries while keeping fenced code blocks valid. */
export function splitMessage(text: string, maxLength = DISCORD_MAX_LENGTH): string[] {
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
    // Reserve room to close a fence that may begin inside this chunk.
    const available = maxLength - prefix.length - 4;
    if (available <= 0) {
      chunks.push(prefix.slice(0, maxLength));
      openFence = null;
      continue;
    }
    const splitAt = findSplitPoint(remaining, available);
    const body = remaining.slice(0, splitAt);
    const nextOpenFence = getOpenFenceAfter(prefix + body);
    chunks.push(prefix + body + (nextOpenFence ? "\n```" : ""));
    openFence = nextOpenFence;
    remaining = remaining.slice(splitAt).replace(/^\n+/, "");
  }
  return chunks;
}

function findSplitPoint(text: string, maxBodyLength: number): number {
  if (text.length <= maxBodyLength) return text.length;
  const fenceBoundary = findLastClosedFenceBoundary(text, maxBodyLength);
  if (fenceBoundary > 0) return fenceBoundary;
  const para = text.lastIndexOf("\n\n", maxBodyLength);
  if (para > 0) return para;
  const line = text.lastIndexOf("\n", maxBodyLength);
  if (line > 0) return line;
  const space = text.lastIndexOf(" ", maxBodyLength);
  return space > 0 ? space : maxBodyLength;
}

function findLastClosedFenceBoundary(text: string, limit: number): number {
  let inFence = false;
  let lastClosed = -1;
  const fence = /(^|\n)(```[^\n]*)/g;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(text)) !== null) {
    const start = match.index + match[1].length;
    if (start >= limit) break;
    const lineEnd = text.indexOf("\n", start);
    const boundary = lineEnd === -1 ? text.length : lineEnd + 1;
    inFence = !inFence;
    if (!inFence && boundary <= limit) lastClosed = boundary;
  }
  return lastClosed;
}

function getOpenFenceAfter(text: string): string | null {
  let open: string | null = null;
  const fence = /(^|\n)(```[^\n]*)/g;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(text)) !== null) open = open ? null : match[2];
  return open;
}
