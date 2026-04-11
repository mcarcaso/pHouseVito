import type { ResolvedSettings } from './settingsResolution';

let cached: ResolvedSettings | null = null;
let inflight: Promise<ResolvedSettings> | null = null;

export async function loadDefaults(): Promise<ResolvedSettings> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = fetch('/api/settings/defaults')
    .then((r) => {
      if (!r.ok) throw new Error(`defaults endpoint returned ${r.status}`);
      return r.json();
    })
    .then((data: ResolvedSettings) => {
      cached = data;
      inflight = null;
      return data;
    })
    .catch((err) => {
      inflight = null;
      throw err;
    });
  return inflight;
}

export function getDefaults(): ResolvedSettings {
  if (!cached) {
    throw new Error('Settings defaults not loaded — call loadDefaults() before any sync getDefaults() consumer renders');
  }
  return cached;
}
