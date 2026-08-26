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
import type { Context } from "../../../context/Context.js";
import { xSecretService, xVitoService } from "../../../lib/x.js";
import type { OutputHandler } from "../../../lib/output/OutputHandler.js";
import type { InboundEvent } from "../../../lib/types/inbound-event.js";
import type { SessionRow } from "../../../stores/sessions/SessionStore.js";
import type { ChannelManagement, ChannelService } from "../ChannelService.js";
import { DiscordOutputHandler } from "./DiscordOutputHandler.js";

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
    streaming: false,
  };

  private client: Client | null = null;
  private token: string | undefined;

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
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
      partials: [Partials.Channel], // needed for DMs
      rest: { timeout: 60_000 }, // 60s timeout for file uploads (default 15s was too short)
    });

    await this.client.login(token);
    console.log(`Discord bot started as ${this.client.user?.tag}`);
  }

  async stop(_x: Context): Promise<void> {
    this.client?.destroy();
    this.client = null;
    this.token = undefined;
  }

  async listen(x: Context, onEvent: (event: InboundEvent) => void): Promise<() => void> {
    const client = this.client;
    const botUser = client?.user;
    if (!client || !botUser) throw new Error("Client not initialized — call start() first");

    const getAllowlist = (): { guildIds: string[]; channelIds: string[] } => {
      const config = xVitoService(x).getConfig(x).channels.discord;
      return {
        guildIds: config?.allowedGuildIds ?? [],
        channelIds: config?.allowedChannelIds ?? [],
      };
    };

    const isAllowed = (msg: DiscordMessage): boolean => {
      const { guildIds, channelIds } = getAllowlist();
      // Always allow DMs
      if (!msg.guild) return true;
      // Check guild whitelist
      if (guildIds.length > 0 && !guildIds.includes(msg.guild.id)) return false;
      // Check channel whitelist
      if (channelIds.length > 0 && !channelIds.includes(msg.channel.id)) return false;
      return true;
    };

    const isInteractionAllowed = (interaction: ChatInputCommandInteraction): boolean => {
      if (!interaction.guild) return true;
      const { guildIds, channelIds } = getAllowlist();
      if (guildIds.length > 0 && !guildIds.includes(interaction.guild.id)) return false;
      if (channelIds.length > 0 && !channelIds.includes(interaction.channelId)) return false;
      return true;
    };

    client.on("messageCreate", async (msg) => {
      // Ignore bot's own messages
      if (msg.author.bot) return;

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
        timestamp: Date.now(),
        content,
        raw: msg,
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

      console.log(`[Discord] ✅ Firing onEvent for ${target}`);
      onEvent(event);
    });

    // Handle slash command interactions
    client.on("interactionCreate", async (interaction) => {
      if (!interaction.isChatInputCommand()) return;

      if (!isInteractionAllowed(interaction)) {
        await interaction.reply({
          content: "Not allowed in this server/channel.",
          ephemeral: true,
        });
        return;
      }

      const target = interaction.guild ? interaction.channelId : interaction.user.id;

      if (interaction.commandName === "new") {
        // Defer the reply since embedding can take a while
        await interaction.deferReply();

        const event: InboundEvent = {
          sessionKey: `discord:${target}`,
          channel: "discord",
          target: target,
          author: interaction.user.tag,
          timestamp: Date.now(),
          content: "/new",
          raw: interaction,
        };

        console.log(`[Discord] ⚡ Slash command /new from ${interaction.user.tag}`);
        onEvent(event);
      }

      if (interaction.commandName === "compact") {
        await interaction.deferReply();

        const event: InboundEvent = {
          sessionKey: `discord:${target}`,
          channel: "discord",
          target: target,
          author: interaction.user.tag,
          timestamp: Date.now(),
          content: "/compact",
          raw: interaction,
        };

        console.log(`[Discord] ⚡ Slash command /compact from ${interaction.user.tag}`);
        onEvent(event);
      }

      if (interaction.commandName === "model") {
        await interaction.deferReply();
        const model = interaction.options.getString("model", false)?.trim() || "";

        const event: InboundEvent = {
          sessionKey: `discord:${target}`,
          channel: "discord",
          target: target,
          author: interaction.user.tag,
          timestamp: Date.now(),
          content: model ? `/model ${model}` : "/model",
          raw: interaction,
        };

        console.log(`[Discord] ⚡ Slash command /model from ${interaction.user.tag}`);
        onEvent(event);
      }

      if (interaction.commandName === "stop") {
        // Defer so we can respond after orchestrator handles it
        await interaction.deferReply();

        const event: InboundEvent = {
          sessionKey: `discord:${target}`,
          channel: "discord",
          target: target,
          author: interaction.user.tag,
          timestamp: Date.now(),
          content: "/stop",
          raw: interaction,
        };

        console.log(`[Discord] ⚡ Slash command /stop from ${interaction.user.tag}`);
        onEvent(event);
      }

      if (interaction.commandName === "restart") {
        // Defer so we can respond before server dies
        await interaction.deferReply();

        const event: InboundEvent = {
          sessionKey: `discord:${target}`,
          channel: "discord",
          target: target,
          author: interaction.user.tag,
          timestamp: Date.now(),
          content: "/restart",
          raw: interaction,
        };

        console.log(`[Discord] ⚡ Slash command /restart from ${interaction.user.tag}`);
        onEvent(event);
      }
    });

    return () => {
      // Cleanup handled by stop()
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
            .setDescription("provider/model-name, e.g. anthropic/claude-sonnet-4-20250514")
            .setRequired(false),
        ),
      new SlashCommandBuilder()
        .setName("stop")
        .setDescription("Stop current request and clear any queued messages"),
      new SlashCommandBuilder().setName("restart").setDescription("Restart the Vito server (PM2)"),
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

  createOutputHandler(_x: Context, event: InboundEvent): OutputHandler {
    if (!this.client) throw new Error("Discord client not initialized");
    return new DiscordOutputHandler(this.client, event, this.token);
  }

  async gatherMentionContext(x: Context, event: InboundEvent): Promise<string | undefined> {
    const raw = event.raw;
    const botUser = this.client?.user;
    if (!(raw instanceof DiscordMessage) || !raw.guild || !botUser) return undefined;
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
        if (message.author.bot || message.system) continue;

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
