import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import { DefaultDashboardChatService } from "../../src/services/chat/DefaultDashboardChatService.js";
import type { InboundEvent } from "../../src/lib/types/inbound-event.js";

describe("DefaultDashboardChatService", () => {
  it("reports an unconfigured inbound handler", () => {
    const x = new ObjectContext({});
    const service = new DefaultDashboardChatService();
    assert.equal(service.isConfigured(x), false);
    assert.equal(service.send(x, { type: "chat", content: "Hello" }), false);
  });

  it("converts dashboard messages into existing inbound events", () => {
    const x = new ObjectContext({});
    const service = new DefaultDashboardChatService();
    const events: InboundEvent[] = [];
    service.configure(x, (event) => events.push(event));

    const message = {
      type: "chat" as const,
      content: "Hello",
      sessionId: "telegram:123:456",
      attachments: [
        {
          type: "image" as const,
          path: "/tmp/image.png",
          filename: "image.png",
          clientMetadata: "preserved",
        },
      ],
      clientMetadata: "preserved",
    };
    assert.equal(service.send(x, message), true);
    assert.equal(events.length, 1);
    assert.deepEqual(events[0], {
      sessionKey: "telegram:123:456",
      channel: "dashboard",
      target: "123:456",
      author: "user",
      timestamp: events[0]?.timestamp,
      content: "Hello",
      attachments: message.attachments,
      raw: message,
      hasMention: true,
    });
    assert.equal(typeof events[0]?.timestamp, "number");
  });

  it("preserves default sessions and attachment-only messages", () => {
    const x = new ObjectContext({});
    const service = new DefaultDashboardChatService();
    const events: InboundEvent[] = [];
    service.configure(x, (event) => events.push(event));

    assert.equal(
      service.send(x, {
        type: "chat",
        attachments: [{ type: "file", path: "/tmp/file.txt" }],
      }),
      true,
    );
    assert.equal(events[0]?.sessionKey, "dashboard:default");
    assert.equal(events[0]?.target, "default");
    assert.equal(events[0]?.content, "");

    service.configure(x, undefined);
    assert.equal(service.isConfigured(x), false);
  });
});
