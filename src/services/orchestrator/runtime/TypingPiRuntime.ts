/**
 * TYPING PI RUNTIME
 *
 * Decorator that manages the typing indicator on an OutputHandler.
 * Calls startTyping() before run() and stopTyping() in finally.
 */

import type { OutputHandler } from "../../../lib/output/OutputHandler.js";
import { ProxyPiRuntime } from "./ProxyPiRuntime.js";
import type { PiRuntime, PiRuntimeCallbacks } from "./PiRuntime.js";

export class TypingPiRuntime extends ProxyPiRuntime {
  constructor(
    delegate: PiRuntime,
    private readonly handler: OutputHandler | null,
  ) {
    super(delegate);
  }

  async run(
    systemPrompt: string,
    userMessage: string,
    callbacks: PiRuntimeCallbacks,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.handler?.startTyping?.();
    try {
      await this.delegate.run(systemPrompt, userMessage, callbacks, signal);
    } finally {
      await this.handler?.stopTyping?.();
    }
  }
}

export function withTyping(runtime: PiRuntime, handler: OutputHandler | null): TypingPiRuntime {
  return new TypingPiRuntime(runtime, handler);
}
