import type { ChannelSpecificConfigProps } from ".";
import BotChannelConfig from "./BotChannelConfig";

export default function TelegramConfig({ renderIdList }: ChannelSpecificConfigProps) {
  return (
    <BotChannelConfig
      channel="telegram"
      tokenEnvironmentVariable="TELEGRAM_BOT_TOKEN"
      commandsLabel="Bot Commands"
      commandsButtonLabel="Register Bot Commands"
      commandsDescription="Sets /new and /stop in Telegram's command menu."
      aliasDescription="Sets chat name as alias for sessions without one."
      idLists={[
        {
          field: "allowedChatIds",
          label: "Allowed Chat IDs",
          emptyText: "No chat IDs — all chats allowed",
          placeholder: "Chat ID",
        },
      ]}
      renderIdList={renderIdList}
    />
  );
}
