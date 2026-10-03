import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import { SlackOutputHandler } from "../../src/services/channels/slack/SlackOutputHandler.js";
import { parseSlackTarget, slackMrkdwn } from "../../src/services/channels/slack/slack-messages.js";
import { mockSlackClient } from "../helpers/slack-client.js";

function event(target = "T123:C123:1710000000.000001") {
  return {
    channel: "slack",
    target,
    sessionKey: `slack:${target}`,
    author: "Mike",
    timestamp: 1,
    content: "hello",
    replyTo: "1710000000.000002",
    raw: {},
  };
}
function context(drive = "/tmp/vito-slack-output") {
  return new ObjectContext({
    driveDir: () => drive,
    vitoService: () => ({ getConfig: () => ({ apps: { baseDomain: "vito.example.com" } }) }),
  });
}

test("Slack keeps commentary/final separate, removes temporary progress, and preserves thread destinations", async () => {
  const web = mockSlackClient();
  const handler = new SlackOutputHandler(context(), web.client, event());
  await handler.startTyping();
  await handler.relayEvent({ kind: "thinking", content: "Checking the files" });
  await handler.relayEvent({ kind: "tool_start", toolName: "read", toolCallId: "one" });
  assert.match(web.posts[0].text as string, /Checking the files/);
  assert.match(
    web.posts[0].text as string,
    /<https:\/\/vito.example.com\/chat\/slack%3AT123%3AC123%3A1710000000.000001\|Open conversation>/,
  );
  await handler.relay("💬 **Reading** the configuration.");
  await handler.endMessage();
  assert.equal(web.deletes.length, 1);
  await handler.relay("Final answer.");
  await handler.endMessage();
  await handler.stopTyping();
  assert.equal(web.posts.length, 3);
  assert.equal(web.posts[1].text, "💬 *Reading* the configuration.");
  assert.equal(web.posts[2].text, "Final answer.");
  assert.ok(
    web.posts.every((post) => post.channel === "C123" && post.thread_ts === "1710000000.000001"),
  );
  assert.deepEqual(web.reactions, ["add", "remove"]);
});

test("Slack splits long fenced output without pinging users from raw markup", async () => {
  const web = mockSlackClient();
  const handler = new SlackOutputHandler(context(), web.client, event("T123:C123"));
  await handler.relay(`<!here>\n\n\`\`\`ts\n${"const x = 1;\n".repeat(700)}\`\`\``);
  await handler.endMessage();
  assert.ok(web.posts.length > 1);
  for (const post of web.posts) {
    assert.equal(post.thread_ts, undefined);
    assert.ok((post.text as string).length <= 4000);
    assert.equal(((post.text as string).match(/```/g) || []).length % 2, 0);
    assert.ok(!(post.text as string).includes("<!here>"));
  }
  assert.match(web.posts[0].text as string, /&lt;!here&gt;/);
});

test("Slack uploads MEDIA files to the same thread and falls back only to owned Drive links", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vito-slack-output-"));
  try {
    const drive = join(dir, "drive");
    mkdirSync(drive);
    const file = join(drive, "notes.txt");
    writeFileSync(file, "notes");
    const web = mockSlackClient();
    const handler = new SlackOutputHandler(context(drive), web.client, event());
    await handler.relay(`Before\nMEDIA:${file}\nAfter`);
    await handler.endMessage();
    assert.deepEqual(
      web.posts.map((post) => post.text),
      ["Before", "After"],
    );
    assert.equal(web.uploads[0].file, file);
    assert.equal(web.uploads[0].channel_id, "C123");
    assert.equal(web.uploads[0].thread_ts, "1710000000.000001");
    web.client.filesUploadV2 = async () => {
      throw new Error("Upload failed");
    };
    await handler.relay(`MEDIA:${file}`);
    await handler.endMessage();
    assert.match(
      web.posts.at(-1)!.text as string,
      /https:\/\/vito.example.com\/api\/drive\/file\/notes.txt/,
    );
    const external = join(dir, "outside.txt");
    writeFileSync(external, "external");
    await handler.relay(`MEDIA:${external}`);
    await assert.rejects(handler.endMessage(), /Upload failed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Slack destination and markdown mapping preserve code and links", () => {
  assert.deepEqual(parseSlackTarget("T123:D123"), {
    team: "T123",
    channel: "D123",
    thread: undefined,
  });
  assert.throws(() => parseSlackTarget("another-channel"), /Invalid Slack target/);
  assert.equal(
    slackMrkdwn("**bold** `**literal**` [Link](https://example.com)"),
    "*bold* `**literal**` <https://example.com|Link>",
  );
});
