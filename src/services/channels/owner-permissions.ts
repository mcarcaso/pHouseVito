import type { ChannelConfig } from "../../shared/schemas/vito-config.js";

/** Unset owners inherit explicit allowed users, never an unrestricted allowlist. */
export function channelOwnerIds(config?: ChannelConfig): string[] {
  return config?.ownerIds ?? config?.allowedUserIds ?? [];
}
