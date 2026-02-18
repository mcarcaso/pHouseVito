import type { Queries } from "../db/queries.js";
import type { VitoConfig } from "../types.js";

// Lock to prevent concurrent compaction
let isCompacting = false;

/**
 * Check if compaction should be triggered.
 * Returns true when un-compacted message count exceeds threshold.
 */
export function shouldCompact(queries: Queries, config: VitoConfig): boolean {
  // Don't trigger if already compacting
  if (isCompacting) return false;
  
  const count = queries.countUncompacted(config.compaction.messageTypes);
  return count > config.compaction.threshold;
}

/**
 * Acquire the compaction lock. Returns true if acquired, false if already held.
 */
export function acquireCompactionLock(): boolean {
  if (isCompacting) return false;
  isCompacting = true;
  return true;
}

/**
 * Release the compaction lock.
 */
export function releaseCompactionLock(): void {
  isCompacting = false;
}
