import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
// @ts-expect-error Deployment helper runs directly as JavaScript.
import { provisionPush } from "../../aws_deploy/provision-push.mjs";

const pushKey = `vpk_live_${"a".repeat(43)}`;

test("push provisioning skips absent or empty .env credentials", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vito-push-test-"));
  try {
    const env = join(dir, ".env");
    const output = join(dir, "secrets");
    const fetcher = () => {
      throw new Error("Must not call gateway");
    };
    assert.equal(await provisionPush(env, output, "test", fetcher), false);
    writeFileSync(env, 'PHOUSE_VITO_PUSH_API_KEY="  "\n');
    assert.equal(await provisionPush(env, output, "test", fetcher), false);
    assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("push provisioning uses dotenv credentials and writes both secrets privately", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vito-push-test-"));
  try {
    const env = join(dir, ".env");
    const output = join(dir, "secrets");
    writeFileSync(env, 'export PHOUSE_VITO_PUSH_API_KEY="service-key" # comment\n');
    const fetcher = async (url: string, options: RequestInit) => {
      assert.equal(url, "https://kdxjux37p8.execute-api.us-east-1.amazonaws.com/v1/accounts");
      assert.equal(options.method, "POST");
      assert.equal((options.headers as Record<string, string>)["x-api-key"], "service-key");
      assert.deepEqual(JSON.parse(options.body as string), { displayName: "test" });
      return Response.json({ pushKey }, { status: 201 });
    };
    assert.equal(await provisionPush(env, output, "test", fetcher), true);
    assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), {
      PHOUSE_VITO_PUSH_API_KEY: "service-key",
      PHOUSE_VITO_PUSH_KEY: pushKey,
    });
    assert.equal(statSync(output).mode & 0o777, 0o600);
    for (const response of [
      new Response("secret-error", { status: 401 }),
      Response.json({ pushKey: "bad" }),
      new Response("not-json"),
    ]) {
      await assert.rejects(
        provisionPush(env, output, "test", async () => response),
        /Push account creation/,
      );
    }
    await assert.rejects(
      provisionPush(env, output, "test", async () => {
        throw new Error("secret-error");
      }),
      /gateway unreachable/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
