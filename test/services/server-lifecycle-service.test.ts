import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import { DefaultServerLifecycleService } from "../../src/services/server/DefaultServerLifecycleService.js";

const memoryUsage: NodeJS.MemoryUsage = {
  rss: 1,
  heapTotal: 2,
  heapUsed: 3,
  external: 4,
  arrayBuffers: 5,
};

function waitForBackgroundWork(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("DefaultServerLifecycleService", () => {
  it("reports live activity counts without exposing conversation details", () => {
    let runs: { status: "active" | "queued" }[] = [{ status: "active" }, { status: "queued" }];
    const service = new DefaultServerLifecycleService({ getRuns: () => runs });
    assert.deepEqual(service.getHealth(new ObjectContext({})).runs, { active: 1, queued: 1 });
    runs = [];
    assert.deepEqual(service.getHealth(new ObjectContext({})).runs, { active: 0, queued: 0 });
  });

  it("keeps the source revision of the running process across later environment changes", () => {
    const previous = process.env.VITO_SOURCE_REVISION;
    try {
      process.env.VITO_SOURCE_REVISION = "a".repeat(40);
      const service = new DefaultServerLifecycleService();
      process.env.VITO_SOURCE_REVISION = "b".repeat(40);
      assert.equal(service.getHealth(new ObjectContext({})).revision, "a".repeat(40));
      process.env.VITO_SOURCE_REVISION = "not-a-revision";
      assert.equal(
        new DefaultServerLifecycleService().getHealth(new ObjectContext({})).revision,
        undefined,
      );
    } finally {
      if (previous === undefined) delete process.env.VITO_SOURCE_REVISION;
      else process.env.VITO_SOURCE_REVISION = previous;
    }
  });

  it("reports deterministic health and runtime status", () => {
    const x = new ObjectContext({});
    let cpuSample = 0;
    const service = new DefaultServerLifecycleService({
      now: () => new Date("2026-01-02T03:04:05.000Z"),
      runtime: {
        uptime: () => 123,
        pid: 456,
        version: "v22.test",
        memoryUsage: () => memoryUsage,
      },
      system: {
        cpus: () => {
          const sample = cpuSample++;
          return [
            {
              model: "test",
              speed: 1,
              times: { user: 100 + sample * 90, nice: 0, sys: 0, idle: 100 + sample * 10, irq: 0 },
            },
          ];
        },
        totalmem: () => 1_000,
        freemem: () => 400,
      },
    });

    assert.deepEqual(service.getHealth(x), {
      status: "ok",
      timestamp: "2026-01-02T03:04:05.000Z",
    });
    assert.deepEqual(service.getStatus(x), {
      uptime: 123,
      pid: 456,
      nodeVersion: "v22.test",
      memoryUsage,
      system: {
        cpuUsage: 90,
        memoryTotal: 1_000,
        memoryUsed: 600,
        memoryFree: 400,
      },
    });
  });

  it("schedules the complete rebuild and restart workflow", async () => {
    const x = new ObjectContext({});
    const commands: Array<{ file: string; args: string[]; timeout?: number }> = [];
    let scheduled: (() => void) | undefined;
    let delay: number | undefined;
    const service = new DefaultServerLifecycleService({
      schedule: (callback, delayMs) => {
        scheduled = callback;
        delay = delayMs;
      },
      runCommand: async (command) => {
        commands.push(command);
      },
    });

    service.requestRestart(x, { clientIp: "127.0.0.1", userAgent: "test" });
    assert.equal(delay, 500);
    assert.deepEqual(commands, []);
    assert.ok(scheduled);
    scheduled();
    await waitForBackgroundWork();

    assert.deepEqual(commands, [{ file: "./scripts/restart-vito.sh", args: [], timeout: 900_000 }]);
  });

  it("leaves the current process running when the rebuild workflow fails", async () => {
    const x = new ObjectContext({});
    const commands: string[] = [];
    let scheduled: (() => void) | undefined;
    const service = new DefaultServerLifecycleService({
      schedule: (callback) => {
        scheduled = callback;
      },
      runCommand: async (command) => {
        commands.push(command.file);
        throw new Error("build failed");
      },
    });

    service.requestRestart(x, { userAgent: "test" });
    assert.ok(scheduled);
    scheduled();
    await waitForBackgroundWork();
    assert.deepEqual(commands, ["./scripts/restart-vito.sh"]);
  });
});
