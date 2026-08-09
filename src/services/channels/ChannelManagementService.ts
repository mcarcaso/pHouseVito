import type { Context } from "../../context/Context.js";

export type ManagedChannelName = "discord" | "telegram";

export interface CommandRegistrationResult {
  success: boolean;
  count: number;
  error?: string;
}

export interface DiscordManagementAdapter {
  registerSlashCommands(): Promise<CommandRegistrationResult>;
  getChannelInfo(channelId: string): Promise<{
    name: string;
    guildName?: string;
  } | null>;
}

export interface TelegramManagementAdapter {
  setMyCommands(): Promise<CommandRegistrationResult>;
  getChatInfo(chatId: string): Promise<{
    name: string;
    type: string;
  } | null>;
}

export type ChannelManagementAdapter =
  | { channel: "discord"; adapter: DiscordManagementAdapter }
  | { channel: "telegram"; adapter: TelegramManagementAdapter };

export interface AliasGenerationResult {
  success: true;
  updated: number;
  failed: number;
  sessions: {
    updated: string[];
    failed: string[];
  };
}

export class ChannelNotConfiguredError extends Error {
  constructor(channel: ManagedChannelName) {
    super(`${channel === "discord" ? "Discord" : "Telegram"} channel not configured`);
    this.name = "ChannelNotConfiguredError";
  }
}

export interface ChannelManagementService {
  configure(x: Context, args: ChannelManagementAdapter): void;
  registerCommands(
    x: Context,
    channel: ManagedChannelName
  ): Promise<CommandRegistrationResult>;
  generateAliases(
    x: Context,
    channel: ManagedChannelName
  ): Promise<AliasGenerationResult>;
}
