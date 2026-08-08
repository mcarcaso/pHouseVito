import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import { InMemoryDashboardAuthService } from "../../src/services/auth/InMemoryDashboardAuthService.js";
import { FileSecretService } from "../../src/services/secrets/FileSecretService.js";

function createHarness() {
  const root = mkdtempSync(join(tmpdir(), "vito-dashboard-auth-"));
  const service = new InMemoryDashboardAuthService();
  const x = new ObjectContext({
    secretsPath: () => join(root, "secrets.json"),
    secretService: () => new FileSecretService(),
  });
  return { root, x, service };
}

describe("InMemoryDashboardAuthService", () => {
  it("sets up a password and authenticates the initial session", () => {
    const { root, x, service } = createHarness();
    try {
      assert.deepEqual(service.getStatus(x), { authenticated: false, passwordSet: false });
      const setup = service.setup(x, { host: "localhost:3030" });
      assert.equal(setup.status, "success");
      if (setup.status !== "success") return;
      assert.ok(setup.password.length > 0);
      assert.match(setup.cookie, /^session=.*; HttpOnly; Path=\/; SameSite=Lax; Max-Age=604800$/);
      assert.deepEqual(service.getStatus(x, setup.cookie), {
        authenticated: true,
        passwordSet: true,
      });
      assert.deepEqual(service.setup(x, {}), { status: "password_already_set" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("preserves login rate limiting and resets attempts after success", () => {
    const { root, x, service } = createHarness();
    try {
      const setup = service.setup(x, { host: "example.com" });
      if (setup.status !== "success") throw new Error("Setup failed");
      for (let attempt = 0; attempt < 5; attempt++) {
        assert.deepEqual(service.login(x, {
          password: "bad",
          ip: "test-ip",
          host: "example.com",
        }), { status: "invalid_password" });
      }
      assert.deepEqual(service.login(x, {
        password: setup.password,
        ip: "test-ip",
      }), { status: "rate_limited" });

      const success = service.login(x, {
        password: setup.password,
        ip: "another-ip",
        host: "example.com",
      });
      assert.equal(success.status, "success");
      if (success.status !== "success") return;
      assert.match(success.cookie, / SameSite=Lax; Secure; Max-Age=604800$/);
      const logoutCookie = service.logout(x, {
        cookieHeader: success.cookie,
        host: "example.com",
      });
      assert.equal(service.isAuthenticated(x, success.cookie), false);
      assert.equal(logoutCookie, "session=; HttpOnly; Path=/; SameSite=Lax; Secure; Max-Age=0");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
