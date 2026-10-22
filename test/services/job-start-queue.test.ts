import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readdirSync, writeFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { enqueueJobStart, consumeJobStarts } from "../../src/services/jobs/JobStartQueue.js";

it("hands off starts once, without running a prompt in the caller", () => {
  const root = mkdtempSync(join(tmpdir(), "vito-job-start-"));
  try {
    const id = enqueueJobStart(root, "monitor");
    const starts: string[] = [];
    assert.match(id, /^[a-f0-9-]+$/);
    consumeJobStarts(root, (name) => {
      starts.push(name);
    });
    consumeJobStarts(root, (name) => {
      starts.push(name);
    });
    assert.deepEqual(starts, ["monitor"]);
    assert.deepEqual(readdirSync(join(root, "jobs", "start-requests")), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("does not replay uncertain claimed starts or incomplete writes", () => {
  const root = mkdtempSync(join(tmpdir(), "vito-job-start-"));
  try {
    const id = enqueueJobStart(root, "monitor");
    const dir = join(root, "jobs", "start-requests");
    writeFileSync(join(dir, "abc.tmp"), "unfinished");
    // Simulate a server crash after claiming and before acknowledging the request.
    renameSync(join(dir, `${id}.json`), join(dir, `${id}.json.claimed`));
    consumeJobStarts(root, () => assert.fail("uncertain start replayed"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("jobs run returns a queued request without executing or waiting on the script", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const root = mkdtempSync(join(tmpdir(), "vito-job-run-cli-"));
  try {
    const script = join(root, "monitor.ts");
    writeFileSync(
      script,
      'export default async function() { throw new Error("must execute in server, not CLI"); }',
    );
    writeFileSync(
      join(root, "vito.config.json"),
      JSON.stringify({
        settings: {},
        channels: {},
        sessions: {},
        cron: {
          jobs: [
            {
              name: "monitor",
              script,
              schedule: { cron: "0 9 * * *", timezone: "America/Toronto" },
              enabled: true,
              timeoutMs: 5000,
              delivery: { channel: "discord", target: "room" },
            },
          ],
        },
      }),
    );
    const cli = new URL("../../src/cli/commands/jobs.ts", import.meta.url).href;
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `const { runJobsCommand } = await import(${JSON.stringify(cli)}); process.exitCode = await runJobsCommand(["run", "monitor", "--json", "--user-dir", ${JSON.stringify(root)}], process.cwd());`,
      ],
      { timeout: 15000 },
    );
    const result = JSON.parse(stdout.trim().split("\n").at(-1)!);
    assert.equal(result.state, "queued");
    assert.equal(result.name, "monitor");
    const starts: string[] = [];
    consumeJobStarts(root, (name) => {
      starts.push(name);
    });
    assert.deepEqual(starts, ["monitor"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
