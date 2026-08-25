import type { Context } from "../../context/Context.js";

export type QuickCommandStatus =
  "queued" | "transcribing" | "processing" | "completed" | "empty" | "failed";
export interface QuickCommandRow {
  id: string;
  status: QuickCommandStatus;
  transcript: string | null;
  result: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}
export interface QuickCommandStore {
  create(x: Context, row: QuickCommandRow): QuickCommandRow;
  get(x: Context, id: string): QuickCommandRow | null;
  update(
    x: Context,
    id: string,
    changes: Partial<
      Pick<QuickCommandRow, "status" | "transcript" | "result" | "error" | "updated_at">
    >,
  ): QuickCommandRow;
}
