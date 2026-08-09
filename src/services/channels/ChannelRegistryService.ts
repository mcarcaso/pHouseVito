import type { Context } from "../../context/Context.js";
import type { ChannelService, CommandRegistrationResult } from "./ChannelService.js";

export interface ChannelRegistration {
  channel: ChannelService;
  x: Context;
}

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
  constructor(channel: string) {
    super(`${channel.charAt(0).toUpperCase()}${channel.slice(1)} channel not configured`);
    this.name = "ChannelNotConfiguredError";
  }
}

export class ChannelManagementNotSupportedError extends Error {
  constructor(channel: string) {
    super(`${channel.charAt(0).toUpperCase()}${channel.slice(1)} channel does not support management operations`);
    this.name = "ChannelManagementNotSupportedError";
  }
}

export interface ChannelRegistryService {
  register(x: Context, channel: ChannelService): void;
  get(x: Context, name: string): ChannelRegistration | undefined;
  list(x: Context): ChannelRegistration[];
  registerCommands(
    x: Context,
    channel: string
  ): Promise<CommandRegistrationResult>;
  generateAliases(
    x: Context,
    channel: string
  ): Promise<AliasGenerationResult>;
}
