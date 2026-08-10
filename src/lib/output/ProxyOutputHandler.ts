import type { OutputHandler } from "./OutputHandler.js";

/** Pass-through base for focused OutputHandler decorators. */
export class ProxyOutputHandler implements OutputHandler {
  readonly relayEvent?: OutputHandler["relayEvent"];
  readonly startTyping?: OutputHandler["startTyping"];
  readonly stopTyping?: OutputHandler["stopTyping"];
  readonly endMessage?: OutputHandler["endMessage"];
  readonly startReaction?: OutputHandler["startReaction"];
  readonly stopReaction?: OutputHandler["stopReaction"];

  constructor(protected readonly delegate: OutputHandler) {
    this.relayEvent = delegate.relayEvent?.bind(delegate);
    this.startTyping = delegate.startTyping?.bind(delegate);
    this.stopTyping = delegate.stopTyping?.bind(delegate);
    this.endMessage = delegate.endMessage?.bind(delegate);
    this.startReaction = delegate.startReaction?.bind(delegate);
    this.stopReaction = delegate.stopReaction?.bind(delegate);
  }

  async relay(message: string): Promise<void> {
    await this.delegate.relay(message);
  }
}
