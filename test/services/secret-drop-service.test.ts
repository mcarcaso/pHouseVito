import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import { createDatabase } from "../../src/lib/sqlite/database.js";
import { FileSecretService } from "../../src/services/secrets/FileSecretService.js";
import { SecretReplacementConfirmationError } from "../../src/services/secrets/SecretDropService.js";
import { SqliteSecretDropService } from "../../src/services/secrets/SqliteSecretDropService.js";

function createHarness() {
  const root = mkdtempSync(join(tmpdir(), "vito-secret-drop-"));
  const secretsPath = join(root, "secrets.json");
  const db = createDatabase(join(root, "vito.db"));
  const x = new ObjectContext({
    secretsPath: () => secretsPath,
    piAuthPath: () => join(root, "auth.json"),
  });
  const secrets = new FileSecretService();
  let now = 1_000_000;
  const drops = new SqliteSecretDropService(x, db, secrets, () => now);
  return {
    root,
    secretsPath,
    db,
    x,
    secrets,
    drops,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
  };
}

describe("SqliteSecretDropService", () => {
  it("accepts one submission without storing the plaintext in drop state", () => {
    const { root, db, x, secrets, drops } = createHarness();
    const previous = process.env.DROP_TEST_SECRET;
    try {
      const drop = drops.create({ key: "DROP_TEST_SECRET", replace: false });
      const persisted = db
        .prepare("SELECT token_digest, status FROM secret_drops WHERE id = ?")
        .get(drop.id) as { token_digest: string; status: string };
      assert.notEqual(persisted.token_digest, drop.token);
      assert.equal(persisted.status, "pending");

      assert.equal(drops.submit({ token: drop.token, value: "private-value" }), "saved");
      assert.equal(secrets.get(x, "DROP_TEST_SECRET"), "private-value");
      assert.equal(drops.submit({ token: drop.token, value: "second-value" }), "unavailable");
      assert.equal(secrets.get(x, "DROP_TEST_SECRET"), "private-value");
      assert.deepEqual(drops.check(drop.id), {
        id: drop.id,
        secretKey: "DROP_TEST_SECRET",
        expiresAt: 1_900_000,
        status: "saved",
      });
      assert.equal(
        JSON.stringify(db.prepare("SELECT * FROM secret_drops WHERE id = ?").get(drop.id)).includes(
          "private-value",
        ),
        false,
      );
    } finally {
      if (previous === undefined) delete process.env.DROP_TEST_SECRET;
      else process.env.DROP_TEST_SECRET = previous;
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("expires pending drops after fifteen minutes", () => {
    const { root, db, drops, advance } = createHarness();
    try {
      const drop = drops.create({ key: "EXPIRING_SECRET", replace: false });
      advance(15 * 60 * 1_000);
      assert.equal(drops.check(drop.id)?.status, "expired");
      assert.equal(drops.submit({ token: drop.token, value: "too-late" }), "unavailable");
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("requires confirmed replacement both when issuing and when submitting", () => {
    const { root, db, x, secrets, drops } = createHarness();
    const previous = process.env.REPLACE_TEST_SECRET;
    try {
      secrets.set(x, { key: "REPLACE_TEST_SECRET", value: "original" });
      assert.throws(
        () => drops.create({ key: "REPLACE_TEST_SECRET", replace: false }),
        SecretReplacementConfirmationError,
      );
      const replacement = drops.create({ key: "REPLACE_TEST_SECRET", replace: true });
      assert.equal(drops.submit({ token: replacement.token, value: "replacement" }), "saved");
      assert.equal(secrets.get(x, "REPLACE_TEST_SECRET"), "replacement");

      const raced = drops.create({ key: "RACED_SECRET", replace: false });
      secrets.set(x, { key: "RACED_SECRET", value: "appeared-later" });
      assert.equal(drops.submit({ token: raced.token, value: "overwrite" }), "failed");
      assert.equal(secrets.get(x, "RACED_SECRET"), "appeared-later");
      assert.equal(drops.submit({ token: raced.token, value: "retry" }), "unavailable");
    } finally {
      if (previous === undefined) delete process.env.REPLACE_TEST_SECRET;
      else process.env.REPLACE_TEST_SECRET = previous;
      delete process.env.RACED_SECRET;
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("consumes the link before a failed secret-file write", () => {
    const { root, secretsPath, db, drops } = createHarness();
    try {
      const drop = drops.create({ key: "FAILED_WRITE", replace: false });
      writeFileSync(secretsPath, JSON.stringify({ INVALID: 42 }));
      assert.equal(drops.submit({ token: drop.token, value: "not-saved" }), "failed");
      assert.equal(drops.check(drop.id)?.status, "failed");
      assert.equal(drops.submit({ token: drop.token, value: "retry" }), "unavailable");
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
