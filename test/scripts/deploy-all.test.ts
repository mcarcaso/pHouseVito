import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("deploy-all runs concurrently, saves escaped live panes and logs, and reports failures", () => {
  const dir = mkdtempSync(join(tmpdir(), "vito-deploy-all-"));
  try {
    for (const file of ["deploy-all.sh", "deploy-dashboard.mjs"]) {
      copyFileSync(new URL(`../../aws_deploy/${file}`, import.meta.url), join(dir, file));
    }
    mkdirSync(join(dir, "state"));
    writeFileSync(join(dir, "state", "first.json"), "{}");
    writeFileSync(
      join(dir, "deploy.sh"),
      `#!/usr/bin/env bash
set -eu
cd "$(dirname "$0")"
touch "state/$1.started"
for i in $(seq 1 100); do
  if [ -f state/first.started ] && [ -f state/second.started ]; then break; fi
  sleep 0.02
done
[ -f state/first.started ] && [ -f state/second.started ] || exit 9
node -e 'const fs=require("fs");const p="state/deploy-logs/"+fs.readdirSync("state/deploy-logs")[0]+"/index.html";for(let i=0;i<100&&!fs.existsSync(p);i++)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20);if(!fs.readFileSync(p,"utf8").includes("http-equiv=\\"refresh\\""))process.exit(8);'
echo '<script>unsafe</script>'
echo "$1 done"
[ "$1" != second ]
`,
      { mode: 0o700 },
    );
    const result = spawnSync("bash", [join(dir, "deploy-all.sh"), "first", "second", "first"], {
      encoding: "utf8",
      timeout: 15000,
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Failed deployments: second/);
    assert.match(result.stdout, /\[first\] Deployment succeeded/);
    const runs = join(dir, "state", "deploy-logs");
    const run = join(runs, readdirSync(runs)[0]);
    const html = readFileSync(join(run, "index.html"), "utf8");
    assert.match(html, /&lt;script&gt;unsafe&lt;\/script&gt;/);
    assert.match(html, /Finished · logs saved/);
    assert.match(html, /class="succeeded"/);
    assert.match(html, /class="failed"/);
    assert.doesNotMatch(html, /http-equiv="refresh"/);
    assert.equal((html.match(/<section>/g) || []).length, 2);
    assert.match(readFileSync(join(run, "second.log"), "utf8"), /second done/);
    const cancelled = spawnSync("bash", [join(dir, "deploy-all.sh")], {
      encoding: "utf8",
      input: "no\n",
    });
    assert.equal(cancelled.status, 0);
    assert.match(cancelled.stdout, /Deployment cancelled/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
