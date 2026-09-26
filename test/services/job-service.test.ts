import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import { createDatabase } from "../../src/lib/sqlite/database.js";
import { DefaultJobService } from "../../src/services/jobs/DefaultJobService.js";
import type { ScriptJobConfig } from "../../src/shared/schemas/vito-config.js";
import { SqliteJobRunStore } from "../../src/stores/jobs/SqliteJobRunStore.js";

function createHarness(script: string) {
  const root = mkdtempSync(join(tmpdir(), "vito-jobs-"));
  const scriptPath = join(root, "job.ts");
  writeFileSync(scriptPath, script);
  const db = createDatabase(join(root, "vito.db"));
  const store = new SqliteJobRunStore();
  const prompts: Array<{ session: string; message: string }> = [];
  const deliveries: string[] = [];
  const contexts: Array<{ session: string; content: string; key: string }> = [];
  const failures = { append: false, relay: false };
  const x = new ObjectContext({
    db: () => db,
    logsDir: () => join(root, "logs"),
    piAuthPath: () => join(root, "auth.json"),
    jobRunStore: () => store,
    orchestratorService: () => ({
      prompt: async (_x: unknown, input: { session: string; message: string }) => {
        prompts.push(input);
        return `answer-${prompts.length}`;
      },
      appendSessionContextAfterTurn: async (
        _x: unknown,
        session: string,
        content: string,
        details: { key: string },
      ) => {
        if (failures.append) throw new Error("Pi append failed");
        contexts.push({ session, content, key: details.key });
      },
    }),
    vitoService: () => ({
      getConfig: () => ({
        settings: { "pi-coding-agent": { model: { provider: "faux", name: "faux" } } },
      }),
    }),
    channelRegistryService: () => ({
      get: () => ({
        x: undefined,
        channel: {
          createOutputHandler: () => ({
            relay: async (text: string) => {
              if (failures.relay) throw new Error("Chat delivery failed");
              deliveries.push(text);
            },
            endMessage: async () => undefined,
          }),
        },
      }),
    }),
  });
  const service = new DefaultJobService();
  const job: ScriptJobConfig = {
    name: "test-job",
    script: scriptPath,
    schedule: { cron: "0 9 * * *" },
    timeoutMs: 5_000,
    enabled: true,
  };
  return { root, db, store, x, service, job, prompts, deliveries, contexts, failures };
}

function cleanup(root: string, db: ReturnType<typeof createDatabase>): void {
  db.close();
  rmSync(root, { recursive: true, force: true });
}

