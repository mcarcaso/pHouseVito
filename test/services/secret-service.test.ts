import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
      const saved = z.record(z.string()).parse(JSON.parse(readFileSync(secretsPath, "utf-8")));
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
        SystemSecretDeletionError,
      );
    } finally {
      if (previous === undefined) delete process.env.TEST_VITO_SECRET;
      else process.env.TEST_VITO_SECRET = previous;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("serializes writes with other processes", async () => {
    const { root, secretsPath, x, service } = createHarness();
    const signalPath = join(root, "locked");
    const previous = process.env.LOCKED_WRITE;
    try {
      service.set(x, { key: "INITIAL", value: "kept" });
      const child = spawn(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          `
            import lockfile from "proper-lockfile";
            import { writeFileSync } from "node:fs";
            const release = lockfile.lockSync(process.env.SECRETS_PATH, {
              realpath: false,
              stale: 10_000,
            });
            writeFileSync(process.env.SIGNAL_PATH, "locked");
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 350);
            release();
          `,
        ],
        {
          cwd: process.cwd(),
          env: { ...process.env, SECRETS_PATH: secretsPath, SIGNAL_PATH: signalPath },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const output: Buffer[] = [];
      child.stderr.on("data", (chunk: Buffer) => output.push(chunk));
      const childExit = new Promise<number | null>((resolve) => child.on("exit", resolve));
      const signalDeadline = Date.now() + 2_000;
      while (!existsSync(signalPath) && Date.now() < signalDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(existsSync(signalPath), true, Buffer.concat(output).toString("utf-8"));

      const startedAt = Date.now();
      service.set(x, { key: "LOCKED_WRITE", value: "saved" });
      const waitedMs = Date.now() - startedAt;
      const exitCode = await childExit;

      assert.equal(exitCode, 0, Buffer.concat(output).toString("utf-8"));
      assert.ok(waitedMs >= 200, `Expected a locked write to wait, got ${waitedMs}ms`);
      assert.equal(service.get(x, "INITIAL"), "kept");
      assert.equal(service.get(x, "LOCKED_WRITE"), "saved");
    } finally {
      if (previous === undefined) delete process.env.LOCKED_WRITE;
      else process.env.LOCKED_WRITE = previous;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("combines API-key and Pi OAuth provider status", () => {
    const { root, piAuthPath, x, service } = createHarness();
    const previous = process.env.ANTHROPIC_API_KEY;
    try {
      service.set(x, { key: "ANTHROPIC_API_KEY", value: "test-key" });
      writeFileSync(
        piAuthPath,
        JSON.stringify({
          "openai-codex": {
            type: "oauth",
            access: "token",
            expires: 123,
          },
        }),
      );

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
      assert.equal(
        entries.some((entry) => entry.key === "INVALID"),
        false,
      );
      assert.throws(() => service.set(x, { key: "NEW_SECRET", value: "value" }));
      assert.equal(readFileSync(secretsPath, "utf-8"), JSON.stringify({ INVALID: 42 }));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
