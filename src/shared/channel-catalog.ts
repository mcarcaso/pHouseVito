/** Channels available for owner configuration. Direct is an internal, lazy API transport. */
export const CHANNEL_CATALOG = [
  { name: "dashboard", requiredSecrets: [] },
  { name: "discord", requiredSecrets: ["DISCORD_BOT_TOKEN"] },
  { name: "telegram", requiredSecrets: ["TELEGRAM_BOT_TOKEN"] },
  { name: "whatsapp", requiredSecrets: ["WHATSAPP_AGENT_API_KEY"] },
] as const;

export interface ChannelSetupStatus {
  name: string;
  requiredSecrets: string[];
  missingSecrets: string[];
  enabled: boolean;
  startupEnabled: boolean;
  restartRequired: boolean;
}
