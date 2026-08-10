import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import { CronerCronService } from "../../src/services/cron/CronerCronService.js";
import type { InboundEvent } from "../../src/lib/types/inbound-event.js";

describe("CronerCronService", () => {
  it("owns scheduler lifecycle and dispatches jobs through its configured sink", async () => {
    const x = new ObjectContext({});
    const events: Array<{ event: InboundEvent; channel: string | null }> = [];
    const service = new CronerCronService();

    service.start(x, {
      timezone: "UTC",
      jobs: [{
        name: "daily-check",
        schedule: "0 0 * * *",
        session: "telegram:123",
        prompt: "Check status",
        sendCondition: "status changed",
      }],
      onJob: async (event, channel) => {
        events.push({ event, channel });
      },
    });

    try {
      assert.equal(service.checkHealth(x).length, 1);
      assert.equal(await service.triggerJob(x, "daily-check"), true);
      assert.equal(events.length, 1);
      assert.equal(events[0]?.channel, "telegram");
      assert.equal(events[0]?.event.sessionKey, "telegram:123");
      assert.match(events[0]?.event.content ?? "", /status changed/);
    } finally {
      service.stop(x);
    }

    assert.deepEqual(service.checkHealth(x), []);
  });
});
