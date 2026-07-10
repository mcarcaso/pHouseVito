import type { Context } from "../../context/Context.js";
import type { TraceRow } from "../../types.js";

export interface TraceStore {
  create(x: Context, args: Omit<TraceRow, "id">): void;
  listRecent(x: Context, args?: { limit?: number }): Omit<TraceRow, "system_prompt">[];
  get(x: Context, id: number): TraceRow | undefined;
}
