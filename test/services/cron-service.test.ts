import { localJobTime } from "../../src/shared/job-time.js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import { createDatabase } from "../../src/lib/sqlite/database.js";
import { CronerCronService } from "../../src/services/cron/CronerCronService.js";
import type { Client } from "discord.js";
import { DiscordOutputHandler } from "../../src/services/channels/discord/DiscordOutputHandler.js";
import { SqliteDiscordQueueStore } from "../../src/stores/discord/SqliteDiscordQueueStore.js";
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

  it("pins previously local script schedules to Toronto despite global timezone changes", () => {
    const db = createDatabase(":memory:");
    const x = new ObjectContext({ db: () => db, jobService: () => ({ recover: () => {} }) });
    const service = new CronerCronService();
    const inherited = {
      name: "inherited",
      script: "/tmp/inherited.ts",
      schedule: { cron: "0 7 * * *" },
      timeoutMs: 60_000,
      enabled: true,
    } as const;
    const explicit = {
      ...inherited,
      name: "explicit",
      schedule: { cron: "0 7 * * *", timezone: "UTC" },
    } as const;
    service.start(x, {
      jobs: [inherited, explicit],
      timezone: "Europe/Zagreb",
      onJob: async () => {},
    });
    const before = db
      .prepare("SELECT next_at FROM job_schedule_state WHERE name = ?")
      .get("inherited") as { next_at: string };
    service.reload(x, [inherited, explicit], "America/Toronto");
    const after = db
      .prepare("SELECT next_at, config FROM job_schedule_state WHERE name = ?")
      .get("inherited") as { next_at: string; config: string };
    assert.equal(after.next_at, before.next_at);
    assert.equal(JSON.parse(after.config).timezone, "America/Toronto");
    const explicitState = db
      .prepare("SELECT config FROM job_schedule_state WHERE name = ?")
      .get("explicit") as { config: string };
    assert.equal(JSON.parse(explicitState.config).timezone, "UTC");
    service.stop(x);
    db.close();
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
      JSON.stringify({ schedule: job.schedule, timezone: "UTC" }),
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

it("distinct cron jobs in the same millisecond have separate durable Discord deliveries", async (t) => {
  const instant = Date.now();
  t.mock.method(Date, "now", () => instant);
  const db = createDatabase(":memory:");
  const store = new SqliteDiscordQueueStore();
  const x = new ObjectContext({
    db: () => db,
    discordQueueStore: () => store,
    jobService: () => ({ recover: () => {} }),
  });
  const sent: Array<Record<string, unknown>> = [];
  const client = {
    channels: {
      fetch: async () => ({
        id: "channel-1",
        send: async (message: Record<string, unknown>) => {
          sent.push(message);
          return {};
        },
      }),
    },
  } as unknown as Client;
  const service = new CronerCronService();
  service.start(x, {
    timezone: "UTC",
    jobs: ["first", "second"].map((name) => ({
      name,
      schedule: "0 0 * * *",
      session: "discord:channel-1",
      prompt: name,
    })),
    onJob: async (event) => {
      const handler = new DiscordOutputHandler(x, client, event);
      await handler.relay(event.content);
      await handler.endMessage();
      await handler.stopTyping();
    },
  });
  try {
    await service.triggerJob(x, "first");
    await service.triggerJob(x, "second");
    await service.triggerJob(x, "first");
    assert.equal(sent.length, 3);
    assert.equal(new Set(sent.map((message) => message.nonce)).size, 3);
    assert.equal(
      db
        .prepare("SELECT COUNT(*) FROM discord_deliveries WHERE status = 'completed'")
        .pluck()
        .get(),
      3,
    );
  } finally {
    service.stop(x);
    db.close();
  }
});

it("dispatches overdue work after a blocked event loop without losing its timer", async () => {
  const db = createDatabase(":memory:");
  let calls = 0;
  const job = {
    name: "late",
    script: "/tmp/fake.ts",
    schedule: { at: localJobTime(new Date(Date.now() - 1000).toISOString(), "America/Toronto") },
    enabled: true,
    timeoutMs: 1000,
  };
  const x = new ObjectContext({
    db: () => db,
    jobService: () => ({
      recover() {},
      async execute() {
        calls++;
      },
    }),
  });
  const service = new CronerCronService();
  try {
    service.start(x, { jobs: [job], timezone: "UTC", onJob: async () => {} });
    const until = Date.now() + 50;
    while (Date.now() < until) {
      /* Simulate event-loop delay, no real jobs. */
    }
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(calls, 1);
    assert.equal(service.checkHealth(x)[0]?.isActive, false);
  } finally {
    service.stop(x);
    db.close();
  }
});

it("does not let an old running generation delete a timezone replacement", async () => {
  const db = createDatabase(":memory:");
  let finish!: () => void;
  const blocked = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const job = {
    name: "reload-running",
    script: "/tmp/fake.ts",
    schedule: { cron: "0 7 * * *" },
    enabled: true,
    timeoutMs: 1000,
  };
  db.prepare("INSERT INTO job_schedule_state(name, config, next_at) VALUES (?, ?, ?)").run(
    job.name,
    JSON.stringify({ schedule: job.schedule, timezone: "UTC" }),
    "2026-01-01T07:00:00.000Z",
  );
  const x = new ObjectContext({
    db: () => db,
    jobService: () => ({
      recover() {},
      async execute() {
        await blocked;
      },
    }),
  });
  const service = new CronerCronService();
  try {
    service.start(x, { jobs: [job], timezone: "UTC", onJob: async () => {} });
    await new Promise((resolve) => setTimeout(resolve, 30));
    service.reload(
      x,
      [{ ...job, schedule: { cron: "0 7 * * *", timezone: "America/Toronto" } }],
      "America/Toronto",
    );
    const replacement = service.checkHealth(x)[0]?.nextRun?.toISOString();
    finish();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(service.checkHealth(x)[0]?.isActive, true);
    assert.equal(service.checkHealth(x)[0]?.nextRun?.toISOString(), replacement);
  } finally {
    finish();
    service.stop(x);
    db.close();
  }
});
