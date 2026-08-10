import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import express from "express";
import { z } from "zod";
import { dashboardRouterContext } from "../support/dashboard-router-context.js";
import {
  AttachmentFileRouterService,
  AttachmentUploadRouterService,
} from "../../src/routers/AttachmentRouterService.js";
import { FileRouterService } from "../../src/routers/FileRouterService.js";
import { FileSystemFileService } from "../../src/services/files/FileSystemFileService.js";
import { FileAttachmentStore } from "../../src/stores/attachments/FileAttachmentStore.js";

const root = mkdtempSync(join(tmpdir(), "vito-file-router-"));
const attachmentsDir = join(root, "attachments");
const x = dashboardRouterContext({
  attachmentsDir: () => attachmentsDir,
  attachmentStore: () => new FileAttachmentStore(),
  fileService: () => new FileSystemFileService(),
});
const app = express();
app.use(express.json());
app.use("/api/file", await new FileRouterService().createRouter(x));
app.use("/api/attachments", await new AttachmentUploadRouterService().createRouter(x));
app.use("/attachments", await new AttachmentFileRouterService().createRouter(x));

let server: Server;
let baseUrl: string;
let attachmentUrl = "";

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
    server.close((error) => (error ? reject(error) : resolve()));
  });
  rmSync(root, { recursive: true, force: true });
});

describe("file and attachment routers", () => {
  it("serves filesystem files with existing headers", async () => {
    const path = join(root, "document.pdf");
    writeFileSync(path, "pdf");
    assert.equal((await fetch(`${baseUrl}/api/file`)).status, 400);
    assert.equal(
      (await fetch(`${baseUrl}/api/file?path=${encodeURIComponent(join(root, "missing"))}`)).status,
      404,
    );

    const response = await fetch(`${baseUrl}/api/file?path=${encodeURIComponent(path)}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/pdf");
    assert.equal(response.headers.get("content-disposition"), 'inline; filename="document.pdf"');
    assert.equal(await response.text(), "pdf");
  });

  it("preserves attachment upload responses and serves uploaded content", async () => {
    const invalid = await fetch(`${baseUrl}/api/attachments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: "invalid" }),
    });
    assert.equal(invalid.status, 400);
    assert.deepEqual(await invalid.json(), { error: "Invalid data URL format" });

    const upload = await fetch(`${baseUrl}/api/attachments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        data: `data:text/plain;base64,${Buffer.from("hello").toString("base64")}`,
        filename: "note.txt",
      }),
    });
    assert.equal(upload.status, 200);
    const result = z
      .object({
        path: z.string(),
        url: z.string(),
        filename: z.string(),
        mimeType: z.string(),
      })
      .parse(await upload.json());
    assert.equal(result.filename, "note.txt");
    assert.equal(result.mimeType, "text/plain");
    attachmentUrl = result.url;

    const file = await fetch(`${baseUrl}${attachmentUrl}`);
    assert.equal(file.status, 200);
    assert.match(file.headers.get("content-type") ?? "", /^text\/plain/);
    assert.equal(file.headers.get("accept-ranges"), "bytes");
    assert.equal(await file.text(), "hello");

    const partial = await fetch(`${baseUrl}${attachmentUrl}`, {
      headers: { range: "bytes=1-3" },
    });
    assert.equal(partial.status, 206);
    assert.equal(partial.headers.get("content-range"), "bytes 1-3/5");
    assert.equal(await partial.text(), "ell");
  });

  it("returns 404 for unknown or unsafe attachment identifiers", async () => {
    assert.equal((await fetch(`${baseUrl}/attachments/missing.txt`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/attachments/..%5Coutside`)).status, 400);
  });
});
