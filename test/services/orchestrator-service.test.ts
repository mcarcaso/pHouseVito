import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import { createDatabase } from "../../src/lib/sqlite/database.js";
import { PiOrchestratorService } from "../../src/services/orchestrator/PiOrchestratorService.js";
import { vitoConfigSchema } from "../../src/shared/schemas/vito-config.js";

const config = vitoConfigSchema.parse({
  settings: {},
  channels: {},
  cron: { jobs: [] },
});

describe("PiOrchestratorService", () => {
  it("initializes lazily from its method context and retains process state", () => {
    let configReads = 0;
    const x = new ObjectContext({
      userDir: () => "/tmp/vito-orchestrator-test",
      vitoService: () => ({
        getConfig: () => {
          configReads += 1;
          return config;
        },
      }),
      skillStore: () => ({ list: () => [] }),
    });
    const service = new PiOrchestratorService();

    assert.equal(configReads, 0);
    service.reloadConfig(x, config);
    service.reloadConfig(x, config);
    assert.equal(configReads, 1);
  });

  it("serializes one session across orchestrator instances and cancels queued turns", async () => {
    const db = createDatabase(":memory:");
    const context = () =>
      new ObjectContext({
        db: () => db,
        userDir: () => "/tmp/vito-orchestrator-lease-test",
        vitoService: () => ({ getConfig: () => config }),
        skillStore: () => ({ list: () => [] }),
      });
    const first = new PiOrchestratorService();
    const second = new PiOrchestratorService();
    first.reloadConfig(context(), config);
    second.reloadConfig(context(), config);
    const lease = (service: PiOrchestratorService) =>
      service as unknown as {
        withSessionLease(
          session: string,
          signal: AbortSignal | undefined,
          action: () => Promise<void>,
        ): Promise<void>;
      };
    const order: string[] = [];
    const holding = lease(first).withSessionLease("dashboard:shared", undefined, async () => {
      order.push("first-start");
      await new Promise((resolve) => setTimeout(resolve, 100));
      order.push("first-end");
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const following = lease(second).withSessionLease("dashboard:shared", undefined, async () => {
      order.push("second");
    });
    await Promise.all([holding, following]);
    assert.deepEqual(order, ["first-start", "first-end", "second"]);

    const controller = new AbortController();
    const heldAgain = lease(first).withSessionLease("dashboard:shared", undefined, async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    let unexpectedlyStarted = false;
    const cancelled = lease(second).withSessionLease(
      "dashboard:shared",
      controller.signal,
      async () => {
        unexpectedlyStarted = true;
      },
    );
    controller.abort();
    await Promise.all([heldAgain, cancelled]);
    assert.equal(unexpectedlyStarted, false);
    db.close();
  });
});
