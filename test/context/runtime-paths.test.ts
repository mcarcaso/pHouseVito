import assert from "node:assert/strict";
import { test } from "node:test";
import Database from "better-sqlite3";
import { RootContext } from "../../src/context/RootContext.js";
import { xAttachmentsDir, xLogsDir, xPiAuthPath } from "../../src/lib/x.js";

test("source deployment uses the existing external paths and respects explicit context overrides", () => {
  const keys = ["VITO_LOGS_DIR", "VITO_ATTACHMENTS_DIR", "VITO_PI_AGENT_DIR"] as const;
  const previous = keys.map((key) => process.env[key]);
  const db = new Database(":memory:");
  try {
    process.env.VITO_LOGS_DIR = "/external/user/logs";
    process.env.VITO_ATTACHMENTS_DIR = "/external/user/attachments";
    process.env.VITO_PI_AGENT_DIR = "/external/user/pi-agent";
    const args = { db, userDir: "/external/user", skillsDir: "/external/user/skills" };
    const x = RootContext(args);
    assert.equal(xLogsDir(x), "/external/user/logs");
    assert.equal(xAttachmentsDir(x), "/external/user/attachments");
    assert.equal(xPiAuthPath(x), "/external/user/pi-agent/auth.json");
    const override = RootContext({
      ...args,
      logsDir: "/override/logs",
      attachmentsDir: "/override/attachments",
      piAuthPath: "/override/auth.json",
    });
    assert.equal(xLogsDir(override), "/override/logs");
    assert.equal(xAttachmentsDir(override), "/override/attachments");
    assert.equal(xPiAuthPath(override), "/override/auth.json");
  } finally {
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
    db.close();
  }
});
