import type { Context } from "../context/Context.js";
import { xSessionStore } from "../lib/x.js";
import type { SessionRow } from "../types.js";

export class SessionManager {
  constructor(private x: Context) {}

  /** 
   * Resolve or create a session by key.
   * The channel owns the session key format — orchestrator treats it as opaque.
   * Channel and target are extracted from the key for DB metadata (split on first colon).
   */
  resolveSession(sessionKey: string): SessionRow {
    const store = xSessionStore(this.x);
    const existing = store.get(this.x, sessionKey);
    if (existing) {
      store.touch(this.x, { id: sessionKey, timestamp: Date.now() });
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
    store.upsert(this.x, { session });
    return session;
  }

  /** Get a session by ID */
  getSession(id: string): SessionRow | undefined {
    return xSessionStore(this.x).get(this.x, id);
  }

  /** List all sessions */
  listSessions(): SessionRow[] {
    return xSessionStore(this.x).list(this.x);
  }
}
