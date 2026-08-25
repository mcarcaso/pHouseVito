import assert from "node:assert/strict";
import test from "node:test";
import messageContent from "../../mobile/src/screens/chat/message-content.ts";

const { unpackMessageContent } = messageContent;

test("parses MEDIA paths into native chat image attachments", () => {
  const body = unpackMessageContent(
    JSON.stringify(
      "A proper feline watering hole, boss.\n\nMEDIA:/Users/mike/vito3.0/user/drive/images/gemini/cat-bar.png",
    ),
  );

  assert.equal(body.text, "A proper feline watering hole, boss.");
  assert.deepEqual(body.attachments, [
    {
      type: "image",
      path: "/Users/mike/vito3.0/user/drive/images/gemini/cat-bar.png",
      filename: "cat-bar.png",
      mimeType: "image/png",
    },
  ]);
});

test("merges MEDIA paths with structured attachments without duplicates", () => {
  const path = "/Users/mike/vito3.0/user/drive/images/example.webp";
  const body = unpackMessageContent(
    JSON.stringify({
      text: `Before\nMEDIA: ${path}\n\nAfter`,
      attachments: [{ type: "image", path, filename: "example.webp" }],
    }),
  );

  assert.equal(body.text, "Before\n\nAfter");
  assert.equal(body.attachments.length, 1);
});

test("leaves inline MEDIA text alone", () => {
  const text = "The protocol is MEDIA:/absolute/path on its own line.";
  assert.deepEqual(unpackMessageContent(text), { text, attachments: [] });
});
