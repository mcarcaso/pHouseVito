import type { Context } from "../../context/Context.js";

export interface SessionRow {
  id: string;
  channel: string | null;
  channel_target: string | null;
  created_at: number;
  last_active_at: number;
  config: string;
  alias: string | null;
  last_message?: string | null;
}

export interface SessionFilter {
  ids?: string[];
  channels?: string[];
  channelTargets?: string[];
  hasAlias?: boolean;
}

export interface SessionListArgs extends SessionFilter {
  order?: "recent" | "oldest";
  limit?: number;
}

export type CreateSessionArgs = Omit<SessionRow, "last_message">;

export interface UpdateSessionArgs {
  id: string;
  changes: {
    last_active_at?: number;
    config?: string;
    alias?: string | null;
  };
}

export interface DeleteSessionArgs {
  ids: string[];
}

export interface SessionStore {
  list(x: Context, args: SessionListArgs): SessionRow[];
  count(x: Context, args: SessionFilter): number;
  create(x: Context, args: CreateSessionArgs): SessionRow;
  update(x: Context, args: UpdateSessionArgs): SessionRow;
  delete(x: Context, args: DeleteSessionArgs): number;
}
