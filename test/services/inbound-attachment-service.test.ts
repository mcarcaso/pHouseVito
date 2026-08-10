import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import type { InboundEvent } from "../../src/lib/types/inbound-event.js";
import { DriveInboundAttachmentService } from "../../src/services/files/DriveInboundAttachmentService.js";
import { FileDriveStore } from "../../src/stores/drive/FileDriveStore.js";

describe("DriveInboundAttachmentService", () => {
  it("downloads remote channel attachments through DriveStore", async () => {
    const driveDir = mkdtempSync(join(tmpdir(), "vito-inbound-attachment-"));
    const x = new ObjectContext({
      driveDir: () => driveDir,
      driveStore: () => new FileDriveStore(),
    });
    const event: InboundEvent = {
      sessionKey: "telegram:test",
      channel: "telegram",
      target: "test",
      author: "user",
      timestamp: Date.now(),
      content: "photo",
      raw: {},
      attachments: [{
        type: "image",
        url: "https://cdn.example.test/photo",
        mimeType: "image/png",
      }],
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(Buffer.from("image"), { status: 200 });

    try {
      await new DriveInboundAttachmentService().prepare(x, event);
      const attachment = event.attachments[0];
      assert.ok(attachment.path?.startsWith(driveDir));
      assert.equal(existsSync(attachment.path ?? ""), true);
      assert.equal(attachment.buffer?.toString(), "image");
    } finally {
      globalThis.fetch = originalFetch;
      rmSync(driveDir, { recursive: true, force: true });
    }
  });
});
