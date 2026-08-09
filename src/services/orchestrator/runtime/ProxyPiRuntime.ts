/**
 * PROXY PI RUNTIME
 *
 * Base class for runtime decorators. Implements the PiRuntime interface
 * and delegates all calls to a wrapped runtime.
 *
 * Extend this to add behavior (logging, tracing, retries, etc.)
 * without modifying the underlying runtime.
 *
 * Lifecycle methods (getModel/setModel/reset/compact/dispose) are NOT
 * forwarded — the orchestrator calls those on the inner (unwrapped)
 * runtime only, since lifecycle is per-Vito-session and the decorator
 * chain is rebuilt per turn.
 */

import type { PiRuntime, PiRuntimeCallbacks } from "./PiRuntime.js";

export class ProxyPiRuntime implements PiRuntime {
  protected readonly delegate: PiRuntime;

  constructor(delegate: PiRuntime) {
    this.delegate = delegate;
  }

  getName(): string {
    return this.delegate.getName();
  }

  async run(
    systemPrompt: string,
    userMessage: string,
    callbacks: PiRuntimeCallbacks,
    signal?: AbortSignal
  ): Promise<void> {
    return this.delegate.run(systemPrompt, userMessage, callbacks, signal);
  }
}
