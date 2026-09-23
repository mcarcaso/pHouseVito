import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { spawnSync } from "node:child_process";

const projectRoot = process.cwd();
const tempDir = mkdtempSync(join(tmpdir(), "vito-cli-"));

function runVito(args: string[], input?: string) {
  return spawnSync(resolve(projectRoot, "vito"), args, {
    cwd: projectRoot,
    encoding: "utf-8",
    input,
  });
}

after(() => rmSync(tempDir, { recursive: true, force: true }));

describe("Vito CLI", () => {
  it("shows top-level, app, and memory command help", () => {
    const topLevel = runVito(["--help"]);
    assert.equal(topLevel.status, 0);
    assert.match(topLevel.stdout, /config\s+Validate Vito configuration/);

    const apps = runVito(["apps", "--help"]);
    assert.equal(apps.status, 0);
    assert.match(apps.stdout, /vito apps/);

    const memory = runVito(["memory", "--help"]);
    assert.equal(memory.status, 0);
    assert.match(memory.stdout, /vito memory search/);

    const importer = runVito(["import-vito-next", "--help"]);
    assert.equal(importer.status, 0);
    assert.match(importer.stdout, /offline one-time import/i);
  });

  it("validates a config through the stable command", () => {
    const result = runVito(["config", "validate", "user.example/vito.config.json"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Valid Vito config/);
  });

  it("atomically migrates legacy Pi configuration", () => {
    const path = join(tempDir, "legacy.json");
    writeFileSync(
      path,
      JSON.stringify({
        settings: { harness: "pi-coding-agent", streamMode: "final" },
        harnesses: {
          "pi-coding-agent": {
            model: { provider: "openrouter", name: "legacy-model" },
          },
        },
        channels: {},
        sessions: { default: { harness: "pi-coding-agent" } },
        cron: { jobs: [] },
      }),
      "utf-8",
    );

    const result = runVito(["config", "migrate", path]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Migrated Vito config/);
    const migrated: unknown = JSON.parse(readFileSync(path, "utf-8"));
    assert.deepEqual(migrated, {
      settings: {
        streamMode: "final",
        "pi-coding-agent": {
          model: { provider: "openrouter", name: "legacy-model" },
        },
      },
      channels: {},
      sessions: { default: {} },
      cron: { jobs: [] },
    });

    const secondRun = runVito(["config", "migrate", path]);
    assert.equal(secondRun.status, 0, secondRun.stderr);
    assert.match(secondRun.stdout, /already current/);
  });

  it("returns a failure for malformed configuration", () => {
    const path = join(tempDir, "invalid.json");
    writeFileSync(path, "{not json", "utf-8");
    const result = runVito(["config", "validate", path]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Invalid Vito config/);
    assert.match(result.stderr, /<root>/);
  });

  it("rejects malformed memory search arguments before opening storage", () => {
    const result = runVito(["memory", "search", "query", "--limit", "0"]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /greater than or equal to 1/);
  });

  it("sets and lists secrets without printing values", () => {
    const path = join(tempDir, "cli-secrets.json");
    const set = runVito(
      ["secrets", "set", "CLI_TEST_SECRET", "--stdin", "--json", "--file", path],
      "raw-secret-value\n",
    );
    assert.equal(set.status, 0, set.stderr);
    assert.deepEqual(JSON.parse(set.stdout), {
      key: "CLI_TEST_SECRET",
      configured: true,
      system: false,
    });
    assert.equal(`${set.stdout}${set.stderr}`.includes("raw-secret-value"), false);
    assert.equal(statSync(path).mode & 0o777, 0o600);

    const list = runVito(["secrets", "list", "--json", "--file", path]);
    assert.equal(list.status, 0, list.stderr);
    const entries = JSON.parse(list.stdout) as Array<Record<string, unknown>>;
    assert.ok(
      entries.some((entry) => entry.key === "CLI_TEST_SECRET" && entry.configured === true),
    );
    assert.equal(list.stdout.includes("raw-secret-value"), false);
    assert.equal(
      entries.some((entry) => "value" in entry),
      false,
    );

    const unconfirmed = runVito(["secrets", "remove", "CLI_TEST_SECRET", "--file", path]);
    assert.equal(unconfirmed.status, 1);
    assert.match(unconfirmed.stderr, /requires --yes/);

    const remove = runVito([
      "secrets",
      "remove",
      "CLI_TEST_SECRET",
      "--yes",
      "--json",
      "--file",
      path,
    ]);
    assert.equal(remove.status, 0, remove.stderr);
    assert.deepEqual(JSON.parse(remove.stdout), { key: "CLI_TEST_SECRET", removed: true });
  });

  it("manages and runs script-first jobs without channel delivery", () => {
    const userDir = join(tempDir, "jobs-user");
    const script = join(tempDir, "cli-job.ts");
    const definition = join(tempDir, "cli-job.json");
    mkdirSync(userDir, { recursive: true });
    writeFileSync(
      join(userDir, "vito.config.json"),
      readFileSync(join(projectRoot, "user.example", "vito.config.json"), "utf-8"),
    );
    writeFileSync(
      script,
      'export default async function () { console.log("ran"); return "done"; }\n',
    );
    writeFileSync(
      definition,
      JSON.stringify({
        name: "cli-job",
        script,
        schedule: { cron: "0 9 * * *", timezone: "UTC" },
        enabled: true,
      }),
    );

    const save = runVito(["jobs", "save", definition, "--user-dir", userDir, "--json"]);
    assert.equal(save.status, 0, save.stderr);
    assert.equal(JSON.parse(save.stdout).name, "cli-job");

    const pause = runVito(["jobs", "pause", "cli-job", "--user-dir", userDir, "--json"]);
    assert.equal(pause.status, 0, pause.stderr);
    assert.equal(JSON.parse(pause.stdout).enabled, false);

    const run = runVito(["jobs", "run", "cli-job", "--user-dir", userDir, "--json"]);
    assert.equal(run.status, 0, run.stderr);
    const outcome = JSON.parse(run.stdout) as { state: string; result: { text: string } };
    assert.equal(outcome.state, "completed");
    assert.equal(outcome.result.text, "done");

    const history = runVito(["jobs", "history", "cli-job", "--user-dir", userDir, "--json"]);
    assert.equal(history.status, 0, history.stderr);
    assert.equal(JSON.parse(history.stdout).length, 1);

    const configPath = join(userDir, "vito.config.json");
    const config = JSON.parse(readFileSync(configPath, "utf-8")) as {
      cron: { jobs: unknown[] };
    };
    config.cron.jobs.push({
      name: "legacy-job",
      schedule: "30 8 * * *",
      timezone: "UTC",
      session: "dashboard:legacy",
      prompt: "Legacy prompt",
      sendCondition: "Only when useful",
    });
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    const convert = runVito(["jobs", "convert", "legacy-job", "--user-dir", userDir, "--json"]);
    assert.equal(convert.status, 0, convert.stderr);
    const converted = JSON.parse(convert.stdout) as Array<{ script: string; delivery: unknown }>;
    assert.equal(converted.length, 1);
    assert.match(readFileSync(converted[0].script, "utf-8"), /job\.prompt/);
    assert.deepEqual(converted[0].delivery, { channel: "dashboard", target: "legacy" });
  });

  it("returns a usage error for unknown commands", () => {
    const result = runVito(["unknown"]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Unknown command/);
  });
});
