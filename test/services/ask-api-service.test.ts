import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import { DefaultAskApiService } from "../../src/services/ask/DefaultAskApiService.js";
import { AskHandlerNotConfiguredError } from "../../src/services/ask/AskApiService.js";

describe("DefaultAskApiService", () => {
  it("reports and rejects an unconfigured handler", async () => {
    const x = new ObjectContext({});
    const service = new DefaultAskApiService();
    assert.equal(service.isConfigured(x), false);
    await assert.rejects(
      () => service.ask(x, { question: "Hello" }),
      AskHandlerNotConfiguredError
    );
  });

  it("forwards validated Ask API options to the configured handler", async () => {
    const x = new ObjectContext({});
    const service = new DefaultAskApiService();
    const received: unknown[] = [];
    service.configure(x, async (options) => {
      received.push(options);
      return "Answer";
    });

    const options = {
      question: "Hello",
      session: "telegram:123",
      author: "caller",
      channelPrompt: "Be brief",
      timeoutMs: 5000,
      relayToSession: true,
    };
    assert.equal(service.isConfigured(x), true);
    assert.equal(await service.ask(x, options), "Answer");
    assert.deepEqual(received, [options]);
  });
});
