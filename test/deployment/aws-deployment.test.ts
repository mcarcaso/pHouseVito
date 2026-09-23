import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const script = readFileSync(resolve("aws_deploy/spinup.sh"), "utf-8");

describe("AWS deployment boundaries", () => {
  it("exposes only HTTPS publicly and restricts SSH", () => {
    assert.match(script, /--port 22 --cidr "\$SSH_CIDR"/);
    assert.match(script, /--port 443 --cidr 0\.0\.0\.0\/0/);
    assert.doesNotMatch(script, /--port 22 --cidr 0\.0\.0\.0\/0/);
    assert.doesNotMatch(script, /--port 80 /);
  });

  it("keeps Vito behind the loopback reverse proxy", () => {
    assert.match(script, /HOST: '127\.0\.0\.1'/);
    assert.match(script, /reverse_proxy 127\.0\.0\.1:3030/);
  });

  it("never makes certificate private keys world-readable", () => {
    assert.doesNotMatch(script, /chmod 644[^\n]*privkey/);
    assert.match(script, /install -o root -g caddy -m 640[^\n]*privkey\.pem/);
  });

  it("keeps the provider key out of terminal echo and SSH arguments", () => {
    assert.match(script, /read -rsp "OpenRouter API key: "/);
    assert.doesNotMatch(script, /bash -s[^\n]*OPENROUTER_API_KEY/);
    assert.match(script, /fs\.chmodSync\(p, 0o600\)/);
  });
});
