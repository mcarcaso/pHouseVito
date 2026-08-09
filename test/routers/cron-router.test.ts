import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import express from "express";
import { z } from "zod";
import type { Context } from "../../src/context/Context.js";
import { dashboardRouterContext } from "../support/dashboard-router-context.js";
import { RootContext } from "../../src/context/RootContext.js";
import type { CronJobConfig } from "../../src/shared/contracts/vito-config.js";
import { createDatabase } from "../../src/db/schema.js";
import { xSessionStore, xVitoService } from "../../src/lib/x.js";
import { CronRouterService } from "../../src/routers/CronRouterService.js";
import type { CronHealth, CronService, StartCronArgs } from "../../src/services/cron/CronService.js";

class FakeCronService implements CronService {
  private jobs = new Map<string, CronJobConfig>();
  readonly scheduled: string[] = [];
  readonly removed: string[] = [];
  readonly triggered: string[] = [];

  start(x: Context, args: StartCronArgs): void {
    this.reload(x, args.jobs);
  }

  stop(_x: Context): void {
    this.jobs.clear();
  }

  reload(_x: Context, jobs: CronJobConfig[]): void {
    this.jobs = new Map(jobs.map((job) => [job.name, job]));
  }

  scheduleJob(_x: Context, job: CronJobConfig): void {
    this.jobs.set(job.name, job);
    this.scheduled.push(job.name);
  }

  removeJob(_x: Context, name: string): boolean {
    this.removed.push(name);
    return this.jobs.delete(name);
  }

  async triggerJob(_x: Context, name: string): Promise<boolean> {
    if (!this.jobs.has(name)) return false;
    this.triggered.push(name);
    return true;
  }

  checkHealth(_x: Context): CronHealth[] {
    return [...this.jobs.keys()].map((name) => ({
      name,
      isActive: true,
      nextRun: new Date("2030-01-01T09:00:00.000Z"),
    }));
  }
}

const userDir = mkdtempSync(join(tmpdir(), "vito-cron-router-"));
writeFileSync(
  join(userDir, "vito.config.json"),
  readFileSync(join(process.cwd(), "user.example", "vito.config.json"), "utf-8")
);
writeFileSync(join(userDir, "SOUL.md"), "test soul\n");

const db = createDatabase(":memory:");
const rootX = RootContext({ db, userDir, skillsDir: join(userDir, "skills") });
xSessionStore(rootX).create(rootX, {
  id: "dashboard:test",
  channel: "dashboard",
  channel_target: "test",
  created_at: 1,
  last_active_at: 1,
  config: "{}",
  alias: null,
});

const cronService = new FakeCronService();
const x = dashboardRouterContext({
  cronService: () => cronService,
}, rootX);
const app = express();
app.use(express.json());
app.use("/api/cron", await new CronRouterService().createRouter(x));

const errorResponseSchema = z.object({ error: z.string() }).passthrough();
const jobResponseSchema = z.object({
  name: z.string(),
  schedule: z.string(),
  session: z.string(),
  prompt: z.string(),
  sendCondition: z.string().optional(),
}).passthrough();
const jobsResponseSchema = z.array(jobResponseSchema.extend({
  nextRun: z.string().nullable(),
  isActive: z.boolean(),
}));
const healthResponseSchema = z.object({
  summary: z.object({ total: z.number(), active: z.number() }),
  jobs: z.array(z.unknown()),
});

let server: Server;
let baseUrl: string;

before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test server address");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  db.close();
  rmSync(userDir, { recursive: true, force: true });
});

describe("cron router", () => {
  it("rejects invalid inputs, schedules, and sessions without mutating config", async () => {
    const invalidSchedule = await fetch(`${baseUrl}/api/cron/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "invalid",
        schedule: "not a schedule",
        session: "dashboard:test",
        prompt: "test",
      }),
    });
    assert.equal(invalidSchedule.status, 400);
    assert.equal(errorResponseSchema.parse(await invalidSchedule.json()).error, "Invalid request");

    const invalidSession = await fetch(`${baseUrl}/api/cron/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "missing-session",
        schedule: "0 9 * * *",
        session: "dashboard:missing",
        prompt: "test",
      }),
    });
    assert.equal(invalidSession.status, 400);
    assert.equal(xVitoService(x).getConfiguredJobs(x).length, 0);
  });

  it("creates, lists, and rejects duplicate jobs", async () => {
    const job = {
      name: "morning",
      schedule: "0 9 * * *",
      timezone: "America/Toronto",
      session: "dashboard:test",
      prompt: "Good morning",
      sendCondition: "",
    };
    const createResponse = await fetch(`${baseUrl}/api/cron/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(job),
    });
    assert.equal(createResponse.status, 200);
    const created = jobResponseSchema.parse(await createResponse.json());
    assert.equal(created.name, "morning");
    assert.equal(created.sendCondition, undefined);
    assert.deepEqual(cronService.scheduled, ["morning"]);

    const duplicateResponse = await fetch(`${baseUrl}/api/cron/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(job),
    });
    assert.equal(duplicateResponse.status, 400);

    const listResponse = await fetch(`${baseUrl}/api/cron/jobs`);
    const jobs = jobsResponseSchema.parse(await listResponse.json());
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]?.isActive, true);
    assert.equal(jobs[0]?.nextRun, "2030-01-01T09:00:00.000Z");
  });

  it("updates jobs while preserving names and clearing conditions", async () => {
    const response = await fetch(`${baseUrl}/api/cron/jobs/morning`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "Updated prompt", sendCondition: null }),
    });
    assert.equal(response.status, 200);
    const updated = jobResponseSchema.parse(await response.json());
    assert.equal(updated.name, "morning");
    assert.equal(updated.prompt, "Updated prompt");
    assert.equal(updated.sendCondition, undefined);
    assert.equal(cronService.removed.includes("morning"), true);
    assert.equal(cronService.scheduled.filter((name) => name === "morning").length, 2);

    const renameResponse = await fetch(`${baseUrl}/api/cron/jobs/morning`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "renamed" }),
    });
    assert.equal(renameResponse.status, 400);
  });

  it("reports health, triggers, and deletes jobs", async () => {
    const healthResponse = await fetch(`${baseUrl}/api/cron/health`);
    const health = healthResponseSchema.parse(await healthResponse.json());
    assert.deepEqual(health.summary, { total: 1, active: 1 });

    const triggerResponse = await fetch(`${baseUrl}/api/cron/jobs/morning/trigger`, {
      method: "POST",
    });
    assert.equal(triggerResponse.status, 200);
    assert.deepEqual(cronService.triggered, ["morning"]);

    const deleteResponse = await fetch(`${baseUrl}/api/cron/jobs/morning`, {
      method: "DELETE",
    });
    assert.equal(deleteResponse.status, 200);
    assert.equal(xVitoService(x).getConfiguredJobs(x).length, 0);

    const missingTrigger = await fetch(`${baseUrl}/api/cron/jobs/morning/trigger`, {
      method: "POST",
    });
    assert.equal(missingTrigger.status, 404);
  });
});
