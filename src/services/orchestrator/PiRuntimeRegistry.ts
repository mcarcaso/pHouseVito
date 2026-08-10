import { resolve } from "node:path";
import type { Context } from "../../context/Context.js";
import { xPiSessionsDir, xSkillStore } from "../../lib/x.js";
import type { ResolvedSettings } from "../../shared/schemas/vito-config.js";
import { PiSessionRuntime, type PiSessionRuntimeConfig } from "./PiSessionRuntime.js";

export class PiRuntimeRegistry {
  private readonly runtimes = new Map<string, PiSessionRuntime>();

  get(sessionId: string): PiSessionRuntime | undefined {
    return this.runtimes.get(sessionId);
  }

  delete(sessionId: string): boolean {
    return this.runtimes.delete(sessionId);
  }

  async disposeAll(): Promise<void> {
    for (const runtime of this.runtimes.values()) {
      try {
        await runtime.dispose();
      } catch {
        // Continue shutting down the remaining sessions.
      }
    }
    this.runtimes.clear();
  }

  async getOrCreate(
    x: Context,
    sessionId: string,
    settings: ResolvedSettings,
  ): Promise<PiSessionRuntime> {
    const piConfig = settings["pi-coding-agent"] || {};
    const model = piConfig.model
      || { provider: "anthropic", name: "claude-sonnet-4-20250514" };
    const openRouterProvider = piConfig.openRouterProvider;
    const existing = this.runtimes.get(sessionId);
    if (existing) {
      const desiredModel = `${model.provider}/${model.name}${openRouterProvider ? `@${openRouterProvider}` : ""}`;
      if (existing.getModel() !== desiredModel) {
        try {
          await existing.setModel({ ...model, openRouterProvider });
          console.log(`[PiRuntimeRegistry] Hot-swapped ${sessionId} to ${desiredModel}`);
        } catch (error) {
          console.error(`[PiRuntimeRegistry] Failed to hot-swap ${sessionId}:`, error);
        }
      }
      return existing;
    }

    const sessionDir = resolve(xPiSessionsDir(x), encodeURIComponent(sessionId));
    const runtime = new PiSessionRuntime({
      sessionDir,
      model,
      openRouterProvider,
      thinkingLevel: piConfig.thinkingLevel,
      skills: xSkillStore(x).list(x, {}),
    } satisfies PiSessionRuntimeConfig);
    this.runtimes.set(sessionId, runtime);
    console.log(`[PiRuntimeRegistry] Created ${sessionId} with ${runtime.getModel()} at ${sessionDir}`);
    return runtime;
  }
}
