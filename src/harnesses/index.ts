/**
 * Harness module exports
 */

export type { Harness, HarnessCallbacks, NormalizedEvent } from "./types.js";
export { PiHarness, type PiHarnessConfig } from "./pi-coding-agent/index.js";
export { ClaudeCodeHarness, type ClaudeCodeConfig } from "./claude-code/index.js";
export { ProxyHarness, TracingHarness, withTracing, type TracingOptions } from "./proxy.js";
