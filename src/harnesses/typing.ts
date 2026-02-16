/**
 * TYPING HARNESS
 *
 * Decorator that manages the typing indicator on an OutputHandler.
 * Calls startTyping() before run() and stopTyping() in finally.
 */

import type { OutputHandler } from "../types.js";
import { ProxyHarness } from "./proxy.js";
import type { Harness, HarnessCallbacks } from "./types.js";

export class TypingHarness extends ProxyHarness {
  constructor(delegate: Harness, private readonly handler: OutputHandler | null) {
    super(delegate);
  }

  async run(
    systemPrompt: string,
    userMessage: string,
    callbacks: HarnessCallbacks,
    signal?: AbortSignal
  ): Promise<void> {
    await this.handler?.startTyping?.();
    try {
      await this.delegate.run(systemPrompt, userMessage, callbacks, signal);
    } finally {
      await this.handler?.stopTyping?.();
    }
  }
}

export function withTyping(harness: Harness, handler: OutputHandler | null): TypingHarness {
  return new TypingHarness(harness, handler);
}
