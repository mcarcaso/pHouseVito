import type { Context } from "../../context/Context.js";
import { xSessionStore } from "../../lib/x.js";
import type { SessionRow } from "../../stores/sessions/SessionStore.js";
import type { SessionService } from "./SessionService.js";

export class DefaultSessionService implements SessionService {
  resolve(x: Context, sessionKey: string): SessionRow {
    const store = xSessionStore(x);
    const existing = store.list(x, { ids: [sessionKey], limit: 1 })[0];
    if (existing) {
      return store.update(x, {
        id: sessionKey,
        changes: { last_active_at: Date.now() },
      });
    }

    const colonIndex = sessionKey.indexOf(":");
    const channel = colonIndex > 0 ? sessionKey.slice(0, colonIndex) : sessionKey;
    const target = colonIndex > 0 ? sessionKey.slice(colonIndex + 1) : "";
    const now = Date.now();
    return store.create(x, {
      id: sessionKey,
      channel,
      channel_target: target,
      created_at: now,
      last_active_at: now,
      config: "{}",
      alias: null,
    });
  }
}