describe("DefaultJobService", () => {
  it("executes TypeScript scripts and persists durable outcomes", async () => {
    const harness = createHarness(`
      export default async function (job) {
        console.log("private job log");
        return { text: "completed " + job.name };
      }
    `);
    try {
      const run = await harness.service.execute(harness.x, harness.job, "2026-09-23T10:00:00.000Z");
      assert.equal(run?.state, "completed");
      assert.deepEqual(run?.result, { text: "completed test-job" });
      assert.equal(run?.delivery, "none");
      assert.equal(harness.service.runs(harness.x)[0]?.id, run?.id);
      assert.equal(
        await harness.service.execute(harness.x, harness.job, "2026-09-23T10:00:00.000Z"),
        undefined,
      );
    } finally {
      cleanup(harness.root, harness.db);
    }
  });

  it("keeps contextual prompts distinct from script delivery", async () => {
    const harness = createHarness(`
      export default async function (job) {
        const first = await job.prompt({ session: "dashboard:shared", message: "first" });
        const second = await job.prompt({ session: "dashboard:shared", message: "second" });
        return first.text + "," + second.text;
      }
    `);
    try {
      const run = await harness.service.execute(
        harness.x,
        { ...harness.job, session: "dashboard:shared" },
        new Date().toISOString(),
      );
      assert.equal(run?.result?.text, "answer-1,answer-2");
      assert.deepEqual(
        harness.prompts.map((prompt) => prompt.session),
        ["dashboard:shared", "dashboard:shared"],
      );
      assert.deepEqual(run?.promptSessions, ["dashboard:shared", "dashboard:shared"]);
      assert.equal(run?.delivery, "none");
    } finally {
      cleanup(harness.root, harness.db);
    }
  });

  it("mirrors all delivered chat jobs into their Pi session without starting a turn", async () => {
    const harness = createHarness(`export default async function () { return "CPU alert"; }`);
    try {
      const job = { ...harness.job, delivery: { channel: "discord", target: "room" } };
      const run = await harness.service.execute(harness.x, job, new Date().toISOString());
      assert.equal(run?.delivery, "delivered");
      assert.equal(run?.contextDelivery, "appended");
      assert.deepEqual(harness.deliveries, ["CPU alert"]);
      assert.equal(harness.contexts.length, 1);
      assert.equal(harness.contexts[0].session, "discord:room");
      assert.match(harness.contexts[0].content, /not a message from the user.*CPU alert/s);
      assert.equal(harness.contexts[0].key, `job-delivery:${run?.id}`);
      assert.deepEqual(harness.store.listPendingContext(harness.x), []);
    } finally {
      cleanup(harness.root, harness.db);
    }
  });

  it("recovers context after a successful delivery without posting again", async () => {
    const harness = createHarness(`export default async function () { return "CPU alert"; }`);
    try {
      harness.failures.append = true;
      const job = { ...harness.job, delivery: { channel: "telegram", target: "room" } };
      const run = await harness.service.execute(harness.x, job, new Date().toISOString());
      assert.equal(run?.delivery, "delivered");
      assert.equal(run?.contextDelivery, "pending");
      assert.equal(harness.store.listPendingContext(harness.x).length, 1);
      harness.failures.append = false;
      await harness.service.reconcileDeliveredContexts(harness.x);
      assert.equal(harness.store.read(harness.x, run!.id)?.contextDelivery, "appended");
      assert.equal(harness.contexts[0].session, "telegram:room");
      assert.deepEqual(harness.deliveries, ["CPU alert"]);
      await harness.service.reconcileDeliveredContexts(harness.x);
      assert.equal(harness.contexts.length, 1);
    } finally {
      cleanup(harness.root, harness.db);
    }
  });

  it("does not inject results when chat delivery fails", async () => {
    const harness = createHarness(`export default async function () { return "CPU alert"; }`);
    try {
      harness.failures.relay = true;
      const job = { ...harness.job, delivery: { channel: "discord", target: "room" } };
      const run = await harness.service.execute(harness.x, job, new Date().toISOString());
      assert.equal(run?.delivery, "failed");
      assert.deepEqual(harness.contexts, []);
      assert.deepEqual(harness.store.listPendingContext(harness.x), []);
    } finally {
      cleanup(harness.root, harness.db);
    }
  });

  it("prevents overlapping executions of one job", async () => {
    const harness = createHarness(`
      export default async function () {
        await new Promise((resolve) => setTimeout(resolve, 300));
        return "done";
      }
    `);
    try {
      const first = harness.service.execute(harness.x, harness.job, new Date().toISOString());
      await new Promise((resolve) => setTimeout(resolve, 100));
      const second = await harness.service.execute(
        harness.x,
        harness.job,
        new Date().toISOString(),
      );
      assert.equal(second, undefined);
      assert.equal((await first)?.state, "completed");
    } finally {
      cleanup(harness.root, harness.db);
    }
  });

  it("cancels timed-out scripts without replaying them", async () => {
    const harness = createHarness(`
      export default async function () {
        await new Promise((resolve) => setTimeout(resolve, 10_000));
        return "too late";
      }
    `);
    try {
      const run = await harness.service.execute(
        harness.x,
        { ...harness.job, timeoutMs: 150 },
        new Date().toISOString(),
      );
      assert.equal(run?.state, "failed");
      assert.match(run?.error ?? "", /timed out/);
      assert.equal(harness.service.runs(harness.x).length, 1);
    } finally {
      cleanup(harness.root, harness.db);
    }
  });

  it("cancels an active run and refuses to cancel a terminal run", async () => {
    const harness = createHarness(`
      export default async function () {
        await new Promise((resolve) => setTimeout(resolve, 10_000));
        return "too late";
      }
    `);
    try {
      const execution = harness.service.execute(harness.x, harness.job, new Date().toISOString());
      await new Promise((resolve) => setTimeout(resolve, 100));
      const id = harness.service.runs(harness.x)[0]?.id;
      assert.ok(id);
      assert.equal(harness.service.cancel(harness.x, id), true);
      const run = await execution;
      assert.equal(run?.state, "cancelled");
      assert.equal(harness.service.cancel(harness.x, id), false);
    } finally {
      cleanup(harness.root, harness.db);
    }
  });

  it("marks active and uncertain-delivery runs instead of replaying after restart", () => {
    const harness = createHarness(`export default async function () { return "unused"; }`);
    try {
      const run = harness.store.claim(
        harness.x,
        harness.job,
        new Date().toISOString(),
        new Date().toISOString(),
      );
      assert.ok(run);
      harness.service.recover(harness.x);
      assert.equal(harness.service.runs(harness.x)[0]?.state, "interrupted");

      const delivery = harness.store.claim(
        harness.x,
        harness.job,
        new Date().toISOString(),
        new Date().toISOString(),
      );
      assert.ok(delivery);
      delivery.state = "completed";
      delivery.delivery = "delivering";
      harness.store.save(harness.x, delivery);
      harness.service.recover(harness.x);
      const recovered = harness.store.read(harness.x, delivery.id);
      assert.equal(recovered?.state, "completed");
      assert.equal(recovered?.delivery, "unknown");
    } finally {
      cleanup(harness.root, harness.db);
    }
  });
});
