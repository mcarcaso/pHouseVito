import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { z } from "zod";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import { FileSecretService } from "../../src/services/secrets/FileSecretService.js";
import { SystemSecretDeletionError } from "../../src/services/secrets/SecretService.js";

function createHarness() {
  const root = mkdtempSync(join(tmpdir(), "vito-secret-service-"));
  const secretsPath = join(root, "secrets.json");
  const piAuthPath = join(root, "auth.json");
  const x = new ObjectContext({
    secretsPath: () => secretsPath,
    piAuthPath: () => piAuthPath,
  });
  return { root, secretsPath, piAuthPath, x, service: new FileSecretService() };
}

describe("FileSecretService", () => {
  it("loads file secrets into the environment and seeds system values", () => {
    const { root, secretsPath, x, service } = createHarness();
    const previous = process.env.BLAND_WEBHOOK_SECRET;
    try {
      process.env.BLAND_WEBHOOK_SECRET = "from-environment";
      service.load(x);
      const saved = z.record(z.string()).parse(
        JSON.parse(readFileSync(secretsPath, "utf-8"))
      );
      assert.equal(saved.BLAND_WEBHOOK_SECRET, "from-environment");

      service.set(x, { key: "BLAND_WEBHOOK_SECRET", value: "" });
      assert.equal(process.env.BLAND_WEBHOOK_SECRET, undefined);
    } finally {
      if (previous === undefined) delete process.env.BLAND_WEBHOOK_SECRET;
      else process.env.BLAND_WEBHOOK_SECRET = previous;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("sets and deletes custom secrets while protecting system keys", () => {
    const { root, x, service } = createHarness();
    const previous = process.env.TEST_VITO_SECRET;
    try {
      service.set(x, { key: "TEST_VITO_SECRET", value: "value" });
      assert.equal(service.get(x, "TEST_VITO_SECRET"), "value");
      assert.equal(process.env.TEST_VITO_SECRET, "value");
      assert.equal(service.delete(x, { key: "TEST_VITO_SECRET" }), true);
      assert.equal(process.env.TEST_VITO_SECRET, undefined);
      assert.throws(
        () => service.delete(x, { key: "DISCORD_BOT_TOKEN" }),
        SystemSecretDeletionError
      );
    } finally {
      if (previous === undefined) delete process.env.TEST_VITO_SECRET;
      else process.env.TEST_VITO_SECRET = previous;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("combines API-key and Pi OAuth provider status", () => {
    const { root, piAuthPath, x, service } = createHarness();
    const previous = process.env.ANTHROPIC_API_KEY;
    try {
      service.set(x, { key: "ANTHROPIC_API_KEY", value: "test-key" });
      writeFileSync(piAuthPath, JSON.stringify({
        "openai-codex": {
          type: "oauth",
          access: "token",
          expires: 123,
        },
      }));

      const status = service.getProviderAuthStatus(x);
      assert.deepEqual(status.anthropic, { hasAuth: true, authType: "api_key" });
      assert.deepEqual(status["openai-codex"], {
        hasAuth: true,
        authType: "oauth",
        expiresAt: 123,
      });
      assert.equal(service.getProviderKeyStatus(x).anthropic, true);
    } finally {
      if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previous;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns system placeholders without exposing malformed file shapes", () => {
    const { root, secretsPath, x, service } = createHarness();
    try {
      writeFileSync(secretsPath, JSON.stringify({ INVALID: 42 }));
      const entries = service.list(x);
      assert.ok(entries.some((entry) => entry.key === "TELEGRAM_BOT_TOKEN"));
      assert.equal(entries.some((entry) => entry.key === "INVALID"), false);
      assert.throws(() => service.set(x, { key: "NEW_SECRET", value: "value" }));
      assert.equal(readFileSync(secretsPath, "utf-8"), JSON.stringify({ INVALID: 42 }));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
