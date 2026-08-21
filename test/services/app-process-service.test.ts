import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import { Pm2AppProcessService } from "../../src/services/apps/Pm2AppProcessService.js";

const x = new ObjectContext({});

describe("Pm2AppProcessService", () => {
  it("validates and maps PM2 process output", async () => {
    const service = new Pm2AppProcessService(async () => ({
      stdout: JSON.stringify([
        {
          name: "app-alpha",
          pm2_env: { status: "online", pm_uptime: Date.now() - 1000, restart_time: 2 },
          monit: { memory: 123 },
        },
        { name: "vito-server", pm2_env: { status: "online" } },
      ]),
    }));
    const statuses = await service.list(x, ["alpha"]);
    assert.equal(statuses.length, 1);
    assert.equal(statuses[0].name, "alpha");
    assert.equal(statuses[0].status, "online");
    assert.equal(statuses[0].restarts, 2);
    assert.equal(statuses[0].memory, 123);
    assert.ok(statuses[0].uptime !== null && statuses[0].uptime >= 1000);
  });

  it("uses structured PM2 arguments and rejects invalid app names", async () => {
    const calls: string[][] = [];
    const service = new Pm2AppProcessService(async (_file, args) => {
      calls.push(args);
      return { stdout: "" };
    });
    await service.execute(x, { action: "restart", appName: "alpha" });
    assert.deepEqual(calls, [["pm2", "restart", "app-alpha"]]);
    await assert.rejects(() =>
      service.execute(x, {
        action: "delete",
        appName: "../bad",
      }),
    );
  });

  it("returns no statuses when PM2 is unavailable or malformed", async () => {
    const unavailable = new Pm2AppProcessService(async () => {
      throw new Error("unavailable");
    });
    assert.deepEqual(await unavailable.list(x), []);

    const malformed = new Pm2AppProcessService(async () => ({ stdout: "not-json" }));
    assert.deepEqual(await malformed.list(x), []);
  });
});
