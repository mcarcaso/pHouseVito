import { DEFAULT_SETTINGS } from "../../../src/shared/defaults";
import type { ResolvedSettings } from "./settingsResolution";

let cached: ResolvedSettings = structuredClone(DEFAULT_SETTINGS);

export function setDefaults(defaults: ResolvedSettings): void {
  cached = structuredClone(defaults);
}

export function getDefaults(): ResolvedSettings {
  return cached;
}
