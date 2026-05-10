/**
 * PROXY HARNESS
 *
 * Base class for harness decorators. Implements the Harness interface
 * and delegates all calls to a wrapped harness.
 *
 * Extend this to add behavior (logging, tracing, retries, etc.)
 * without modifying the underlying harness.
 *
 * Lifecycle methods (getModel/setModel/reset/compact/dispose) are NOT
 * forwarded — the orchestrator calls those on the inner (unwrapped)
 * harness only, since lifecycle is per-Vito-session and the decorator
 * chain is rebuilt per turn.
 */

import type { Harness, HarnessCallbacks } from "./types.js";

export class ProxyHarness implements Harness {
  protected readonly delegate: Harness;

  constructor(delegate: Harness) {
    this.delegate = delegate;
  }

  getName(): string {
    return this.delegate.getName();
  }

  getCustomInstructions(): string {
    return this.delegate.getCustomInstructions?.() || "";
  }

  async run(
    systemPrompt: string,
    userMessage: string,
    callbacks: HarnessCallbacks,
    signal?: AbortSignal
  ): Promise<void> {
    return this.delegate.run(systemPrompt, userMessage, callbacks, signal);
  }
}
