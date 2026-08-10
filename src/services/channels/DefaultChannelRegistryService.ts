import type { Context } from "../../context/Context.js";
import { xSessionStore } from "../../lib/x.js";
import type {
  AliasGenerationResult,
  ChannelRegistration,
  ChannelRegistryService,
} from "./ChannelRegistryService.js";
import {
  ChannelManagementNotSupportedError,
  ChannelNotConfiguredError,
} from "./ChannelRegistryService.js";
import type { ChannelService, CommandRegistrationResult } from "./ChannelService.js";

export class DefaultChannelRegistryService implements ChannelRegistryService {
  private readonly channels = new Map<string, ChannelRegistration>();

  register(x: Context, channel: ChannelService): void {
    this.channels.set(channel.name, { channel, x });
  }

  get(_x: Context, name: string): ChannelRegistration | undefined {
    return this.channels.get(name);
  }

  list(_x: Context): ChannelRegistration[] {
    return [...this.channels.values()];
  }

  async registerCommands(x: Context, channelName: string): Promise<CommandRegistrationResult> {
    const management = this.getManagement(x, channelName);
    return await management.registerCommands(x);
  }

  async generateAliases(x: Context, channelName: string): Promise<AliasGenerationResult> {
    const management = this.getManagement(x, channelName);
    const sessions = xSessionStore(x).list(x, {
      channels: [channelName],
      hasAlias: false,
    });
    const updated: string[] = [];
    const failed: string[] = [];

    for (const session of sessions) {
      const alias = await management.resolveSessionAlias(x, session);
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

  private getManagement(
    x: Context,
    channelName: string,
  ): NonNullable<ChannelService["management"]> {
    const registration = this.get(x, channelName);
    if (!registration) throw new ChannelNotConfiguredError(channelName);
    const management = registration.channel.management;
    if (!management) throw new ChannelManagementNotSupportedError(channelName);
    return management;
  }
}
