import type { ChannelSpecificConfigProps } from ".";
import BotChannelConfig from "./BotChannelConfig";

export default function DiscordConfig({ renderIdList }: ChannelSpecificConfigProps) {
  return (
    <BotChannelConfig
      channel="discord"
      tokenEnvironmentVariable="DISCORD_BOT_TOKEN"
      commandsLabel="Slash Commands"
      commandsButtonLabel="Register Slash Commands"
      commandsDescription="Only needed once (or when commands change)."
      aliasDescription='Sets "Server / Channel" as alias for sessions without one.'
      idLists={[
        {
          field: "allowedGuildIds",
          label: "Allowed Server IDs",
          emptyText: "No server IDs — all servers allowed",
          placeholder: "Server (Guild) ID",
        },
        {
          field: "allowedChannelIds",
          label: "Allowed Channel IDs",
          emptyText: "No channel IDs — all channels allowed",
          placeholder: "Channel ID",
        },
      ]}
      renderIdList={renderIdList}
    />
  );
}
