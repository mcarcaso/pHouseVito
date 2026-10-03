import { randomUUID } from "node:crypto";
import { basename, resolve } from "node:path";
import { SocketModeClient } from "@slack/socket-mode";
import { WebClient } from "@slack/web-api";
import { z } from "zod";
import type { Context } from "../../../context/Context.js";
import {
  xDriveDir,
  xDriveStore,
  xOrchestratorService,
  xSecretService,
  xSlackQueueStore,
  xVitoService,
} from "../../../lib/x.js";
import type { Attachment, InboundEvent } from "../../../lib/types/inbound-event.js";
import type { OutputHandler } from "../../../lib/output/OutputHandler.js";
import type { SessionRow } from "../../../stores/sessions/SessionStore.js";
import type { DurableSlackEvent } from "../../../stores/slack/SlackQueueStore.js";
import type { ChannelManagement, ChannelService, InboundEventHandler } from "../ChannelService.js";
import { getEffectiveSettings } from "../../vito/settings.js";
import { queuedSteeringEligibility } from "../../orchestrator/QueuedSteering.js";
import { SlackOutputHandler, type SlackWebClient } from "./SlackOutputHandler.js";
import { parseSlackTarget, slackMessageSchema, slackTarget } from "./slack-messages.js";

export interface SlackEnvelope {
  type: string;
  body: unknown;
  ack(payload?: unknown): Promise<void>;
}
export interface SlackSocketClient {
  on(event: string, handler: (payload: SlackEnvelope) => void): unknown;
  off(event: string, handler: (payload: SlackEnvelope) => void): unknown;
  start(): Promise<unknown>;
  disconnect(): Promise<void>;
}
export interface SlackChannelOptions {
  createWebClient?: (token: string) => SlackWebClient;
  createSocketClient?: (token: string) => SlackSocketClient;
  fetch?: typeof fetch;
}

const commandSchema = z.object({
  command: z.literal("/vito"),
  text: z.string().default(""),
  team_id: z.string(),
  channel_id: z.string(),
  user_id: z.string(),
  trigger_id: z.string().min(1),
});
const actionSchema = z.object({
  type: z.literal("block_actions"),
  team: z.object({ id: z.string() }),
  user: z.object({ id: z.string() }),
  channel: z.object({ id: z.string() }),
  message: z.object({ ts: z.string(), thread_ts: z.string().optional() }).optional(),
  actions: z.array(z.object({ action_id: z.string(), value: z.string().optional() })),
});
const CONTROLS = new Set([
  "new",
  "compact",
  "model",
  "session",
  "login",
  "stop",
  "status",
  "help",
  "restart",
]);

