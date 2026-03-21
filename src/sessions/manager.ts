import type { Queries } from "../db/queries.js";
import type { SessionRow } from "../types.js";

export class SessionManager {
  constructor(private queries: Queries) {}

  /** 
   * Resolve or create a session by key.
   * The channel owns the session key format — orchestrator treats it as opaque.
   * Channel and target are extracted from the key for DB metadata (split on first colon).
   */
  resolveSession(sessionKey: string): SessionRow {
    const existing = this.queries.getSession(sessionKey);
    if (existing) {
      this.queries.touchSession(sessionKey, Date.now());
      return { ...existing, last_active_at: Date.now() };
    }

    // Extract channel and target from key for DB metadata
    // Format: "channel:target" or "channel:target:subkey"
    const colonIdx = sessionKey.indexOf(":");
    const channel = colonIdx > 0 ? sessionKey.slice(0, colonIdx) : sessionKey;
    const target = colonIdx > 0 ? sessionKey.slice(colonIdx + 1) : "";

    const now = Date.now();
    const session: SessionRow = {
      id: sessionKey,
      channel,
      channel_target: target,
      created_at: now,
      last_active_at: now,
      config: "{}",
      alias: null,
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
}
