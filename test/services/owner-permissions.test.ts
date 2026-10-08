import assert from "node:assert/strict";
import { test } from "node:test";
import { channelOwnerIds } from "../../src/services/channels/owner-permissions.js";

test("unset owners inherit only explicitly allowed user IDs", () => {
  assert.deepEqual(channelOwnerIds({ enabled: true, allowedUserIds: ["Mike"] }), ["Mike"]);
  assert.deepEqual(channelOwnerIds({ enabled: true }), []);
  assert.deepEqual(channelOwnerIds({ enabled: true, allowedUserIds: [] }), []);
  assert.deepEqual(channelOwnerIds(undefined), []);
});
test("explicit owner lists, including an empty list, override fallback", () => {
  assert.deepEqual(
    channelOwnerIds({ enabled: true, ownerIds: ["Owner"], allowedUserIds: ["User"] }),
    ["Owner"],
  );
  assert.deepEqual(channelOwnerIds({ enabled: true, ownerIds: [], allowedUserIds: ["User"] }), []);
});
