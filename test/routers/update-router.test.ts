import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { UpdateRouterService } from "../../src/routers/UpdateRouterService.js";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import { dashboardRouterContext } from "../support/dashboard-router-context.js";

test("update routes require dashboard authentication and explicit validated approval", async () => {
  const app = express();
  app.use(
    "/auth",
    await new UpdateRouterService().createRouter(
      dashboardRouterContext({ projectDir: () => process.cwd() }),
    ),
  );
  app.use(
    "/unauth",
    await new UpdateRouterService().createRouter(
      new ObjectContext({
        dashboardAuthService: () => ({ isPasswordSet: () => true, isAuthenticated: () => false }),
      }),
    ),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((done) => server.once("listening", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing address");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    for (const [method, action] of [
      ["GET", "status"],
      ["POST", "check"],
      ["POST", "stage"],
      ["POST", "apply"],
    ]) {
      const response = await fetch(`${base}/unauth/server/update/${action}`, {
        method,
        ...(method === "POST"
          ? { headers: { "content-type": "application/json" }, body: "{}" }
          : {}),
      });
      assert.equal(response.status, 401);
    }
    const status = await fetch(`${base}/auth/server/update/status`);
    assert.equal(status.status, 200);
    assert.equal((await status.json()).supported, false);
    for (const body of [
      {},
      { version: "v1", revision: "a".repeat(40), approved: false },
      { version: "../bad", revision: "a".repeat(40), approved: true },
    ]) {
      const response = await fetch(`${base}/auth/server/update/apply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 400);
    }
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
  }
});
