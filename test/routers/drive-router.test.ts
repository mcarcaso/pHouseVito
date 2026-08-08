import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import express from "express";
import { z } from "zod";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import {
  createDriveRouter,
  createPublicDriveRouter,
} from "../../src/routers/drive/drive-router.js";
import { FileDriveStore } from "../../src/stores/drive/FileDriveStore.js";

const root = mkdtempSync(join(tmpdir(), "vito-drive-router-"));
const x = new ObjectContext({
  driveDir: () => root,
  driveStore: () => new FileDriveStore(),
});
const app = express();
app.use(express.json({ limit: "5mb" }));
app.use("/d", createPublicDriveRouter(x));
app.use("/api/drive", createDriveRouter(x));

let server: Server;
let baseUrl: string;

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
    server.close((error) => error ? reject(error) : resolve());
  });
  rmSync(root, { recursive: true, force: true });
});

describe("drive router", () => {
  it("validates uploads and lists files", async () => {
    const invalid = await fetch(`${baseUrl}/api/drive/upload`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        data: "data:text/plain;base64,YQ==",
        filename: "../bad.txt",
      }),
    });
    assert.equal(invalid.status, 400);

    const upload = await fetch(`${baseUrl}/api/drive/upload`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        data: `data:text/html;base64,${Buffer.from("<h1>Hello</h1>").toString("base64")}`,
        filename: "index.html",
        folder: "site",
      }),
    });
    assert.equal(upload.status, 200);

    const listing = await fetch(`${baseUrl}/api/drive/ls?path=site`);
    assert.equal(listing.status, 200);
    const result = z.object({
      path: z.string(),
      isPublic: z.boolean(),
      files: z.array(z.object({ name: z.string(), size: z.number(), isPublic: z.boolean() })),
    }).passthrough().parse(await listing.json());
    assert.equal(result.files[0].name, "index.html");
    assert.equal(result.files[0].isPublic, false);
  });

  it("serves authenticated-style files and only exposes public files through /d", async () => {
    const privateResponse = await fetch(`${baseUrl}/d/site/`);
    assert.equal(privateResponse.status, 404);

    const metadata = await fetch(`${baseUrl}/api/drive/meta?path=site`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isPublic: true, name: "Site" }),
    });
    assert.equal(metadata.status, 200);

    const publicResponse = await fetch(`${baseUrl}/d/site/`);
    assert.equal(publicResponse.status, 200);
    assert.equal(await publicResponse.text(), "<h1>Hello</h1>");
    assert.equal(publicResponse.headers.get("access-control-allow-origin"), "*");

    const fileResponse = await fetch(`${baseUrl}/api/drive/file/site/index.html`);
    assert.equal(fileResponse.status, 200);
    assert.equal(await fileResponse.text(), "<h1>Hello</h1>");
  });

  it("updates file visibility and deletes entries", async () => {
    const metadata = await fetch(`${baseUrl}/api/drive/file-meta?path=site%2Findex.html`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isPublic: false }),
    });
    assert.equal(metadata.status, 200);
    assert.deepEqual(await metadata.json(), { file: "index.html", isPublic: false });
    assert.equal((await fetch(`${baseUrl}/d/site/index.html`)).status, 404);

    const deleted = await fetch(`${baseUrl}/api/drive?path=site`, { method: "DELETE" });
    assert.equal(deleted.status, 200);
    assert.equal((await fetch(`${baseUrl}/api/drive/ls?path=site`)).status, 404);
  });
});
