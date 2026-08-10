import type { ResolvedSettings } from "./settingsResolution";

let cached: ResolvedSettings | null = null;

export function setDefaults(defaults: ResolvedSettings): void {
  cached = defaults;
}

export function getDefaults(): ResolvedSettings {
  if (!cached) {
    throw new Error(
      "Settings defaults not loaded — call loadDefaults() before any sync getDefaults() consumer renders",
    );
  }
  return cached;
}
