import { captureSilentInbound } from "../passive-memory.js";
import {
  Client,
  GatewayIntentBits,
  Partials,
  Message as DiscordMessage,
  REST,
  Routes,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
} from "discord.js";
import type { ResponseLike } from "@discordjs/rest";
import type { Context } from "../../../context/Context.js";
import {
  xDiscordQueueStore,
  xOrchestratorService,
  xProviderService,
  xSecretService,
  xVitoService,
} from "../../../lib/x.js";
import type { OutputHandler } from "../../../lib/output/OutputHandler.js";
import type { InboundEvent } from "../../../lib/types/inbound-event.js";
import type { SessionRow } from "../../../stores/sessions/SessionStore.js";
import type { DurableDiscordEvent } from "../../../stores/discord/DiscordQueueStore.js";
import type { ChannelManagement, ChannelService } from "../ChannelService.js";
import { getEffectiveSettings } from "../../vito/settings.js";
import { DiscordOutputHandler } from "./DiscordOutputHandler.js";
import { queuedSteeringEligibility } from "../../orchestrator/QueuedSteering.js";
import { isConversationMessage } from "./message-events.js";

const DISCORD_MENTION_CONTEXT_MESSAGES = 5;
const DISCORD_HISTORY_PAGE_SIZE = 100;
const DISCORD_HISTORY_MAX_PAGES = 10;

