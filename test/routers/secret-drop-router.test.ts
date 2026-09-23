import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import express from "express";
import { dashboardRouterContext } from "../support/dashboard-router-context.js";
import {
  PublicSecretDropRouterService,
  SecretDropRouterService,
} from "../../src/routers/SecretDropRouterService.js";
import type {
  SecretDropService,
  SecretDropSubmission,
} from "../../src/services/secrets/SecretDropService.js";

const token = "a".repeat(43);
let submission: SecretDropSubmission = "saved";
const service: SecretDropService = {
  create: ({ key }) => ({ id: "b".repeat(24), token, secretKey: key, expiresAt: 1234 }),
  check: (id) => ({ id, secretKey: "DROP_KEY", expiresAt: 1234, status: "pending" }),
  submit: () => submission,
};
const x = dashboardRouterContext({ secretDropService: () => service });
const app = express();
app.use("/api/secret-drops", await new SecretDropRouterService().createRouter(x));
app.use("/secret-drop", await new PublicSecretDropRouterService().createRouter(x));

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
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe("secret drop router", () => {
  it("issues links only through an authenticated HTTPS request", async () => {
    const insecure = await fetch(`${baseUrl}/api/secret-drops`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "DROP_KEY", replace: false }),
    });
    assert.equal(insecure.status, 400);

    const response = await fetch(`${baseUrl}/api/secret-drops`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-proto": "https",
      },
      body: JSON.stringify({ key: "DROP_KEY", replace: false }),
    });
    assert.equal(response.status, 200);
    const httpsOrigin = `https://${new URL(baseUrl).host}`;
    assert.deepEqual(await response.json(), {
      id: "b".repeat(24),
      url: `${httpsOrigin}/secret-drop/#${token}`,
      secretKey: "DROP_KEY",
      expiresAt: 1234,
    });
  });

  it("serves a no-store page and enforces same-origin HTTPS submissions", async () => {
    const page = await fetch(`${baseUrl}/secret-drop/`);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("cache-control"), "no-store");
    assert.match(page.headers.get("content-security-policy") ?? "", /default-src 'none'/);
    assert.equal((await page.text()).includes(token), false);

    const httpsOrigin = `https://${new URL(baseUrl).host}`;
    const forbidden = await fetch(`${baseUrl}/secret-drop/submit`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-proto": "https",
        origin: "https://other.example.test",
      },
      body: JSON.stringify({ token, value: "private" }),
    });
    assert.equal(forbidden.status, 403);

    submission = "saved";
    const saved = await fetch(`${baseUrl}/secret-drop/submit`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-proto": "https",
        origin: httpsOrigin,
      },
      body: JSON.stringify({ token, value: "private" }),
    });
    assert.equal(saved.status, 200);
    assert.deepEqual(await saved.json(), { saved: true });
  });

  it("returns an opaque gone response for unusable links", async () => {
    submission = "unavailable";
    const response = await fetch(`${baseUrl}/secret-drop/submit`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-proto": "https",
        origin: `https://${new URL(baseUrl).host}`,
      },
      body: JSON.stringify({ token, value: "private" }),
    });
    assert.equal(response.status, 410);
    assert.deepEqual(await response.json(), { error: "Link unavailable" });
  });
});
