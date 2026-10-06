import assert from "node:assert/strict";
import { it } from "node:test";
import { telegramRateLimitRetry } from "../../src/services/channels/telegram/rate-limit.js";

it("honors retry_after before retrying the same API call", async () => {
  const waits: number[] = [];
  let calls = 0;
  const retry = telegramRateLimitRetry(async (ms) => {
    waits.push(ms);
  });
  const result = await retry(
    async () => {
      if (++calls === 1)
        return {
          ok: false,
          error_code: 429,
          description: "limited",
          parameters: { retry_after: 26 },
        };
      return { ok: true, result: true };
    },
    "deleteMessage",
    { chat_id: "1", message_id: 2 },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(waits, [26000]);
  assert.equal(calls, 2);
});

it("bounds repeated rate limits and does not retry other API failures", async () => {
  let calls = 0;
  const retry = telegramRateLimitRetry(async () => {});
  await retry(
    async () => {
      calls++;
      return { ok: false, error_code: 429, description: "limited", parameters: { retry_after: 1 } };
    },
    "deleteMessage",
    { chat_id: "1", message_id: 2 },
  );
  assert.equal(calls, 4);
  calls = 0;
  await retry(
    async () => {
      calls++;
      return { ok: false, error_code: 403, description: "forbidden" };
    },
    "deleteMessage",
    { chat_id: "1", message_id: 2 },
  );
  assert.equal(calls, 1);
});