export function formatDiscordSessionAlias(info: { name: string; guildName?: string }): string {
  return info.guildName ? `${info.guildName} / ${info.name}` : info.name;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class DiscordChannelService implements ChannelService {
  readonly name = "discord";
  readonly capabilities = {
    typing: true,
    reactions: true,
    attachments: true,
    streaming: true,
  };

  private client: Client | null = null;
  private token: string | undefined;
  private context: Context | null = null;
  private eventHandler: ((event: InboundEvent) => void | Promise<void>) | null = null;
  private queuePoll: ReturnType<typeof setInterval> | null = null;
  private readonly draining = new Map<string, Promise<void>>();
  private readonly liveRaw = new Map<string, DiscordMessage | ChatInputCommandInteraction>();
  private readonly steeringNotices = new Map<string, DiscordMessage>();
  private readonly applicationOwnerIds = new Set<string>();
  private stopping = false;

  readonly management: ChannelManagement = {
    registerCommands: async (x) => await this.registerSlashCommands(x),
    resolveSessionAlias: async (_x, session) => await this.resolveSessionAlias(session),
  };

  async start(x: Context): Promise<void> {
    const token = xSecretService(x).get(x, "DISCORD_BOT_TOKEN");
    if (!token) {
      throw new Error(
        "DISCORD_BOT_TOKEN not set. Create a bot at https://discord.com/developers/applications",
      );
    }

    this.token = token;
    this.context = x;
    this.stopping = false;
    const recovered = xDiscordQueueStore(x).recover(x);
    if (recovered > 0) {
      console.warn(`[Discord] Marked ${recovered} interrupted item(s) without replaying them`);
    }
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
      partials: [Partials.Channel], // needed for DMs
      // Node's bundled-Undici request path has intermittently closed multipart
      // connections to Discord. Use the supported fetch strategy instead.
      // discord.js types its init as bundled-Undici RequestInit; its runtime
      // builds standard JSON/FormData bodies accepted by Node's global fetch.
      rest: {
        timeout: 20_000,
        makeRequest: async (url, init) =>
          (await fetch(url, init as RequestInit)) as unknown as ResponseLike,
      },
    });

    await this.client.login(token);
    try {
      const application = await this.client.application?.fetch();
      const owner = application?.owner as unknown;
      if (owner && typeof owner === "object" && "id" in owner && typeof owner.id === "string") {
        this.applicationOwnerIds.add(owner.id);
      }
      if (owner && typeof owner === "object" && "members" in owner) {
        const members = owner.members as { keys?: () => IterableIterator<string> };
        for (const id of members.keys?.() ?? []) this.applicationOwnerIds.add(id);
      }
    } catch (error) {
      console.warn(`[Discord] Could not resolve application owner: ${errorMessage(error)}`);
    }
    console.log(`Discord bot started as ${this.client.user?.tag}`);
  }

  async stop(_x: Context): Promise<void> {
    this.stopping = true;
    if (this.queuePoll) clearInterval(this.queuePoll);
    this.queuePoll = null;
    this.eventHandler = null;
    this.client?.destroy();
    this.client = null;
    this.token = undefined;
    this.context = null;
    this.liveRaw.clear();
    this.steeringNotices.clear();
  }

  private isOwner(x: Context, userId: string): boolean {
    const discord = xVitoService(x).getConfig(x).channels.discord as
      (Record<string, unknown> & { ownerIds?: unknown }) | undefined;
    const configured = Array.isArray(discord?.ownerIds)
      ? discord.ownerIds.filter((id): id is string => typeof id === "string")
      : [];
    return configured.includes(userId) || this.applicationOwnerIds.has(userId);
  }

  private durableEvent(event: InboundEvent, id: string, authorId: string): DurableDiscordEvent {
    const metadata =
      event.raw && typeof event.raw === "object" ? (event.raw as Record<string, unknown>) : {};
    return {
      id,
      channel: event.target,
      transportChannel:
        typeof metadata.discordChannelId === "string" ? metadata.discordChannelId : event.target,
      target: event.target,
      sessionKey: event.sessionKey,
      author: event.author,
      authorId,
      timestamp: event.timestamp,
      content: event.content,
      hasMention: event.hasMention !== false,
      commandAuthorized: metadata.commandAuthorized === true,
      attachments: (event.attachments ?? []).map((attachment) => ({
        type: attachment.type,
        url: attachment.url,
        path: attachment.path,
        mimeType: attachment.mimeType,
        filename: attachment.filename,
      })),
    };
  }

  private queue(
    x: Context,
    event: InboundEvent,
    id: string,
    authorId: string,
    raw: DiscordMessage | ChatInputCommandInteraction,
  ): boolean {
    this.liveRaw.set(id, raw);
    const recorded = xDiscordQueueStore(x).record(x, this.durableEvent(event, id, authorId));
    if (!recorded) this.liveRaw.delete(id);
    else this.startDrain(x, event.target);
    return recorded;
  }

  private startDrain(x: Context, channel: string): void {
    if (this.stopping || !this.eventHandler || this.draining.has(channel)) return;
    const work = this.drain(x, channel)
      .catch((error) => console.error(`[Discord] Queue ${channel} stopped: ${errorMessage(error)}`))
      .finally(() => this.draining.delete(channel));
    this.draining.set(channel, work);
  }

  private async sendSteeringNotice(message: DiscordMessage): Promise<void> {
    const notice = await message.reply({
      content: "Message queued. Want to redirect the current turn?",
      allowedMentions: { parse: [] },
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 2,
              label: "Steer now",
              custom_id: `vito-steer:${message.id}`,
            },
          ],
        },
      ],
    });
    this.steeringNotices.set(message.id, notice);
  }

  private async handleSteeringButton(
    x: Context,
    interaction: import("discord.js").ButtonInteraction,
  ) {
    const match = /^vito-steer:([0-9]{1,20})$/.exec(interaction.customId);
    if (!match) return false;
    await interaction.deferReply({ ephemeral: true });
    const id = match[1];
    const store = xDiscordQueueStore(x);
    const pending = store.pending(x, id);
    if (!pending) {
      await interaction.editReply("That queued message is no longer available for steering.");
      return true;
    }
    const eligibility = queuedSteeringEligibility({
      senderId: pending.authorId,
      requesterId: interaction.user.id,
      content: pending.content,
      attachments: pending.attachments,
    });
    if (interaction.user.bot || eligibility === "forbidden") {
      await interaction.editReply("Only the sender of that message can steer the active turn.");
      return true;
    }
    if (interaction.channelId !== pending.transportChannel || eligibility === "ineligible") {
      await interaction.editReply("That message cannot steer this turn; it remains queued.");
      return true;
    }
    const event: InboundEvent = {
      sessionKey: pending.sessionKey,
      channel: "discord",
      target: pending.target,
      author: pending.author,
      timestamp: pending.timestamp,
      content: pending.content,
      attachments: pending.attachments,
      hasMention: pending.hasMention,
      raw: {
        source: "discord",
        discordMessageId: pending.id,
        discordAuthorId: pending.authorId,
        discordChannelId: pending.transportChannel,
        commandAuthorized: pending.commandAuthorized,
      },
    };
    const accepted = await xOrchestratorService(x).steer(x, event);
    if (!accepted || !store.consumePending(x, id)) {
      await interaction.editReply("The active turn finished first. Your message remains queued.");
      return true;
    }
    this.liveRaw.delete(id);
    const notice = this.steeringNotices.get(id) ?? interaction.message;
    this.steeringNotices.delete(id);
    await notice
      .edit({ content: "Steering requested for your queued message.", components: [] })
      .catch(() => {});
    await interaction.editReply("Steering requested.");
    setTimeout(() => void notice.delete().catch(() => {}), 2_000).unref();
    return true;
  }

  private async resolveRaw(
    id: string,
    channelId: string,
  ): Promise<DiscordMessage | ChatInputCommandInteraction | undefined> {
    const live = this.liveRaw.get(id);
    if (live) return live;
    const channel = await this.client?.channels.fetch(channelId).catch(() => null);
    if (channel && "messages" in channel) {
      return await channel.messages.fetch(id).catch(() => undefined);
    }
    return undefined;
  }

  private async drain(x: Context, channel: string): Promise<void> {
    const store = xDiscordQueueStore(x);
    while (!this.stopping && this.eventHandler) {
      const durable = store.claim(x, channel);
      if (!durable) return;
      try {
        const notice = this.steeringNotices.get(durable.id);
        this.steeringNotices.delete(durable.id);
        await notice?.delete().catch(() => {});
        const raw = await this.resolveRaw(durable.id, durable.transportChannel);
        const event: InboundEvent = {
          sessionKey: durable.sessionKey,
          channel: "discord",
          target: durable.target,
          author: durable.author,
          timestamp: durable.timestamp,
          content: durable.content,
          attachments: durable.attachments,
          hasMention: durable.hasMention,
          raw: {
            source: "discord",
            discordMessageId: durable.id,
            discordAuthorId: durable.authorId,
            discordChannelId: durable.transportChannel,
            commandAuthorized: durable.commandAuthorized,
            discordRaw: raw,
          },
        };
        await this.eventHandler(event);
        store.complete(x, durable.id);
      } catch (error) {
        store.interrupt(x, durable.id, errorMessage(error));
      } finally {
        this.liveRaw.delete(durable.id);
      }
    }
  }

  async listen(
    x: Context,
    onEvent: (event: InboundEvent) => void | Promise<void>,
  ): Promise<() => void> {
    const client = this.client;
    const botUser = client?.user;
    if (!client || !botUser) throw new Error("Client not initialized — call start() first");
    this.eventHandler = onEvent;
    for (const channel of xDiscordQueueStore(x).pendingChannels(x)) this.startDrain(x, channel);
    this.queuePoll = setInterval(() => {
      for (const channel of xDiscordQueueStore(x).pendingChannels(x)) this.startDrain(x, channel);
    }, 500);
    this.queuePoll.unref();

    const getAllowlist = (): {
      guildIds: string[];
      channelIds: string[];
      userIds: string[];
      allowDms: boolean;
    } => {
      const config = xVitoService(x).getConfig(x).channels.discord;
      return {
        guildIds: config?.allowedGuildIds ?? [],
        channelIds: config?.allowedChannelIds ?? [],
        userIds: config?.allowedUserIds ?? [],
        allowDms: config?.allowDms ?? true,
      };
    };

    const isAllowed = (msg: DiscordMessage): boolean => {
      const { guildIds, channelIds, userIds, allowDms } = getAllowlist();

      if (!msg.guild) return allowDms;
      if (guildIds.length > 0 && !guildIds.includes(msg.guild.id)) return false;
      if (channelIds.length > 0 && !channelIds.includes(msg.channel.id)) return false;
      return true;
    };

    const isInteractionAllowed = (
      interaction: ChatInputCommandInteraction | import("discord.js").AutocompleteInteraction,
    ): boolean => {
      const { guildIds, channelIds, userIds, allowDms } = getAllowlist();
      if (userIds.length > 0 && !userIds.includes(interaction.user.id)) return false;
      if (!interaction.guild) return allowDms;
      if (guildIds.length > 0 && !guildIds.includes(interaction.guild.id)) return false;
      if (channelIds.length > 0 && !channelIds.includes(interaction.channelId)) return false;
      return true;
    };

    client.on("messageCreate", async (msg) => {
      // Thread titles, renames, pins, and other system events are not user turns.
      if (!isConversationMessage(msg.type) || msg.author.bot) return;

      // Build session key early so we can check per-session settings
      const target = msg.guild ? msg.channel.id : msg.author.id;
      const sessionKey = `discord:${target}`;

      // Check if bot was mentioned (Discord handles this via msg.mentions)
      const isMentioned = msg.mentions.has(botUser.id);
      // DMs are always considered "mentioned" since they're direct
      const hasMention = !msg.guild || isMentioned;

      console.log(
        `[Discord] 📨 Received message from ${msg.author.tag} in ${msg.guild?.name || "DM"}${hasMention ? "" : " (no @mention)"}`,
      );

      if (!isAllowed(msg)) {
        console.log(`[Discord] ❌ Message not allowed — guild/channel not whitelisted`);
        return;
      }

      // Normalize all @mentions to readable names
      const botName = xVitoService(x).getConfig(x).bot?.name || "Vito";
      let content = msg.content;

      // Replace bot mention with bot name (e.g., <@123456> → @BotName)
      content = content.replace(new RegExp(`<@!?${botUser.id}>`, "g"), `@${botName}`);

      // Replace other user mentions with their display names (e.g., <@677139888222502922> → @Ian)
      msg.mentions.users.forEach((user) => {
        if (user.id !== botUser.id) {
          // Get display name from the guild member if available, otherwise username
          const member = msg.guild?.members.cache.get(user.id);
          const displayName = member?.displayName || user.displayName || user.username;
          content = content.replace(new RegExp(`<@!?${user.id}>`, "g"), `@${displayName}`);
        }
      });

      // Replace role mentions with role names (e.g., <@&123456> → @Moderators)
      msg.mentions.roles.forEach((role) => {
        content = content.replace(new RegExp(`<@&${role.id}>`, "g"), `@${role.name}`);
      });

      // Replace channel mentions with channel names (e.g., <#123456> → #general)
      msg.mentions.channels.forEach((channel) => {
        if ("name" in channel) {
          content = content.replace(new RegExp(`<#${channel.id}>`, "g"), `#${channel.name}`);
        }
      });

      content = content.trim();

      const event: InboundEvent = {
        sessionKey,
        channel: "discord",
        target: target,
        author: msg.author.tag,
        authorId: msg.author.id,
        messageId: msg.id,
        timestamp: Date.now(),
        content,
        raw: {
          source: "discord",
          discordMessageId: msg.id,
          discordAuthorId: msg.author.id,
          discordChannelId: msg.channel.id,
          commandAuthorized: this.isOwner(x, msg.author.id),
          discordRaw: msg,
        },
        hasMention, // Channel reports whether bot was mentioned; orchestrator decides what to do
      };

      // Handle attachments
      if (msg.attachments.size > 0) {
        event.attachments = msg.attachments.map((attachment) => ({
          type: attachment.contentType?.startsWith("image/")
            ? ("image" as const)
            : attachment.contentType?.startsWith("audio/")
              ? ("audio" as const)
              : ("file" as const),
          url: attachment.url,
          mimeType: attachment.contentType || "application/octet-stream",
          filename: attachment.name || "attachment",
        }));
      }

      if (captureSilentInbound(x, event)) return;
      const command = content.toLowerCase();
      if (command === "/restart" && !this.isOwner(x, msg.author.id)) {
        await msg.reply("Only the bot owner can restart Vito.");
        return;
      }
      if (command === "/stop" || command === "/restart") {
        const discarded = command === "/stop" ? xDiscordQueueStore(x).discardPending(x, target) : 0;
        event.raw = { ...(event.raw as Record<string, unknown>), discordDiscarded: discarded };
        await onEvent(event);
        return;
      }

      const effective = getEffectiveSettings(xVitoService(x).getConfig(x), "discord", sessionKey);
      if (!hasMention && effective.requireMention !== false) return;
      const store = xDiscordQueueStore(x);
      const busy = this.draining.has(target) || store.pendingChannels(x).includes(target);
      console.log(`[Discord] ✅ Queued durable event ${msg.id} for ${target}`);
      const recorded = this.queue(x, event, msg.id, msg.author.id, msg);
      if (recorded && busy && !event.attachments?.length) {
        await this.sendSteeringNotice(msg).catch((error) =>
          console.warn(`[Discord] Could not offer steering: ${errorMessage(error)}`),
        );
      }
    });

    // Handle slash command interactions
    client.on("interactionCreate", async (interaction) => {
      if (interaction.isButton()) {
        await this.handleSteeringButton(x, interaction).catch((error) =>
          console.error(`[Discord] Steering failed: ${errorMessage(error)}`),
        );
        return;
      }
      if (interaction.isAutocomplete()) {
        if (interaction.commandName !== "model" || !isInteractionAllowed(interaction)) {
          await interaction.respond([]).catch(() => {});
          return;
        }
        try {
          const focused = interaction.options.getFocused(true);
          const choices =
            focused.name === "model"
              ? await xProviderService(x).searchModels(x, String(focused.value))
              : [];
          await interaction.respond(choices.map((value) => ({ name: value.slice(0, 100), value })));
        } catch (error) {
          console.warn(`[Discord] Model autocomplete failed: ${errorMessage(error)}`);
          await interaction.respond([]).catch(() => {});
        }
        return;
      }
      if (!interaction.isChatInputCommand()) return;

      if (!isInteractionAllowed(interaction)) {
        await interaction.reply({
          content: "Not allowed in this server/channel.",
          ephemeral: true,
        });
        return;
      }

      const target = interaction.guild ? interaction.channelId : interaction.user.id;
      const owner = this.isOwner(x, interaction.user.id);
      if (interaction.commandName === "restart" && !owner) {
        await interaction.reply({
          content: "Only the bot owner can restart Vito.",
          ephemeral: true,
        });
        return;
      }

      const value =
        interaction.commandName === "model"
          ? interaction.options.getString("model", false)?.trim()
          : interaction.commandName === "login"
            ? interaction.options.getString("provider", false)?.trim()
            : interaction.commandName === "session"
              ? interaction.options.getString("id", false)?.trim()
              : undefined;
      const content = value
        ? `/${interaction.commandName} ${value}`
        : `/${interaction.commandName}`;
      await interaction.deferReply();
      const discarded =
        interaction.commandName === "stop" ? xDiscordQueueStore(x).discardPending(x, target) : 0;
      const event: InboundEvent = {
        sessionKey: `discord:${target}`,
        channel: "discord",
        target,
        author: interaction.user.tag,
        authorId: interaction.user.id,
        timestamp: Date.now(),
        content,
        hasMention: true,
        raw: {
          source: "discord",
          discordMessageId: interaction.id,
          discordAuthorId: interaction.user.id,
          discordChannelId: interaction.channelId,
          commandAuthorized: owner,
          discordDiscarded: discarded,
          discordRaw: interaction,
        },
      };

      console.log(`[Discord] ⚡ Slash command ${content} from ${interaction.user.tag}`);
      if (interaction.commandName === "stop" || interaction.commandName === "restart") {
        await onEvent(event);
      } else {
        this.queue(x, event, interaction.id, interaction.user.id, interaction);
      }
    });

    return () => {
      this.eventHandler = null;
      if (this.queuePoll) clearInterval(this.queuePoll);
      this.queuePoll = null;
    };
  }

  /**
   * Get channel info (name, guild name) for a Discord channel ID.
   * Used for auto-generating session aliases.
   */
  private async resolveSessionAlias(session: SessionRow): Promise<string | undefined> {
    if (!session.channel_target) return undefined;
    const info = await this.getChannelInfo(session.channel_target);
    if (!info) return undefined;
    return formatDiscordSessionAlias(info);
  }

  private async getChannelInfo(
    channelId: string,
  ): Promise<{ name: string; guildName?: string } | null> {
    if (!this.client) return null;
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel) return null;

      if (channel.isDMBased()) {
        // For DMs, try to get the recipient's username
        if ("recipient" in channel && channel.recipient) {
          return { name: `DM: ${channel.recipient.username}` };
        }
        return { name: "DM" };
      }

      // For guild channels
      if ("name" in channel && "guild" in channel) {
        return {
          name: channel.name,
          guildName: channel.guild?.name,
        };
      }

      return null;
    } catch (err) {
      console.error(`[Discord] Failed to fetch channel ${channelId}:`, err);
      return null;
    }
  }

  /**
   * Register slash commands with the Discord API.
   * Call once (or when commands change). Commands persist until removed.
   */
  async registerSlashCommands(
    x: Context,
  ): Promise<{ success: boolean; count: number; error?: string }> {
    if (!this.client?.user) {
      return { success: false, count: 0, error: "Discord client not initialized" };
    }

    const token = xSecretService(x).get(x, "DISCORD_BOT_TOKEN");
    if (!token) {
      return { success: false, count: 0, error: "DISCORD_BOT_TOKEN not set" };
    }

    const commands = [
      new SlashCommandBuilder()
        .setName("new")
        .setDescription(
          "Fresh start — new pi session, picks up system prompt changes, archives chat",
        ),
      new SlashCommandBuilder()
        .setName("compact")
        .setDescription("Summarize older turns to free context — conversation continues"),
      new SlashCommandBuilder()
        .setName("model")
        .setDescription("Switch or inspect the live pi model for this session")
        .addStringOption((option) =>
          option
            .setName("model")
            .setDescription("Search provider/model-name")
            .setAutocomplete(true)
            .setRequired(false),
        ),
      new SlashCommandBuilder()
        .setName("session")
        .setDescription("List or resume a previous session in this conversation")
        .addStringOption((option) =>
          option.setName("id").setDescription("Exact session ID to resume").setRequired(false),
        ),
      new SlashCommandBuilder()
        .setName("login")
        .setDescription("Connect a model provider with private device authorization")
        .addStringOption((option) =>
          option
            .setName("provider")
            .setDescription("Provider ID (default: openai-codex)")
            .setRequired(false),
        ),
      new SlashCommandBuilder()
        .setName("stop")
        .setDescription("Stop current request and clear any queued messages"),
      new SlashCommandBuilder().setName("status").setDescription("Show session and queue status"),
      new SlashCommandBuilder().setName("help").setDescription("Show deterministic controls"),
      new SlashCommandBuilder()
        .setName("restart")
        .setDescription("Owner-only Vito service restart"),
    ];

    const rest = new REST({ version: "10" }).setToken(token);

    try {
      const data: unknown = await rest.put(Routes.applicationCommands(this.client.user.id), {
        body: commands.map((c) => c.toJSON()),
      });
      if (!Array.isArray(data)) throw new Error("Discord returned an invalid command response");

      console.log(`[Discord] ✅ Registered ${data.length} slash command(s)`);
      return { success: true, count: data.length };
    } catch (error: unknown) {
      const message = errorMessage(error);
      console.error(`[Discord] ❌ Failed to register slash commands:`, message);
      return { success: false, count: 0, error: message };
    }
  }

  createOutputHandler(x: Context, event: InboundEvent): OutputHandler {
    if (!this.client) throw new Error("Discord client not initialized");
    return new DiscordOutputHandler(x, this.client, event, this.token);
  }

  async gatherMentionContext(x: Context, event: InboundEvent): Promise<string | undefined> {
    const metadata =
      event.raw && typeof event.raw === "object" ? (event.raw as Record<string, unknown>) : {};
    const raw =
      metadata.discordRaw instanceof DiscordMessage
        ? metadata.discordRaw
        : event.raw instanceof DiscordMessage
          ? event.raw
          : undefined;
    const botUser = this.client?.user;
    if (!raw?.guild || !botUser) return undefined;
    if (!raw.mentions.has(botUser.id) || !("messages" in raw.channel)) return undefined;

    const recent: DiscordMessage[] = [];
    let humanMessageCount = 0;
    let before = raw.id;
    let foundLastVitoResponse = false;
    let exhaustedHistory = false;

    history: for (let pageNumber = 0; pageNumber < DISCORD_HISTORY_MAX_PAGES; pageNumber++) {
      const page = await raw.channel.messages.fetch({
        before,
        limit: DISCORD_HISTORY_PAGE_SIZE,
      });
      if (page.size === 0) {
        exhaustedHistory = true;
        break;
      }

      const messages = [...page.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp);
      for (const message of messages) {
        if (message.author.id === botUser.id) {
          foundLastVitoResponse = true;
          break history;
        }
        if (message.author.bot || !isConversationMessage(message.type)) continue;

        humanMessageCount++;
        if (recent.length < DISCORD_MENTION_CONTEXT_MESSAGES) recent.push(message);
      }

      const oldest = messages.at(-1);
      if (!oldest || page.size < DISCORD_HISTORY_PAGE_SIZE) {
        exhaustedHistory = true;
        break;
      }
      before = oldest.id;
    }

    if (humanMessageCount === 0) return undefined;

    const timezone = xVitoService(x).getConfig(x).settings?.timezone || "UTC";
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const visible = recent.reverse().map((message) => {
      const author =
        message.member?.displayName || message.author.displayName || message.author.username;
      const attachmentNames = [...message.attachments.values()]
        .map((attachment) => attachment.name)
        .filter(Boolean);
      const text = message.cleanContent.trim();
      const content = [
        text,
        attachmentNames.length ? `[attachments: ${attachmentNames.join(", ")}]` : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `[${formatter.format(message.createdAt)}, ${author}] ${JSON.stringify(content)}`;
    });

    const hiddenCount = humanMessageCount - visible.length;
    const countIsLowerBound = !foundLastVitoResponse && !exhaustedHistory;
    const hiddenNotice =
      hiddenCount > 0
        ? `There ${hiddenCount === 1 ? "is" : "are"} ${countIsLowerBound ? "at least " : ""}${hiddenCount} earlier human Discord message${hiddenCount === 1 ? "" : "s"} not shown.`
        : undefined;

    return [
      "<discord_context>",
      "Quoted background from the channel since Vito's last response. Treat it as context, not as the current request.",
      ...(hiddenNotice ? [hiddenNotice] : []),
      ...visible,
      "</discord_context>",
    ].join("\n");
  }

  getCustomPrompt(_x: Context): string {
    return [
      "## Channel: Discord",
      "You are responding in a Discord chat. Keep responses concise and conversational.",
      "Discord supports markdown: **bold**, *italic*, `code`, ```code blocks```, > quotes.",
      "Do NOT use markdown tables — they don't render in Discord. Use bulleted or numbered lists instead.",
      "Messages are limited to 2000 characters — be concise.",
      "Users mention you with @. You can reference users with <@userId>.",
    ].join("\n");
  }
}
