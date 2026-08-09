import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NoReplyOutputHandler } from "../../src/output/NoReplyOutputHandler.js";
import type { OutputHandler } from "../../src/output/OutputHandler.js";
import { ProxyOutputHandler } from "../../src/output/ProxyOutputHandler.js";

describe("ProxyOutputHandler", () => {
  it("delegates output without advertising unsupported optional capabilities", async () => {
    const relayed: string[] = [];
    const proxy = new ProxyOutputHandler({
      relay: async (message) => {
        relayed.push(message);
      },
    });

    await proxy.relay("hello");

    assert.deepEqual(relayed, ["hello"]);
    assert.equal(proxy.endMessage, undefined);
    assert.equal(proxy.startTyping, undefined);
  });
});

describe("NoReplyOutputHandler", () => {
  it("suppresses NO_REPLY messages and delegates normal output", async () => {
    const relayed: string[] = [];
    let ended = 0;
    const handler: OutputHandler = {
      relay: async (message) => {
        relayed.push(message);
      },
      endMessage: async () => {
        ended += 1;
      },
    };
    const decorated = new NoReplyOutputHandler(handler);

    await decorated.relay("NO_REPLY");
    await decorated.relay("send this");
    await decorated.endMessage?.();

    assert.deepEqual(relayed, ["send this"]);
    assert.equal(ended, 1);
  });
});
