import type { Context } from "../../context/Context.js";
import type { Store } from "../Store.js";

export type MsgType = "user" | "thought" | "assistant" | "tool_start" | "tool_end";

export interface MessageRow {
  id: number;
  session_id: string;
  channel: string | null;
  channel_target: string | null;
  timestamp: number;
  type: MsgType;
  content: string;
  archived: number;
  author: string | null;
}

export interface MessageFilter {
  ids?: number[];
  sessionIds?: string[];
  excludeSessionIds?: string[];
  types?: MsgType[];
  excludeTypes?: MsgType[];
  archived?: boolean;
  afterId?: number;
  beforeId?: number;
  throughId?: number;
}

export interface MessageListArgs extends MessageFilter {
  limit?: number;
  order?: "oldest" | "newest";
  orderBy?: "id" | "timestamp";
}

export type CreateMessageArgs = Omit<MessageRow, "id">;

export interface UpdateMessageArgs {
  id: number;
  changes: {
    type?: MsgType;
    archived?: boolean;
  };
}

export interface DeleteMessageArgs {
  ids?: number[];
  sessionIds?: string[];
}

export interface MessageStore extends Store<
  MessageRow,
  MessageListArgs,
  CreateMessageArgs,
  UpdateMessageArgs,
  DeleteMessageArgs,
  unknown
> {
  list(x: Context, args: MessageListArgs): MessageRow[];
  count(x: Context, args: MessageFilter): number;
  create(x: Context, args: CreateMessageArgs): MessageRow;
  update(x: Context, args: UpdateMessageArgs): MessageRow;
  delete(x: Context, args: DeleteMessageArgs): number;
  cmd(x: Context, command: unknown): unknown;
}
