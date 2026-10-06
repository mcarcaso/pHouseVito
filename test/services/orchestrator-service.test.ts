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

  for (const name of ["discord", "slack"]) {
    it(`allows only an explicitly authorized ${name} owner to restart`, async () => {
      let restarts = 0;
      const replies: string[] = [];
      const x = new ObjectContext({
        userDir: () => "/tmp/vito-orchestrator-owner-test",
        vitoService: () => ({ getConfig: () => config }),
        skillStore: () => ({ list: () => [] }),
        serverLifecycleService: () => ({ requestRestart: () => void (restarts += 1) }),
      });
      const channel = {
        name,
        capabilities: { typing: false, reactions: false, attachments: false, streaming: false },
        start: async () => {},
        stop: async () => {},
        listen: async () => () => {},
        createOutputHandler: () => ({
          relay: async (message: string) => void replies.push(message),
          endMessage: async () => {},
          stopTyping: async () => {},
        }),
      };
      const service = new PiOrchestratorService();
      const event = (authorized: boolean) => ({
        sessionKey: `${name}:one`,
        channel: name,
        target: "one",
        author: "Mike",
        timestamp: Date.now(),
        content: "/restart",
        raw: { commandAuthorized: authorized },
      });
      await service.handleInbound(x, event(false), channel);
      assert.equal(restarts, 0);
      assert.match(replies[0] ?? "", /Only the bot owner/);
      await service.handleInbound(x, event(true), channel);
      assert.equal(restarts, 1);
    });
  }

  it("injects accepted steering into the active Pi turn and persists it once", async () => {
    const created: unknown[] = [];
    const steered: string[] = [];
    const x = new ObjectContext({
      userDir: () => "/tmp/vito-orchestrator-steering-test",
      vitoService: () => ({ getConfig: () => config }),
      skillStore: () => ({ list: () => [] }),
      sessionService: () => ({ resolve: () => ({ id: "discord:one" }) }),
      messageStore: () => ({ create: (_x: unknown, value: unknown) => void created.push(value) }),
    });
    const service = new PiOrchestratorService();
    service.reloadConfig(x, config);
    const internal = service as unknown as {
      activeRequests: Map<string, unknown>;
      runtimeRegistry: { get(id: string): { steer(text: string): Promise<boolean> } | undefined };
    };
    internal.activeRequests.set("discord:one", {
      abort: new AbortController(),
      aborted: false,
      event: {},
      startedAt: Date.now(),
    });
    internal.runtimeRegistry = {
      get: () => ({
        steer: async (text) => {
          steered.push(text);
          return true;
        },
      }),
    };

    const accepted = await service.steer(x, {
      sessionKey: "discord:one",
      channel: "discord",
      target: "one",
      author: "Mike",
      timestamp: 123,
      content: "Change direction",
    });
    assert.equal(accepted, true);
    assert.match(steered[0] ?? "", /Change direction/);
    assert.equal(created.length, 1);
    assert.equal((created[0] as { type: string }).type, "user");
  });

  it("steers only the matching queued sender once and removes the queued invocation", async () => {
    const records: unknown[] = [];
    const x = new ObjectContext({
      userDir: () => "/tmp/vito-orchestrator-queued-steer-test",
      vitoService: () => ({ getConfig: () => config }),
      skillStore: () => ({ list: () => [] }),
      sessionService: () => ({ resolve: () => ({ id: "telegram:123" }) }),
      messageStore: () => ({ create: (_x: unknown, value: unknown) => void records.push(value) }),
    });
    const service = new PiOrchestratorService();
    service.reloadConfig(x, config);
    let resolved = 0;
    const event = {
      sessionKey: "telegram:123",
      channel: "telegram",
      target: "123",
      author: "Mike",
      timestamp: 123,
      content: "Change direction",
      raw: { message: { message_id: 42 }, steeringAuthorId: "7" },
    };
    const internal = service as unknown as {
      activeRequests: Map<string, unknown>;
      sessionQueues: Map<string, Array<unknown>>;
      runtimeRegistry: { get(id: string): { steer(text: string): Promise<boolean> } | undefined };
    };
    internal.activeRequests.set(event.sessionKey, { aborted: false });
    internal.runtimeRegistry = { get: () => ({ steer: async () => true }) };
    internal.sessionQueues.set(event.sessionKey, [
      {
        event,
        resolve: () => {
          resolved++;
        },
        reject: () => {},
      },
    ]);
    assert.equal(await service.steerQueued(x, event.sessionKey, "123:42", "8"), "forbidden");
    assert.equal(await service.steerQueued(x, event.sessionKey, "123:99", "7"), "expired");
    // Turn ended while the click was being handed to Pi: retain the original queue item.
    internal.runtimeRegistry = { get: () => ({ steer: async () => false }) };
    assert.equal(await service.steerQueued(x, event.sessionKey, "123:42", "7"), "expired");
    assert.equal(internal.sessionQueues.get(event.sessionKey)?.length, 1);
    assert.equal(resolved, 0);
    assert.equal(records.length, 0);
    internal.runtimeRegistry = { get: () => ({ steer: async () => true }) };
    assert.equal(await service.steerQueued(x, event.sessionKey, "123:42", "7"), "steered");
    assert.equal(await service.steerQueued(x, event.sessionKey, "123:42", "7"), "expired");
    assert.equal(resolved, 1);
    assert.equal(records.length, 1);
  });

  it("releases the worker and rejects failed turns even when error delivery fails", async () => {
    const service = new PiOrchestratorService();
    const x = new ObjectContext({
      userDir: () => "/tmp/vito-queue-failure-test",
      vitoService: () => ({ getConfig: () => config }),
      skillStore: () => ({ list: () => [] }),
    });
    service.reloadConfig(x, config);
    const internal = service as unknown as {
      processMessage: () => Promise<void>;
      sessionProcessing: Set<string>;
    };
    let attempts = 0;
    internal.processMessage = async () => {
      if (++attempts === 1) throw new Error("turn failed");
    };
    const channel = {
      name: "dashboard",
      capabilities: { typing: false, reactions: false, attachments: false, streaming: false },
      start: async () => {},
      stop: async () => {},
      listen: async () => () => {},
      createOutputHandler: () => ({
        relay: async () => {
          throw new Error("delivery failed");
        },
      }),
    };
    const event = {
      sessionKey: "dashboard:failure",
      channel: "dashboard",
      target: "failure",
      author: "Mike",
      timestamp: Date.now(),
      content: "test",
    };
    const first = service.handleInbound(x, event, channel);
    const second = service.handleInbound(x, event, channel);
    await assert.rejects(first, /turn failed/);
    await second;
    assert.equal(attempts, 2);
    assert.equal(internal.sessionProcessing.has(event.sessionKey), false);
    await service.handleInbound(x, event, channel);
    assert.equal(attempts, 3);
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
