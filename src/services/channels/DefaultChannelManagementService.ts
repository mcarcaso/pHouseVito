import type { Context } from "../../context/Context.js";
import { xSessionStore } from "../../lib/x.js";
import type { SessionRow } from "../../types.js";
import type {
  AliasGenerationResult,
  ChannelManagementAdapter,
  ChannelManagementService,
  CommandRegistrationResult,
  DiscordManagementAdapter,
  ManagedChannelName,
  TelegramManagementAdapter,
} from "./ChannelManagementService.js";
import { ChannelNotConfiguredError } from "./ChannelManagementService.js";

export class DefaultChannelManagementService implements ChannelManagementService {
  private discord?: DiscordManagementAdapter;
  private telegram?: TelegramManagementAdapter;

  configure(_x: Context, args: ChannelManagementAdapter): void {
    if (args.channel === "discord") this.discord = args.adapter;
    else this.telegram = args.adapter;
  }

  async registerCommands(
    _x: Context,
    channel: ManagedChannelName
  ): Promise<CommandRegistrationResult> {
    if (channel === "discord") {
      if (!this.discord) throw new ChannelNotConfiguredError(channel);
      return await this.discord.registerSlashCommands();
    }
    if (!this.telegram) throw new ChannelNotConfiguredError(channel);
    return await this.telegram.setMyCommands();
  }

  async generateAliases(
    x: Context,
    channel: ManagedChannelName
  ): Promise<AliasGenerationResult> {
    if (channel === "discord" && !this.discord) throw new ChannelNotConfiguredError(channel);
    if (channel === "telegram" && !this.telegram) throw new ChannelNotConfiguredError(channel);

    const sessions = xSessionStore(x).list(x, {
      channels: [channel],
      hasAlias: false,
    });
    const updated: string[] = [];
    const failed: string[] = [];

    for (const session of sessions) {
      const alias = channel === "discord"
        ? await this.getDiscordAlias(session)
        : await this.getTelegramAlias(session);
      if (!alias) {
        failed.push(session.id);
        continue;
      }
      xSessionStore(x).update(x, {
        id: session.id,
        changes: { alias },
      });
      updated.push(session.id);
    }

    return {
      success: true,
      updated: updated.length,
      failed: failed.length,
      sessions: { updated, failed },
    };
  }

  private async getDiscordAlias(session: SessionRow): Promise<string | undefined> {
    if (!this.discord || !session.channel_target) return undefined;
    const info = await this.discord.getChannelInfo(session.channel_target);
    if (!info) return undefined;
    return info.guildName ? `${info.guildName} / ${info.name}` : info.name;
  }

  private async getTelegramAlias(session: SessionRow): Promise<string | undefined> {
    if (!this.telegram) return undefined;
    const parts = session.id.split(":");
    const chatId = parts[1];
    const threadId = parts[2];
    if (!chatId) return undefined;
    const info = await this.telegram.getChatInfo(chatId);
    if (!info) return undefined;
    if (info.type === "private") return `telegram: DM: ${info.name}`;
    if (threadId) return `telegram: ${info.name} / Topic`;
    return `telegram: ${info.name}`;
  }
}
