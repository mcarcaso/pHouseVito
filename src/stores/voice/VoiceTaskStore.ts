import type { Context } from "../../context/Context.js";

export type VoiceTaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface VoiceTaskRow {
  id: string;
  voice_session_id: string;
  question: string;
  status: VoiceTaskStatus;
  result: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

export interface VoiceTaskStore {
  create(x: Context, row: VoiceTaskRow): VoiceTaskRow;
  get(x: Context, id: string): VoiceTaskRow | null;
  update(
    x: Context,
    id: string,
    changes: Partial<Pick<VoiceTaskRow, "status" | "result" | "error" | "updated_at">>,
  ): VoiceTaskRow;
}
