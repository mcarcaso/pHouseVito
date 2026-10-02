import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import { PiRuntimeRegistry } from "../../src/services/orchestrator/PiRuntimeRegistry.js";
import { FilePiSessionStore } from "../../src/stores/pi-sessions/FilePiSessionStore.js";

test("deployment moves retain the same Pi transcript while /new still starts fresh", async () => {
  const root = mkdtempSync(join(tmpdir(), "vito-pi-move-"));
  const previousAgentDir = process.env.VITO_PI_AGENT_DIR;
  const registry = new PiRuntimeRegistry();
  try {
    const sessions = join(root, "sessions");
    const sessionId = "discord:one";
    const directory = join(sessions, encodeURIComponent(sessionId));
    mkdirSync(directory, { recursive: true });
    process.env.VITO_PI_AGENT_DIR = join(root, "agent");
    mkdirSync(process.env.VITO_PI_AGENT_DIR);
    writeFileSync(join(process.env.VITO_PI_AGENT_DIR, "auth.json"), "{}");
    const persisted = SessionManager.create("/previous/managed/release", directory);
    persisted.appendMessage({ role: "user", content: "BEFORE_MOVE", timestamp: Date.now() });
    const file = persisted.getSessionFile();
    assert.ok(file);
    const otherDirectory = join(sessions, encodeURIComponent("discord:two"));
    mkdirSync(otherDirectory);
    const other = SessionManager.create("/previous/managed/release", otherDirectory);
    other.appendMessage({ role: "user", content: "OTHER_CONVERSATION", timestamp: Date.now() });
    const x = new ObjectContext({
      piSessionsDir: () => sessions,
      piSessionStore: () => new FilePiSessionStore(),
      skillStore: () => ({ list: () => [] }),
    });
    const runtime = await registry.getOrCreate(x, sessionId, {});
    assert.equal(runtime.isFresh(), false);
    await runtime.appendContext("test system", "AFTER_MOVE", { key: "move", source: "test" });
    const resumed = readFileSync(file, "utf8");
    assert.match(resumed, /BEFORE_MOVE/);
    assert.match(resumed, /AFTER_MOVE/);
    assert.doesNotMatch(resumed, /OTHER_CONVERSATION/);
    await registry.disposeAll();
    writeFileSync(join(directory, ".fresh"), "");
    const fresh = await registry.getOrCreate(x, sessionId, {});
    assert.equal(fresh.isFresh(), true);
    await fresh.appendContext("test system", "AFTER_NEW", { key: "fresh", source: "test" });
    assert.equal(readFileSync(file, "utf8"), resumed);
  } finally {
    await registry.disposeAll();
    if (previousAgentDir === undefined) delete process.env.VITO_PI_AGENT_DIR;
    else process.env.VITO_PI_AGENT_DIR = previousAgentDir;
    rmSync(root, { recursive: true, force: true });
  }
});
