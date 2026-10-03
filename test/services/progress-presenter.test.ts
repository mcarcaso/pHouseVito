import assert from "node:assert/strict";
import { test } from "node:test";
import { ProgressPresenter } from "../../src/lib/output/ProgressPresenter.js";

function fixture() {
  const posts: string[] = [];
  const edits: string[] = [];
  const deleted: unknown[] = [];
  const presenter = new ProgressPresenter(
    {
      sendProgress: async (text) => {
        posts.push(text);
        return posts.length;
      },
      editProgress: async (_handle, text) => {
        edits.push(text);
      },
      deleteProgress: async (handle) => {
        deleted.push(handle);
      },
    },
    "https://vito.example/chat/test",
  );
  return { presenter, posts, edits, deleted };
}

test("tool-only activity shows fallback, elapsed time, tool status and conversation link", async () => {
  const f = fixture();
  await f.presenter.onEvent({ kind: "thinking", activity: "thinking" });
  assert.equal(f.posts.length, 0);
  await f.presenter.onEvent({ kind: "tool_start", toolName: "read", toolCallId: "one" });
  assert.match(f.posts[0], /Working…/);
  assert.match(f.posts[0], /\d+s · Reading · 1 tool/);
  assert.match(f.posts[0], /◌ Read file…/);
  assert.match(f.posts[0], /Open conversation: https:\/\/vito.example\/chat\/test/);
  await f.presenter.close();
});

test("throttled updates show tool completion, failure, and later provider summary", async () => {
  const f = fixture();
  await f.presenter.onEvent({ kind: "tool_start", toolName: "read", toolCallId: "one" });
  await f.presenter.onEvent({ kind: "tool_end", toolCallId: "one" });
  await f.presenter.onEvent({ kind: "tool_start", toolName: "bash", toolCallId: "two" });
  await f.presenter.onEvent({ kind: "tool_end", toolCallId: "two", isError: true });
  await f.presenter.onEvent({ kind: "thinking", content: "Checking the result" });
  await new Promise((resolve) => setTimeout(resolve, 2100));
  assert.equal(f.posts.length, 1);
  assert.equal(f.edits.length, 1);
  assert.match(f.edits[0], /Checking the result/);
  assert.match(f.edits[0], /✓ Read file/);
  assert.match(f.edits[0], /✕ Run command/);
  await f.presenter.close();
});

test("clear cancels pending updates and next tool recreates fallback; close prevents resurrection", async () => {
  const f = fixture();
  await f.presenter.onEvent({ kind: "thinking", content: "Old summary" });
  await f.presenter.onEvent({ kind: "tool_start", toolName: "read", toolCallId: "one" });
  await f.presenter.clear();
  assert.deepEqual(f.deleted, [1]);
  await f.presenter.onEvent({ kind: "thinking", activity: "responding" });
  await new Promise((resolve) => setTimeout(resolve, 2100));
  assert.equal(f.edits.length, 0);
  assert.equal(f.posts.length, 1);
  await f.presenter.onEvent({ kind: "tool_start", toolName: "bash", toolCallId: "two" });
  assert.equal(f.posts.length, 2);
  assert.match(f.posts[1], /Working…/);
  assert.doesNotMatch(f.posts[1], /Old summary/);
  await f.presenter.close();
  await f.presenter.onEvent({ kind: "tool_start", toolName: "read", toolCallId: "three" });
  assert.equal(f.posts.length, 2);
});
