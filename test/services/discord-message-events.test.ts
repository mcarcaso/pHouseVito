import assert from "node:assert/strict";
import { test } from "node:test";
import { MessageType } from "discord.js";
import { isConversationMessage } from "../../src/services/channels/discord/message-events.js";

test("Discord allows only authored normal messages and replies", () => {
  for (const type of Object.values(MessageType)) {
    assert.equal(
      isConversationMessage(type),
      type === MessageType.Default || type === MessageType.Reply,
      String(type),
    );
  }
  for (const type of [undefined, null, -1, 999999, "0", {}, true]) {
    assert.equal(isConversationMessage(type), false);
  }
  assert.equal(isConversationMessage(MessageType.ThreadCreated), false);
  assert.equal(isConversationMessage(MessageType.ChannelNameChange), false);
  assert.equal(isConversationMessage(MessageType.Default), true); // attachments-only posts
});
