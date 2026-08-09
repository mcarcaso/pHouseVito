import { ProxyOutputHandler } from "./ProxyOutputHandler.js";

/** Suppresses conditional cron output containing `NO_REPLY`. */
export class NoReplyOutputHandler extends ProxyOutputHandler {
  override async relay(message: string): Promise<void> {
    if (message.includes("NO_REPLY")) {
      console.log("[NoReplySuppression] Response contained NO_REPLY, suppressing output");
      return;
    }
    await super.relay(message);
  }
}
