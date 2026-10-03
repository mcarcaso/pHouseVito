import { existsSync, realpathSync, statSync } from "node:fs";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import type { WebClient } from "@slack/web-api";
import type { Context } from "../../../context/Context.js";
import { xDriveDir, xVitoService } from "../../../lib/x.js";
import type { InboundEvent } from "../../../lib/types/inbound-event.js";
import type { AgentActivityEvent, OutputHandler } from "../../../lib/output/OutputHandler.js";
import { ProgressPresenter } from "../../../lib/output/ProgressPresenter.js";
import { splitMessage } from "../../../lib/output/split-message.js";
import { parseSlackTarget, slackMrkdwn } from "./slack-messages.js";

export type SlackWebClient = Pick<
  WebClient,
  "auth" | "chat" | "conversations" | "users" | "filesUploadV2" | "reactions"
>;

export class SlackOutputHandler implements OutputHandler {
  private buffer = "";
  private readonly progress: ProgressPresenter;
  private readonly destination: { channel: string; thread_ts?: string };
  private reactionAdded = false;
  private readonly messageTs?: string;

  constructor(
    private readonly x: Context,
    private readonly client: SlackWebClient,
    event: InboundEvent,
  ) {
    const target = parseSlackTarget(event.target);
    this.destination = {
      channel: target.channel,
      ...(target.thread ? { thread_ts: target.thread } : {}),
    };
    this.messageTs = event.replyTo;
    this.progress = new ProgressPresenter(
      {
        sendProgress: async (text) => {
          const result = await this.client.chat.postMessage({
            ...this.destination,
            text: slackMrkdwn(text),
            unfurl_links: false,
            unfurl_media: false,
          });
          if (!result.ts) throw new Error("Slack progress message missing timestamp");
          return result.ts;
        },
        editProgress: async (handle, text) => {
          await this.client.chat.update({
            channel: this.destination.channel,
            ts: String(handle),
            text: slackMrkdwn(text),
          });
        },
        deleteProgress: async (handle) => {
          await this.client.chat.delete({ channel: this.destination.channel, ts: String(handle) });
        },
      },
      () => {
        const base =
          process.env.VITO_DASHBOARD_URL?.trim()?.replace(/\/$/, "") ||
          `https://${xVitoService(x).getConfig(x).apps?.baseDomain || "localhost:3030"}`;
        return `${base}/chat/${encodeURIComponent(event.sessionKey)}`;
      },
      (url) => `[Open conversation](${url})`,
    );
  }

  async relay(message: string): Promise<void> {
    this.buffer += message;
  }
  async relayEvent(event: AgentActivityEvent): Promise<void> {
    await this.progress.onEvent(event);
  }
  async startTyping(): Promise<void> {
    await this.startReaction();
  }
  async stopTyping(): Promise<void> {
    try {
      await this.flush();
    } finally {
      await this.progress.close();
      await this.stopReaction();
    }
  }
  async endMessage(): Promise<void> {
    try {
      await this.flush();
    } finally {
      await this.progress.clear();
    }
  }
  async startReaction(): Promise<void> {
    if (!this.messageTs || this.reactionAdded) return;
    try {
      await this.client.reactions.add({
        channel: this.destination.channel,
        timestamp: this.messageTs,
        name: "hourglass_flowing_sand",
      });
      this.reactionAdded = true;
    } catch {
      /* Reactions are optional. */
    }
  }
  async stopReaction(): Promise<void> {
    if (!this.messageTs || !this.reactionAdded) return;
    this.reactionAdded = false;
    await this.client.reactions
      .remove({
        channel: this.destination.channel,
        timestamp: this.messageTs,
        name: "hourglass_flowing_sand",
      })
      .catch(() => {});
  }

  private async sendText(text: string): Promise<void> {
    for (const chunk of splitMessage(slackMrkdwn(text), 4_000)) {
      await this.client.chat.postMessage({
        ...this.destination,
        text: chunk,
        unfurl_links: false,
        unfurl_media: false,
      });
    }
  }

  private async sendFile(supplied: string): Promise<void> {
    const path = isAbsolute(supplied) ? supplied : resolve(process.cwd(), supplied);
    if (!existsSync(path) || !statSync(path).isFile())
      throw new Error("Slack attachment is not a file");
    if (statSync(path).size > 20 * 1024 * 1024)
      throw new Error("Slack attachment exceeds the 20 MiB limit");
    try {
      const upload = {
        file: path,
        filename: basename(path),
        channel_id: this.destination.channel,
      };
      if (this.destination.thread_ts) {
        await this.client.filesUploadV2({ ...upload, thread_ts: this.destination.thread_ts });
      } else {
        await this.client.filesUploadV2(upload);
      }
    } catch (cause) {
      const drive = xDriveDir(this.x);
      if (!drive || !existsSync(drive)) throw cause;
      const subpath = relative(realpathSync(drive), realpathSync(path));
      if (!subpath || subpath === ".." || subpath.startsWith(`..${sep}`) || isAbsolute(subpath))
        throw cause;
      const base =
        process.env.VITO_DASHBOARD_URL?.trim()?.replace(/\/$/, "") ||
        `https://${xVitoService(this.x).getConfig(this.x).apps?.baseDomain || "localhost:3030"}`;
      await this.sendText(
        `Attachment upload unavailable. Open in Vito (sign in if prompted): ${base}/api/drive/file/${subpath.split(sep).map(encodeURIComponent).join("/")}`,
      );
    }
  }

  private async flush(): Promise<void> {
    const text = this.buffer;
    this.buffer = "";
    if (!text) return;
    const marker = /^MEDIA:(.+)$/gm;
    let offset = 0;
    for (const match of text.matchAll(marker)) {
      const before = text.slice(offset, match.index).trim();
      if (before) await this.sendText(before);
      await this.sendFile(match[1].trim());
      offset = match.index! + match[0].length;
    }
    const remaining = text.slice(offset).trim();
    if (remaining) await this.sendText(remaining);
  }
}
