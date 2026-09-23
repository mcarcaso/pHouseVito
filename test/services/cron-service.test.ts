import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import { createDatabase } from "../../src/lib/sqlite/database.js";
import { CronerCronService } from "../../src/services/cron/CronerCronService.js";
import type { InboundEvent } from "../../src/lib/types/inbound-event.js";

describe("CronerCronService", () => {
  it("owns scheduler lifecycle and dispatches jobs through its configured sink", async () => {
    const x = new ObjectContext({ jobService: () => ({ recover: () => {} }) });
    const events: Array<{ event: InboundEvent; channel: string | null }> = [];
    const service = new CronerCronService();

    service.start(x, {
      timezone: "UTC",
      jobs: [
        {
          name: "daily-check",
          schedule: "0 0 * * *",
          session: "telegram:123",
          prompt: "Check status",
          sendCondition: "status changed",
        },
      ],
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

  it("catches up one missed script occurrence without replaying it", async () => {
    const db = createDatabase(":memory:");
    const executions: string[] = [];
    const job = {
      name: "durable-check",
      script: "/tmp/durable-check.ts",
      schedule: { cron: "0 9 * * *", timezone: "UTC" },
      timeoutMs: 60_000,
      enabled: true,
    } as const;
    db.prepare("INSERT INTO job_schedule_state(name, config, next_at) VALUES (?, ?, ?)").run(
      job.name,
      JSON.stringify(job.schedule),
      "2026-01-01T09:00:00.000Z",
    );
    const x = new ObjectContext({
      db: () => db,
      jobService: () => ({
        recover: () => {},
        execute: async (_x: unknown, _job: unknown, scheduledAt: string) => {
          executions.push(scheduledAt);
          return undefined;
        },
      }),
    });
    const service = new CronerCronService();
    service.start(x, { jobs: [job], timezone: "UTC", onJob: async () => {} });
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.deepEqual(executions, ["2026-01-01T09:00:00.000Z"]);
    service.stop(x);

    service.start(x, { jobs: [job], timezone: "UTC", onJob: async () => {} });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(executions.length, 1);
    service.stop(x);
    db.close();
  });
});
