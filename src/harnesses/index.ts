/**
 * Harness module exports
 */

export type { Harness, HarnessCallbacks, NormalizedEvent } from "./types.js";
export { PiHarness, type PiHarnessConfig } from "./pi-coding-agent/index.js";
export { ClaudeCodeHarness, type ClaudeCodeConfig } from "./claude-code/index.js";
export { ProxyHarness } from "./proxy.js";
export { TracingHarness, withTracing, type TracingOptions } from "./tracing.js";
export { PersistenceHarness, withPersistence, type PersistenceOptions } from "./persistence.js";
export { RelayHarness, withRelay, type RelayOptions } from "./relay.js";
export { TypingHarness, withTyping } from "./typing.js";
