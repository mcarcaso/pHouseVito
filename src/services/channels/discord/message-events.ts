import { MessageType } from "discord.js";

/** Only authored messages and replies may become turns or conversation context. */
export function isConversationMessage(type: unknown): boolean {
  return type === MessageType.Default || type === MessageType.Reply;
}
