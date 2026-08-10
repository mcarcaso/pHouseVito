import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Context } from "../../src/context/Context.js";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import { DefaultSessionService } from "../../src/services/sessions/DefaultSessionService.js";
import type {
  DeleteSessionArgs,
  SessionListArgs,
  SessionRow,
  SessionStore,
  UpdateSessionArgs,
} from "../../src/stores/sessions/SessionStore.js";

class MemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, SessionRow>();

  list(_x: Context, args: SessionListArgs): SessionRow[] {
    return [...this.sessions.values()].filter((session) => !args.ids || args.ids.includes(session.id));
  }

  count(): number {
    return this.sessions.size;
  }

  create(_x: Context, session: SessionRow): SessionRow {
    this.sessions.set(session.id, session);
    return session;
  }

  update(_x: Context, args: UpdateSessionArgs): SessionRow {
    const current = this.sessions.get(args.id);
    if (!current) throw new Error("Missing session");
    const updated = { ...current, ...args.changes };
    this.sessions.set(args.id, updated);
    return updated;
  }

  delete(_x: Context, _args: DeleteSessionArgs): number {
    return 0;
  }
}

describe("DefaultSessionService", () => {
  it("creates and refreshes sessions through SessionStore", () => {
    const store = new MemorySessionStore();
    const x = new ObjectContext({ sessionStore: () => store });
    const service = new DefaultSessionService();

    const created = service.resolve(x, "telegram:chat:topic");
    const refreshed = service.resolve(x, created.id);

    assert.equal(created.channel, "telegram");
    assert.equal(created.channel_target, "chat:topic");
    assert.equal(store.count(), 1);
    assert.ok(refreshed.last_active_at >= created.last_active_at);
  });
});
