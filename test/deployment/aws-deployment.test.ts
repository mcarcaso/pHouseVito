import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const script = readFileSync(resolve("aws_deploy/spinup.sh"), "utf-8");
const deployScript = readFileSync(resolve("aws_deploy/deploy.sh"), "utf-8");

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

describe("managed AWS deployment", () => {
  it("detects target architecture and selects a matching installer", () => {
    assert.match(deployScript, /aarch64\|arm64\) TARGET="linux-arm64"/);
    assert.match(deployScript, /x86_64\|amd64\) TARGET="linux-x64"/);
    assert.match(deployScript, /INSTALLER_NAME="vito-\$\{VERSION\}-\$\{TARGET\}-installer"/);
  });

  it("verifies provenance and rolls back failed health checks", () => {
    assert.match(deployScript, /Artifact revision mismatch/);
    assert.match(deployScript, /Refusing a dirty release artifact/);
    assert.match(deployScript, /New release failed health checks; rolling back/);
    assert.match(deployScript, /rollback "\$root"/);
  });

  it("does not build source on a managed target", () => {
    assert.doesNotMatch(deployScript, /npm ci/);
    assert.doesNotMatch(deployScript, /git pull/);
    assert.match(deployScript, /deploy-source\.sh/);
  });
});
