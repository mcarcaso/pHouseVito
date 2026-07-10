import type { Context } from "../../context/Context.js";
import type { MessageRow, MsgType } from "../../types.js";

export interface RecentMessagesArgs {
  sessionId: string;
  limit: number;
  includeTools?: boolean;
  includeThoughts?: boolean;
  includeArchived?: boolean;
}

export interface RecentTurnsArgs extends RecentMessagesArgs {
  turnLimit: number;
}

export interface RecentTurnsAfterIdArgs extends RecentTurnsArgs {
  afterId?: number;
  keepRecentEmbeddedMessages?: number;
}

export interface SessionMessagesArgs {
  sessionId: string;
  limit?: number;
  beforeId?: number;
  hideThoughts?: boolean;
  hideTools?: boolean;
  afterId?: number;
}

export interface CrossSessionMessagesArgs {
  excludeSessionId: string;
  limit: number;
  includeTools?: boolean;
  showArchived?: boolean;
}

export interface CrossSessionMessagesPerSessionArgs {
  excludeSessionId: string;
  perSessionLimit: number;
  includeTools?: boolean;
  includeThoughts?: boolean;
  includeArchived?: boolean;
  maxSessions?: number;
}

export interface MessageStore {
  create(x: Context, args: Omit<MessageRow, "id">): number;
  updateType(x: Context, args: { id: number; type: MsgType }): void;
  listRecent(x: Context, args: RecentMessagesArgs): MessageRow[];
  listRecentTurns(x: Context, args: RecentTurnsArgs): MessageRow[];
  listRecentTurnsAfterId(x: Context, args: RecentTurnsAfterIdArgs): MessageRow[];
  countThroughId(x: Context, args: RecentMessagesArgs & { throughId: number }): number;
  listForSession(x: Context, args: SessionMessagesArgs): MessageRow[];
  deleteForSession(x: Context, args: { sessionId: string }): number;
  countForSession(x: Context, args: { sessionId: string; hideThoughts?: boolean; hideTools?: boolean }): number;
  listCrossSession(x: Context, args: CrossSessionMessagesArgs): MessageRow[];
  listCrossSessionPerSession(x: Context, args: CrossSessionMessagesPerSessionArgs): MessageRow[];
  archiveSession(x: Context, args: { sessionId: string }): void;
  getLastAssistantMessage(x: Context, args: { sessionId: string }): string | null;
  getLastNMessages(x: Context, args: { sessionId: string; limit: number }): Array<{ type: string; content: string }>;
}
