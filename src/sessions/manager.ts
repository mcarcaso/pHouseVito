import { createHash } from "crypto";
import type { Queries } from "../db/queries.js";
import type { SessionRow } from "../types.js";

export class SessionManager {
  constructor(private queries: Queries) {}

  /** Resolve or create a session for a channel + target combo */
  resolveSession(channel: string, target: string): SessionRow {
    const id = this.makeSessionId(channel, target);
    const existing = this.queries.getSession(id);
    if (existing) {
      this.queries.touchSession(id, Date.now());
      return { ...existing, last_active_at: Date.now() };
    }

    const now = Date.now();
    const session: SessionRow = {
      id,
      channel,
      channel_target: target,
      created_at: now,
      last_active_at: now,
      config: "{}",
    };
    this.queries.upsertSession(session);
    return session;
  }

  /** Get a session by ID */
  getSession(id: string): SessionRow | undefined {
    return this.queries.getSession(id);
  }

  /** List all sessions */
  listSessions(): SessionRow[] {
    return this.queries.getAllSessions();
  }

  /** Generate deterministic session ID from channel + target */
  makeSessionId(channel: string, target: string): string {
    return `${channel}:${target}`;
  }
}
