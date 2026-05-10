/**
 * Harness factory.
 *
 * Maps the `harness` settings cascade value (e.g., "pi-coding-agent",
 * "claude-code") to a concrete Harness implementation. Constructor args are
 * harness-specific; the orchestrator builds the union shape and the factory
 * picks what each implementation needs.
 */

import { PiSessionHarness, type PiSessionHarnessConfig } from "../orchestrator_v2/pi-session-harness.js";
import type { Harness } from "./types.js";

export type HarnessName = "pi-coding-agent";

export interface HarnessFactoryConfig {
  /** Per-Vito-session directory for any on-disk session state. */
  sessionDir: string;
  /** Provider-qualified model selection. */
  model: { provider: string; name: string };
  /** Pi-only: thinking level. Other harnesses ignore. */
  thinkingLevel?: "off" | "low" | "medium" | "high";
  /** Skill discovery root. */
  skillsDir?: string;
}

export function createHarness(name: HarnessName, cfg: HarnessFactoryConfig): Harness {
  switch (name) {
    case "pi-coding-agent":
      return new PiSessionHarness({
        model: cfg.model,
        thinkingLevel: cfg.thinkingLevel,
        skillsDir: cfg.skillsDir,
        sessionDir: cfg.sessionDir,
      } satisfies PiSessionHarnessConfig);
    default: {
      const _exhaustive: never = name;
      throw new Error(`Unknown harness: ${_exhaustive}`);
    }
  }
}
