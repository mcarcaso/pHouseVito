import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import { FilePiSessionStore } from "../../src/stores/pi-sessions/FilePiSessionStore.js";

function createHarness() {
  const root = mkdtempSync(join(tmpdir(), "vito-pi-session-store-"));
  const x = new ObjectContext({ piSessionsDir: () => root });
  return { root, x, store: new FilePiSessionStore() };
}

function writeSession(
  root: string,
  vitoSessionId: string,
  filename: string,
  lines: string[],
): string {
  const directory = join(root, encodeURIComponent(vitoSessionId));
  mkdirSync(directory, { recursive: true });
  const path = join(directory, filename);
  writeFileSync(path, `${lines.join("\n")}\n`);
  return path;
}

describe("FilePiSessionStore", () => {
  it("lists parsed metadata and optionally includes validated lines", () => {
    const { root, x, store } = createHarness();
    try {
      writeSession(root, "dashboard:test", "pi-1.jsonl", [
        JSON.stringify({ type: "session", id: "pi-1", timestamp: "2026-01-01", cwd: "/app" }),
        JSON.stringify({
          type: "message",
          message: { role: "user", content: [{ type: "text", text: "hello" }] },
        }),
        "not-json",
        JSON.stringify({ type: "model_change", provider: "anthropic", modelId: "sonnet" }),
      ]);

      const session = store.list(x, { includeLines: true })[0];
      assert.equal(session.id, "dashboard%3Atest/pi-1.jsonl");
      assert.equal(session.vitoSessionId, "dashboard:test");
      assert.equal(session.piSessionId, "pi-1");
      assert.equal(session.cwd, "/app");
      assert.equal(session.messageCount, 1);
      assert.equal(session.lastUserMessage, "hello");
      assert.equal(session.lastModel, "anthropic/sonnet");
      assert.deepEqual(session.lines?.[2], { type: "parse_error", raw: "not-json" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("filters consistently and orders sessions by modification time", () => {
    const { root, x, store } = createHarness();
    try {
      const older = writeSession(root, "dashboard:one", "old.jsonl", []);
      const newer = writeSession(root, "dashboard:two", "new.jsonl", []);
      utimesSync(older, new Date(1_000), new Date(1_000));
      utimesSync(newer, new Date(2_000), new Date(2_000));

      assert.deepEqual(
        store.list(x, { order: "recent" }).map((session) => session.vitoSessionId),
        ["dashboard:two", "dashboard:one"],
      );
      assert.equal(store.count(x, { vitoSessionIds: ["dashboard:one"] }), 1);
      assert.equal(store.list(x, { vitoSessionIds: ["dashboard:one"] }).length, 1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("deletes only safe, explicit regular files", () => {
    const { root, x, store } = createHarness();
    const outside = join(root, "..", `outside-${Date.now()}.jsonl`);
    try {
      writeFileSync(outside, "outside");
      const directory = join(root, "dashboard%3Atest");
      mkdirSync(directory, { recursive: true });
      symlinkSync(outside, join(directory, "link.jsonl"));
      writeSession(root, "dashboard:test", "session.jsonl", []);

      assert.equal(
        store.delete(x, { ids: ["../outside.jsonl", "dashboard%3Atest/link.jsonl"] }),
        0,
      );
      assert.equal(store.delete(x, { ids: ["dashboard%3Atest/session.jsonl"] }), 1);
      assert.equal(store.count(x, {}), 0);
    } finally {
      rmSync(outside, { force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });
});
