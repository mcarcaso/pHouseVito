import type Database from "better-sqlite3";
import { ObjectContext } from "../context/ObjectContext.js";
import { xMessageStore, xSessionStore, xTraceStore } from "../lib/x.js";
import { SqliteMessageStore } from "../stores/messages/SqliteMessageStore.js";
import { SqliteSessionStore } from "../stores/sessions/SqliteSessionStore.js";
import { SqliteTraceStore } from "../stores/traces/SqliteTraceStore.js";
import type { MessageRow, SessionRow, TraceRow, MsgType } from "../types.js";

/**
 * Compatibility façade for legacy callers.
 *
 * New code should prefer the domain stores in src/stores/* with x-first method
 * signatures. This class keeps the existing dashboard/orchestrator surface
 * stable while the codebase moves one boundary at a time.
 */
export class Queries {
  private readonly x;

  constructor(db: Database.Database) {
    this.x = new ObjectContext({
      db: () => db,
      sessionStore: () => new SqliteSessionStore(),
      messageStore: () => new SqliteMessageStore(),
      traceStore: () => new SqliteTraceStore(),
    });
  }

  // ── Sessions ──

  getSession(id: string): SessionRow | undefined {
    return xSessionStore(this.x).get(this.x, id);
  }

  upsertSession(session: SessionRow): void {
    xSessionStore(this.x).upsert(this.x, { session });
  }

  getAllSessions(): SessionRow[] {
    return xSessionStore(this.x).list(this.x);
  }

  touchSession(id: string, timestamp: number): void {
    xSessionStore(this.x).touch(this.x, { id, timestamp });
  }

  updateSessionConfig(id: string, config: string): void {
    xSessionStore(this.x).updateConfig(this.x, { id, config });
  }

  updateSessionAlias(id: string, alias: string | null): void {
    xSessionStore(this.x).updateAlias(this.x, { id, alias });
  }

  /** Get a map of session ID → alias for all sessions that have aliases */
  getSessionAliases(): Record<string, string> {
    return xSessionStore(this.x).getAliases(this.x);
  }

  // ── Messages ──

  insertMessage(msg: Omit<MessageRow, "id">): number {
    return xMessageStore(this.x).create(this.x, msg);
  }

  /** Update message type (for marking assistant vs thought) */
  updateMessageType(id: number, type: MsgType): void {
    xMessageStore(this.x).updateType(this.x, { id, type });
  }

  /**
   * Get recent messages for the CURRENT session context.
   * Filtered by context settings (tools, thoughts, archived).
   */
  getRecentMessages(
    sessionId: string,
    limit: number,
    includeTools = true,
    includeThoughts = true,
    includeArchived = false
  ): MessageRow[] {
    return xMessageStore(this.x).listRecent(this.x, {
      sessionId,
      limit,
      includeTools,
      includeThoughts,
      includeArchived,
    });
  }

  /**
   * Get the last N "turns" (user/assistant messages) plus any thoughts and
   * tools that happened in between, optionally filtered.
   *
   * Returns rows in chronological order (oldest first).
   */
  getRecentTurns(
    sessionId: string,
    turnLimit: number,
    includeThoughts = true,
    includeTools = true,
    includeArchived = false
  ): MessageRow[] {
    return xMessageStore(this.x).listRecentTurns(this.x, {
      sessionId,
      limit: turnLimit,
      turnLimit,
      includeThoughts,
      includeTools,
      includeArchived,
    });
  }

  /**
   * Get recent turns after an embedded cutoff, optionally keeping a small tail
   * of recent embedded user/assistant turns.
   */
  getRecentTurnsAfterId(
    sessionId: string,
    turnLimit: number,
    includeThoughts = true,
    includeTools = true,
    includeArchived = false,
    afterId = 0,
    keepRecentEmbeddedMessages = 0
  ): MessageRow[] {
    return xMessageStore(this.x).listRecentTurnsAfterId(this.x, {
      sessionId,
      limit: turnLimit,
      turnLimit,
      includeThoughts,
      includeTools,
      includeArchived,
      afterId,
      keepRecentEmbeddedMessages,
    });
  }

  countMessagesThroughId(
    sessionId: string,
    throughId: number,
    includeThoughts = true,
    includeTools = true,
    includeArchived = false
  ): number {
    return xMessageStore(this.x).countThroughId(this.x, {
      sessionId,
      limit: 0,
      throughId,
      includeThoughts,
      includeTools,
      includeArchived,
    });
  }

  /** Get all messages for a session (including archived) for dashboard */
  getAllMessagesForSession(
    sessionId: string,
    limit?: number,
    beforeId?: number,
    hideThoughts?: boolean,
    hideTools?: boolean,
    afterId?: number
  ): MessageRow[] {
    return xMessageStore(this.x).listForSession(this.x, {
      sessionId,
      limit,
      beforeId,
      hideThoughts,
      hideTools,
      afterId,
    });
  }

  /** Delete all messages for a session (dashboard clear chat) */
  deleteMessagesForSession(sessionId: string): number {
    return xMessageStore(this.x).deleteForSession(this.x, { sessionId });
  }

  /** Count total messages for a session */
  countMessagesForSession(sessionId: string, hideThoughts?: boolean, hideTools?: boolean): number {
    return xMessageStore(this.x).countForSession(this.x, { sessionId, hideThoughts, hideTools });
  }

  /**
   * Get recent messages from OTHER sessions for cross-session context.
   * Optionally includes archived messages (configurable).
   */
  getCrossSessionMessages(
    excludeSessionId: string,
    limit: number,
    includeTools = false,
    showArchived = false
  ): MessageRow[] {
    return xMessageStore(this.x).listCrossSession(this.x, {
      excludeSessionId,
      limit,
      includeTools,
      showArchived,
    });
  }

  /**
   * Get last N messages per OTHER session for cross-session context.
   * Filtered by context settings (tools, thoughts, archived).
   * @param maxSessions - Max number of sessions to include (0 = unlimited)
   */
  getCrossSessionMessagesPerSession(
    excludeSessionId: string,
    perSessionLimit: number,
    includeTools = false,
    includeThoughts = false,
    includeArchived = false,
    maxSessions = 0
  ): MessageRow[] {
    return xMessageStore(this.x).listCrossSessionPerSession(this.x, {
      excludeSessionId,
      perSessionLimit,
      includeTools,
      includeThoughts,
      includeArchived,
      maxSessions,
    });
  }

  /** Mark all messages in a session as archived */
  markSessionArchived(sessionId: string): void {
    xMessageStore(this.x).archiveSession(this.x, { sessionId });
  }

  /** Get the last assistant message for a session (for profile update context) */
  getLastAssistantMessage(sessionId: string): string | null {
    return xMessageStore(this.x).getLastAssistantMessage(this.x, { sessionId });
  }

  /**
   * Get the last N user/assistant messages for a session (for profile update context).
   * Returns messages in chronological order (oldest first).
   * Only includes user and assistant types — excludes thoughts/tools.
   */
  getLastNMessages(sessionId: string, limit: number): Array<{ type: string; content: string }> {
    return xMessageStore(this.x).getLastNMessages(this.x, { sessionId, limit });
  }

  // ── Traces ──

  insertTrace(trace: Omit<TraceRow, "id">): void {
    xTraceStore(this.x).create(this.x, trace);
  }

  getRecentTraces(limit: number = 50): Omit<TraceRow, "system_prompt">[] {
    return xTraceStore(this.x).listRecent(this.x, { limit });
  }

  getTrace(id: number): TraceRow | undefined {
    return xTraceStore(this.x).get(this.x, id);
  }
}
