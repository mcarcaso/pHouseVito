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
  it("reports deterministic health and runtime status", () => {
    const x = new ObjectContext({});
    const service = new DefaultServerLifecycleService({
      now: () => new Date("2026-01-02T03:04:05.000Z"),
      runtime: {
        uptime: () => 123,
        pid: 456,
        version: "v22.test",
        memoryUsage: () => memoryUsage,
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

    assert.deepEqual(commands, [{ file: "./scripts/restart-vito.sh", args: [], timeout: 300_000 }]);
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