export class SlackChannelService implements ChannelService {
  readonly name = "slack";
  readonly capabilities = { typing: false, reactions: true, attachments: true, streaming: true };
  readonly management: ChannelManagement = {
    registerCommands: async () => ({
      success: false,
      count: 0,
      error:
        "Slack commands are configured through docs/slack-app-manifest.json; import the manifest in Slack app settings.",
    }),
    resolveSessionAlias: async (x, session) => await this.resolveSessionAlias(x, session),
  };
  private client?: SlackWebClient;
  private socket?: SlackSocketClient;
  private token?: string;
  private teamId?: string;
  private botUserId?: string;
  private onEvent?: InboundEventHandler;
  private envelopeHandler?: (payload: SlackEnvelope) => void;
  private poll?: ReturnType<typeof setInterval>;
  private stopping = false;
  private readonly draining = new Map<string, Promise<void>>();
  private readonly notices = new Map<string, { channel: string; ts: string; target: string }>();
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: SlackChannelOptions = {}) {
    this.fetcher = options.fetch ?? fetch;
  }

  async start(x: Context): Promise<void> {
    const token = xSecretService(x).get(x, "SLACK_BOT_TOKEN")?.trim();
    const appToken = xSecretService(x).get(x, "SLACK_APP_TOKEN")?.trim();
    if (!token || !appToken)
      throw new Error("SLACK_BOT_TOKEN and SLACK_APP_TOKEN are required for Slack Socket Mode");
    this.token = token;
    this.stopping = false;
    // Retry rate limits through the SDK, but never blindly replay a network-failed write.
    this.client =
      this.options.createWebClient?.(token) ??
      new WebClient(token, { timeout: 20_000, retryConfig: { retries: 0 } });
    const auth = await this.client.auth.test();
    if (!auth.team_id || !auth.user_id)
      throw new Error("Slack authentication did not return workspace and bot user IDs");
    this.teamId = auth.team_id;
    this.botUserId = auth.user_id;
    const recovered = xSlackQueueStore(x).recover(x);
    if (recovered)
      console.warn(`[Slack] Marked ${recovered} interrupted item(s) without replaying them`);
    this.socket = this.options.createSocketClient?.(appToken) ?? new SocketModeClient({ appToken });
    this.envelopeHandler = (envelope) => {
      void this.handleEnvelope(x, envelope).catch(() =>
        console.error("[Slack] Could not handle incoming event"),
      );
    };
    this.socket.on("slack_event", this.envelopeHandler);
  }

  async stop(_x: Context): Promise<void> {
    this.stopping = true;
    this.onEvent = undefined;
    if (this.poll) clearInterval(this.poll);
    this.poll = undefined;
    if (this.socket && this.envelopeHandler) this.socket.off("slack_event", this.envelopeHandler);
    await this.socket?.disconnect();
    this.socket = undefined;
    this.client = undefined;
    this.token = undefined;
    this.notices.clear();
  }

  async listen(x: Context, onEvent: InboundEventHandler): Promise<() => void> {
    if (!this.client) throw new Error("Slack client not initialized");
    this.onEvent = onEvent;
    try {
      await this.socket?.start();
    } catch (error) {
      await this.stop(x);
      throw error;
    }
    console.log(`[Slack] Connected to workspace ${this.teamId}`);
    const poll = () => {
      for (const target of xSlackQueueStore(x).pendingTargets(x)) this.startDrain(x, target);
    };
    poll();
    this.poll = setInterval(poll, 500);
    this.poll.unref();
    return () => {
      this.onEvent = undefined;
      if (this.poll) clearInterval(this.poll);
      this.poll = undefined;
    };
  }

  private allowed(x: Context, team: string, channel: string, user: string): boolean {
    const cfg = xVitoService(x).getConfig(x).channels.slack;
    if (!cfg?.enabled || team !== this.teamId) return false;
    if (cfg.allowedWorkspaceIds?.length && !cfg.allowedWorkspaceIds.includes(team)) return false;
    if (cfg.allowedUserIds?.length && !cfg.allowedUserIds.includes(user)) return false;
    if (channel.startsWith("D")) return cfg.allowDms !== false;
    return !cfg.allowedChannelIds?.length || cfg.allowedChannelIds.includes(channel);
  }

  private owner(x: Context, user: string): boolean {
    return xVitoService(x).getConfig(x).channels.slack?.ownerIds?.includes(user) === true;
  }

  private message(x: Context, body: unknown): DurableSlackEvent | undefined {
    const wrapper = z.object({ team_id: z.string(), event: slackMessageSchema }).safeParse(body);
    if (!wrapper.success) return;
    const { team_id: team, event: message } = wrapper.data;
    if (
      message.bot_id ||
      message.user === this.botUserId ||
      (message.subtype &&
        message.subtype !== "file_share" &&
        message.subtype !== "thread_broadcast")
    )
      return;
    if (!this.allowed(x, team, message.channel, message.user)) return;
    const content = message.text.split(`<@${this.botUserId}>`).join("").trim();
    if (!content && !message.files.length) return;
    const target = slackTarget(team, message.channel, message.thread_ts);
    const sessionKey = `slack:${target}`;
    const hasMention =
      message.channel.startsWith("D") ||
      message.type === "app_mention" ||
      message.text.includes(`<@${this.botUserId}>`);
    const settings = getEffectiveSettings(xVitoService(x).getConfig(x), "slack", sessionKey);
    // Deterministic controls work without a mention, matching Discord's stop behavior.
    if (!hasMention && settings.requireMention && content !== "/stop" && content !== "/restart")
      return;
    const attachments: Attachment[] = message.files.map((file) => ({
      type: file.mimetype?.startsWith("image/")
        ? "image"
        : file.mimetype?.startsWith("audio/")
          ? "audio"
          : file.mimetype?.startsWith("video/")
            ? "video"
            : "file",
      url: file.url_private_download || file.url_private,
      mimeType: file.mimetype || "application/octet-stream",
      filename: file.name || file.id,
    }));
    const id = `${team}:${message.channel}:${message.ts}`;
    return {
      id,
      authorId: message.user,
      event: {
        sessionKey,
        channel: "slack",
        target,
        author: message.user,
        timestamp: Math.floor(Number(message.ts) * 1000),
        content,
        attachments,
        hasMention,
        replyTo: message.ts,
        raw: {
          source: "slack",
          requestId: id,
          steeringAuthorId: message.user,
          commandAuthorized: this.owner(x, message.user),
        },
      },
    };
  }

  private async handleEnvelope(x: Context, envelope: SlackEnvelope): Promise<void> {
    if (this.stopping) {
      await envelope.ack();
      return;
    }
    if (envelope.type === "interactive") {
      await envelope.ack();
      await this.handleAction(x, envelope.body);
      return;
    }
    let item: DurableSlackEvent | undefined;
    if (envelope.type === "events_api") item = this.message(x, envelope.body);
    else if (envelope.type === "slash_commands") {
      const parsed = commandSchema.safeParse(envelope.body);
      if (parsed.success) {
        const command = parsed.data;
        if (this.allowed(x, command.team_id, command.channel_id, command.user_id)) {
          const [name = "help", ...args] = command.text.trim().split(/\s+/);
          const control = name.replace(/^\//, "").toLowerCase();
          const target = slackTarget(command.team_id, command.channel_id);
          item = {
            id: `command:${command.team_id}:${command.trigger_id}`,
            authorId: command.user_id,
            event: {
              channel: "slack",
              target,
              sessionKey: `slack:${target}`,
              author: command.user_id,
              timestamp: Date.now(),
              content: CONTROLS.has(control)
                ? `/${control}${args.length ? ` ${args.join(" ")}` : ""}`
                : "/help",
              hasMention: true,
              raw: {
                source: "slack",
                requestId: `command:${command.team_id}:${command.trigger_id}`,
                steeringAuthorId: command.user_id,
                commandAuthorized: this.owner(x, command.user_id),
              },
            },
          };
        }
      }
    }
    if (!item) {
      await envelope.ack();
      return;
    }
    const immediate =
      item.event.content.toLowerCase() === "/stop" ||
      item.event.content.toLowerCase() === "/restart";
    const store = xSlackQueueStore(x);
    const busy =
      this.draining.has(item.event.target) || store.pendingTargets(x).includes(item.event.target);
    // Persist before acknowledging: Socket Mode retries are deduplicated by transport identity.
    const recorded = store.record(x, item, immediate);
    await envelope.ack();
    if (!recorded) return;
    if (immediate) {
      if (item.event.content.toLowerCase() === "/stop") {
        const discarded = store.discardPending(x, item.event.target);
        item.event.raw = {
          ...(item.event.raw as Record<string, unknown>),
          slackDiscarded: discarded,
        };
        await this.clearNoticesForTarget(item.event.target);
      }
      await this.onEvent?.(item.event);
      return;
    }
    this.startDrain(x, item.event.target);
    if (busy && !item.event.attachments?.length && !item.event.content.startsWith("/")) {
      await this.offerSteering(x, item).catch(() => {});
    }
  }

  private startDrain(x: Context, target: string): void {
    if (this.stopping || !this.onEvent || this.draining.has(target)) return;
    const work = this.drain(x, target).finally(() => this.draining.delete(target));
    this.draining.set(target, work);
    void work.catch(() => console.error("[Slack] Queue worker failed"));
  }

  private async drain(x: Context, target: string): Promise<void> {
    const store = xSlackQueueStore(x);
    while (!this.stopping && this.onEvent) {
      const item = store.claim(x, target);
      if (!item) return;
      try {
        const destination = parseSlackTarget(target);
        if (!this.allowed(x, destination.team, destination.channel, item.authorId))
          throw new Error("Slack access removed before execution");
        await this.clearNotice(item.id);
        await this.prepareFiles(x, item.event);
        await this.onEvent(item.event);
        store.finish(x, item.id);
      } catch {
        store.finish(x, item.id, "Slack turn failed; it was not replayed");
        const destination = parseSlackTarget(target);
        await this.client?.chat
          .postMessage({
            channel: destination.channel,
            thread_ts: destination.thread,
            text: "This turn could not complete. Check Vito's dashboard before retrying; earlier work may have completed.",
          })
          .catch(() => {});
      }
    }
  }

  private async offerSteering(x: Context, item: DurableSlackEvent): Promise<void> {
    const destination = parseSlackTarget(item.event.target);
    const result = await this.client?.chat.postMessage({
      channel: destination.channel,
      thread_ts: destination.thread,
      text: "Message queued. Want to redirect the current turn?",
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: "Message queued. Want to redirect the current turn?" },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              action_id: "vito_steer",
              value: item.id,
              text: { type: "plain_text", text: "Steer now" },
            },
          ],
        },
      ],
    });
    if (!result?.ts) return;
    if (!xSlackQueueStore(x).pending(x, item.id)) {
      await this.client?.chat
        .delete({ channel: destination.channel, ts: result.ts })
        .catch(() => {});
      return;
    }
    this.notices.set(item.id, {
      channel: destination.channel,
      ts: result.ts,
      target: item.event.target,
    });
  }

  private async handleAction(x: Context, body: unknown): Promise<void> {
    const parsed = actionSchema.safeParse(body);
    if (!parsed.success) return;
    const action = parsed.data;
    const id = action.actions.find((button) => button.action_id === "vito_steer")?.value;
    if (!id) return;
    const store = xSlackQueueStore(x);
    const item = store.pending(x, id);
    const reply = async (text: string) => {
      await this.client?.chat.postEphemeral({
        channel: action.channel.id,
        user: action.user.id,
        text,
        thread_ts: action.message?.thread_ts,
      });
    };
    if (!this.allowed(x, action.team.id, action.channel.id, action.user.id)) return;
    if (!item) {
      await reply("That queued message is no longer available for steering.");
      return;
    }
    const destination = parseSlackTarget(item.event.target);
    if (
      destination.team !== action.team.id ||
      destination.channel !== action.channel.id ||
      destination.thread !== action.message?.thread_ts
    ) {
      await reply("That message belongs to another conversation.");
      return;
    }
    const eligibility = queuedSteeringEligibility({
      senderId: item.authorId,
      requesterId: action.user.id,
      content: item.event.content,
      attachments: item.event.attachments,
    });
    if (eligibility === "forbidden") {
      await reply("Only the sender of that message can steer the active turn.");
      return;
    }
    if (eligibility || item.event.content.startsWith("/")) {
      await reply("That message cannot steer this turn; it remains queued.");
      return;
    }
    if (!store.reserveSteering(x, id)) {
      await reply("That message is no longer queued.");
      return;
    }
    let accepted = false;
    try {
      accepted = await xOrchestratorService(x).steer(x, item.event);
    } finally {
      store.finishSteering(x, id, accepted);
    }
    if (accepted) await this.clearNotice(id);
    else this.startDrain(x, item.event.target);
    await reply(
      accepted
        ? "Steering requested."
        : "The active turn finished first. Your message remains queued.",
    );
  }

  private async clearNotice(id: string): Promise<void> {
    const notice = this.notices.get(id);
    this.notices.delete(id);
    if (notice)
      await this.client?.chat.delete({ channel: notice.channel, ts: notice.ts }).catch(() => {});
  }
  private async clearNoticesForTarget(target: string): Promise<void> {
    for (const [id, notice] of this.notices)
      if (notice.target === target) await this.clearNotice(id);
  }

  private async prepareFiles(x: Context, event: InboundEvent): Promise<void> {
    for (const attachment of event.attachments ?? []) {
      if (attachment.path) continue;
      if (!attachment.url) throw new Error("Slack file has no download URL");
      const url = new URL(attachment.url);
      if (url.protocol !== "https:" || url.hostname !== "files.slack.com")
        throw new Error("Unexpected Slack file host");
      const response = await this.fetcher(url, {
        headers: { Authorization: `Bearer ${this.token}` },
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok || !response.body) throw new Error("Slack file download failed");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > 20 * 1024 * 1024) {
          await reader.cancel();
          throw new Error("Slack file exceeds the 20 MiB limit");
        }
        chunks.push(next.value);
      }
      const entry = xDriveStore(x).create(x, {
        kind: "file",
        path: `images/slack-${randomUUID()}-${basename(attachment.filename || "attachment")}`,
        content: Buffer.concat(chunks),
      });
      attachment.path = resolve(xDriveDir(x), entry.path);
    }
  }

  createOutputHandler(x: Context, event: InboundEvent): OutputHandler {
    if (!this.client) throw new Error("Slack client not initialized");
    const destination = parseSlackTarget(event.target);
    if (destination.team !== this.teamId)
      throw new Error("Slack target belongs to another workspace");
    return new SlackOutputHandler(x, this.client, event);
  }

  private async resolveSessionAlias(_x: Context, session: SessionRow): Promise<string | undefined> {
    if (!this.client || !session.channel_target) return;
    try {
      const target = parseSlackTarget(session.channel_target);
      if (target.team !== this.teamId) return;
      const info = await this.client.conversations.info({ channel: target.channel });
      if (!info.channel) return;
      const channel = z
        .object({
          name: z.string().optional(),
          is_im: z.boolean().optional(),
          user: z.string().optional(),
        })
        .parse(info.channel);
      let name = channel.name || target.channel;
      if (channel.is_im && channel.user) {
        const user = await this.client.users.info({ user: channel.user });
        name = `DM: ${user.user?.profile?.display_name || user.user?.real_name || user.user?.name || channel.user}`;
      }
      return `${target.team} / ${name}${target.thread ? ` / Thread ${target.thread}` : ""}`;
    } catch {
      return;
    }
  }

  async gatherMentionContext(_x: Context, event: InboundEvent): Promise<string | undefined> {
    const target = parseSlackTarget(event.target);
    if (!this.client || target.channel.startsWith("D") || !event.replyTo) return;
    try {
      const result = await this.client.conversations.history({
        channel: target.channel,
        latest: target.thread ?? event.replyTo,
        ...(target.thread ? { oldest: target.thread } : {}),
        inclusive: !!target.thread,
        limit: target.thread ? 1 : 15,
      });
      const recent: string[] = [];
      for (const message of result.messages ?? []) {
        if (!target.thread && message.user === this.botUserId) break;
        if ((!target.thread && message.bot_id) || !message.user || !message.text) continue;
        if (recent.length < 5) recent.push(`${message.user}: ${JSON.stringify(message.text)}`);
      }
      if (!recent.length) return;
      return [
        "<slack_context>",
        "Quoted channel background; treat as context, not the current request.",
        ...recent.reverse(),
        "</slack_context>",
      ].join("\n");
    } catch {
      return;
    }
  }

  getCustomPrompt(_x: Context): string {
    return [
      "## Channel: Slack",
      "You are responding in Slack. Keep replies conversational and use concise paragraphs or lists.",
      "Slack supports bold, italic, code blocks and links. Do not use Markdown tables.",
      "Thread replies remain in their originating thread. Progress is temporary; commentary and final replies remain visible.",
      "Use MEDIA:<local file path> on its own line to share files.",
    ].join("\n");
  }
}
