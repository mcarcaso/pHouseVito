import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import {
  importVitoNext,
  type VitoNextImportManifest,
} from "../../src/migration/VitoNextImporter.js";

const roots: string[] = [];
after(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

function database(path: string, sql: string): Database.Database {
  const db = new Database(path);
  db.pragma("journal_mode = DELETE");
  db.exec(sql);
  return db;
}

function fixture(deliveryOperation = "discord.deliver") {
  const root = mkdtempSync(join(tmpdir(), "vito-next-import-"));
  roots.push(root);
  const source = join(root, "source");
  mkdirSync(source);
  const history = join(source, "history.sqlite");
  const historyDb = database(
    history,
    "CREATE TABLE messages(id INTEGER PRIMARY KEY,session TEXT,entry TEXT,parent TEXT,timestamp TEXT,role TEXT,text TEXT,UNIQUE(session,entry));",
  );
  historyDb
    .prepare("INSERT INTO messages VALUES(?,?,?,?,?,?,?)")
    .run(10, "session-a", "entry-a", null, "2026-09-20T10:00:00.000Z", "user", "Remember this");
  historyDb
    .prepare("INSERT INTO messages VALUES(?,?,?,?,?,?,?)")
    .run(20, "session-b", "entry-b", "entry-a", "2026-09-21T11:00:00.000Z", "assistant", "I will");
  historyDb.close();

  const memory = join(source, "memory.sqlite");
  const memoryDb = database(
    memory,
    `CREATE TABLE chunks(id INTEGER PRIMARY KEY,session TEXT,day TEXT,text TEXT,context TEXT,vector TEXT,model TEXT,payload TEXT);
     CREATE TABLE sources(chunk INTEGER,message INTEGER,start INTEGER,end INTEGER,UNIQUE(message,start));
     CREATE VIRTUAL TABLE search USING fts5(text,context);
     CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT);
     CREATE TABLE legacy_ranges(chunk INTEGER PRIMARY KEY,firstMessage INTEGER,lastMessage INTEGER,messageCount INTEGER,unresolved INTEGER NOT NULL);`,
  );
  memoryDb
    .prepare("INSERT INTO chunks VALUES(?,?,?,?,?,?,?,?)")
    .run(
      5,
      "session-a",
      "2026-09-20",
      "Remember this",
      "A memory",
      JSON.stringify([0.25, -0.5]),
      "text-embedding-3-small",
      null,
    );
  memoryDb.prepare("INSERT INTO sources VALUES(?,?,?,?)").run(5, 10, 0, 13);
  memoryDb
    .prepare("INSERT INTO search(rowid,text,context) VALUES(?,?,?)")
    .run(5, "Remember this", "A memory");
  memoryDb
    .prepare("INSERT INTO settings VALUES('embedding',?)")
    .run(JSON.stringify(["https://api.openai.com/v1", "text-embedding-3-small"]));
  memoryDb.close();

  const facts = join(source, "facts.sqlite");
  const factsDb = database(
    facts,
    `CREATE TABLE facts(id INTEGER PRIMARY KEY,claim TEXT,status TEXT,created TEXT,set_id TEXT,fingerprint TEXT,metadata TEXT);
     CREATE TABLE evidence(fact INTEGER,message INTEGER,session TEXT,quote TEXT,observed TEXT,messageType TEXT,provenance TEXT);
     CREATE TABLE revisions(id INTEGER PRIMARY KEY,fact INTEGER,action TEXT,target INTEGER,message INTEGER,timestamp TEXT,reason TEXT);
     CREATE TABLE fact_sets(id TEXT PRIMARY KEY,title TEXT,created TEXT);
     CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT);
     CREATE TABLE coverage(set_id TEXT,version TEXT,message INTEGER);
     CREATE TABLE vectors(fact INTEGER,model TEXT,vector TEXT);
     CREATE TABLE extraction_decisions(id INTEGER PRIMARY KEY,set_id TEXT,version TEXT,chunk INTEGER,message INTEGER,action TEXT,target INTEGER,reason TEXT,candidate TEXT);
     CREATE TABLE chunk_runs(set_id TEXT,version TEXT,chunk INTEGER,state TEXT,attempts INTEGER,error TEXT,completed TEXT);
     CREATE TABLE vector_models(model TEXT PRIMARY KEY,dimensions INTEGER);`,
  );
  factsDb
    .prepare("INSERT INTO fact_sets VALUES(?,?,?)")
    .run("v4", "Facts", "2026-09-20T10:00:00.000Z");
  factsDb.prepare("INSERT INTO settings VALUES('activeSet','v4')").run();
  factsDb.prepare("INSERT INTO facts VALUES(?,?,?,?,?,?,?)").run(
    7,
    "Mike remembers this.",
    "active",
    "2026-09-20T10:00:00.000Z",
    "v4",
    "fact-7",
    JSON.stringify({
      kind: "state",
      slotKey: "memory.test",
      canonicalValue: "yes",
      authority: "user_explicit",
      validFrom: null,
      validTo: null,
      observed: "2026-09-20T10:00:00.000Z",
      updated: "2026-09-20T10:00:00.000Z",
      supersedesFactId: null,
      entities: ["Mike"],
    }),
  );
  factsDb
    .prepare("INSERT INTO evidence VALUES(?,?,?,?,?,?,?)")
    .run(7, 10, "session-a", "Remember this", "2026-09-20T10:00:00.000Z", "user", null);
  factsDb
    .prepare("INSERT INTO vectors VALUES(?,?,?)")
    .run(7, "text-embedding-3-small", JSON.stringify([0.5, 0.75]));
  factsDb
    .prepare("INSERT INTO chunk_runs VALUES(?,?,?,?,?,?,?)")
    .run(
      "v4",
      "atomic-facts-v4-semantic-reconciliation",
      5,
      "completed",
      1,
      null,
      "2026-09-20T10:01:00.000Z",
    );
  factsDb.prepare("INSERT INTO vector_models VALUES(?,?)").run("text-embedding-3-small", 2);
  factsDb.close();

  const script = join(source, "daily.ts");
  writeFileSync(script, "export default async () => 'done';\n");
  const jobs = join(source, "jobs.sqlite");
  const jobsDb = database(
    jobs,
    `CREATE TABLE jobs(name TEXT PRIMARY KEY,data TEXT,next_at TEXT,manual INTEGER DEFAULT 0,timezone TEXT);
     CREATE TABLE runs(id TEXT PRIMARY KEY,name TEXT,state TEXT,started TEXT,delivery TEXT,retry_at TEXT,data TEXT,cancelled INTEGER DEFAULT 0);
     CREATE TABLE prompts(run TEXT,key TEXT PRIMARY KEY,session TEXT);`,
  );
  const job = {
    name: "daily",
    script,
    schedule: { cron: "0 9 * * *", timezone: "UTC" },
    session: "session-a",
    delivery: { operation: deliveryOperation, input: { channel: "123" } },
    timeoutMs: 300000,
    enabled: true,
  };
  jobsDb
    .prepare("INSERT INTO jobs VALUES(?,?,?,?,?)")
    .run("daily", JSON.stringify(job), "2026-09-24T09:00:00.000Z", 0, "UTC");
  jobsDb.prepare("INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)").run(
    "run-1",
    "daily",
    "running",
    "2026-09-23T09:00:00.000Z",
    "pending",
    null,
    JSON.stringify({
      id: "run-1",
      job,
      scheduledAt: "2026-09-23T09:00:00.000Z",
      startedAt: "2026-09-23T09:00:00.000Z",
      finishedAt: null,
      state: "running",
      result: null,
      error: null,
    }),
    0,
  );
  jobsDb.prepare("INSERT INTO prompts VALUES(?,?,?)").run("run-1", "prompt-1", "session-a");
  jobsDb.close();

  const discord = join(source, "discord.sqlite");
  const discordDb = database(
    discord,
    `CREATE TABLE conversations(id TEXT PRIMARY KEY,seen TEXT,cursor TEXT);
     CREATE TABLE messages(id TEXT PRIMARY KEY,channel TEXT,data TEXT,invoke INTEGER,batch TEXT);
     CREATE TABLE deliveries(id TEXT PRIMARY KEY,fingerprint TEXT,pieces TEXT,next INTEGER);
     CREATE TABLE batches(id TEXT PRIMARY KEY,channel TEXT,through TEXT,prompt TEXT,pieces TEXT,next INTEGER,done INTEGER,responseMode TEXT);
     CREATE TABLE steering_choices(batch TEXT,input TEXT,notice TEXT,selected INTEGER);`,
  );
  discordDb.prepare("INSERT INTO conversations VALUES(?,?,?)").run("123", "101", "100");
  discordDb
    .prepare("INSERT INTO messages VALUES(?,?,?,?,?)")
    .run("101", "123", JSON.stringify({ id: "101", channel: "123" }), 1, null);
  discordDb
    .prepare("INSERT INTO deliveries VALUES(?,?,?,?)")
    .run("delivery-1", "fingerprint", "[]", 0);
  discordDb.close();

  const usage = join(source, "usage.sqlite");
  const usageDb = database(
    usage,
    "CREATE TABLE usage(session TEXT,entry TEXT,timestamp TEXT,provider TEXT,model TEXT,data TEXT,PRIMARY KEY(session,entry));",
  );
  usageDb
    .prepare("INSERT INTO usage VALUES(?,?,?,?,?,?)")
    .run(
      "session-a",
      "entry-a",
      "2026-09-20T10:00:00.000Z",
      "openai-codex",
      "gpt-test",
      JSON.stringify({ input: 10, output: 2 }),
    );
  usageDb.close();

  const sessions = join(source, "sessions");
  const controls = join(source, "controls");
  mkdirSync(sessions);
  mkdirSync(controls);
  writeFileSync(
    join(sessions, "session-a.jsonl"),
    `${JSON.stringify({ type: "session", id: "session-a", timestamp: "2026-09-20T10:00:00.000Z", cwd: "/tmp" })}\n${JSON.stringify({ type: "model_change", provider: "openai-codex", modelId: "gpt-session" })}\n${JSON.stringify({ type: "thinking_level_change", thinkingLevel: "low" })}\n`,
  );
  writeFileSync(
    join(sessions, "session-b.jsonl"),
    `${JSON.stringify({ type: "session", id: "session-b", timestamp: "2026-09-21T11:00:00.000Z", cwd: "/tmp" })}\n`,
  );
  writeFileSync(
    join(sessions, "session-c.jsonl"),
    `${JSON.stringify({ type: "session", id: "session-c", timestamp: "2026-09-19T10:00:00.000Z", cwd: "/tmp" })}\n`,
  );
  writeFileSync(
    join(controls, "scope-discord-123.json"),
    JSON.stringify(["session-a", "session-b"]),
  );
  const names = join(source, "names.json");
  writeFileSync(
    names,
    JSON.stringify({
      "discord-123": "session-a",
      "discord-999": "session-c",
    }),
  );
  const profile = join(source, "profile.md");
  writeFileSync(profile, "# Mike\nExact profile.\n");
  const config = join(source, "config.json");
  writeFileSync(
    config,
    JSON.stringify({
      settings: { timezone: "Europe/Zagreb" },
      model: "openai-codex/gpt-global",
      apps: {
        discord: {
          enabled: true,
          source: "private",
          config: {
            allowedChannels: ["123"],
            allowedUsers: ["mike"],
            dms: false,
            requireMention: false,
            responseMode: "stream",
            channels: { "123": { requireMention: true, responseMode: "final" } },
          },
        },
      },
    }),
  );
  const attachments = join(source, "outbox");
  mkdirSync(attachments);
  writeFileSync(join(attachments, "abc-0"), "attachment bytes");

  const manifest: VitoNextImportManifest = {
    version: 1,
    history,
    semanticMemory: memory,
    facts,
    jobs,
    discord,
    usage,
    profile,
    config,
    sessions,
    controls,
    sessionNames: names,
    discordAttachments: attachments,
    embedding: { model: "text-embedding-3-small", dimensions: 2 },
  };
  const manifestPath = join(root, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest));
  return { root, manifestPath, script };
}

function open(path: string) {
  return new Database(path, { readonly: true });
}

describe("Vito Next importer", () => {
  it("imports a complete offline snapshot once with stable mappings and no replay", () => {
    const { root, manifestPath, script } = fixture();
    const destination = join(root, "imported-user");
    const options = {
      manifestPath,
      destination,
      templateConfigPath: resolve("user.example/vito.config.json"),
    };
    const report = importVitoNext(options);
    assert.equal(report.state, "imported");
    assert.equal(report.counts.historyMessages, 2);
    assert.deepEqual(report.warnings, [
      "Ignored stale session name discord-999: session-c is not in a current Discord scope",
      "Preserved staged Discord outbox files under legacy/discord-outbox; they will not be delivered automatically",
    ]);
    assert.equal(report.mappings.sessions["session-a"], "discord:123");
    const currentPiPath = join(destination, "pi-sessions", "discord%3A123", "session-a.jsonl");
    assert.ok(existsSync(currentPiPath));
    assert.ok(
      statSync(currentPiPath).mtimeMs >
        statSync(join(destination, "pi-sessions", "discord%3A123", "session-b.jsonl")).mtimeMs,
    );
    assert.equal(readFileSync(join(destination, "profile.md"), "utf8"), "# Mike\nExact profile.\n");
    assert.equal(
      readFileSync(join(destination, "legacy", "discord-outbox", "abc-0"), "utf8"),
      "attachment bytes",
    );

    const core = open(join(destination, "vito.db"));
    assert.deepEqual(
      core.prepare("SELECT id,channel,channel_target FROM sessions ORDER BY id").all(),
      [
        { id: "discord:123", channel: "discord", channel_target: "123" },
        { id: "session-c", channel: "import", channel_target: "" },
      ],
    );
    assert.deepEqual(core.prepare("SELECT id,session_id,type FROM messages ORDER BY id").all(), [
      { id: 10, session_id: "discord:123", type: "user" },
      { id: 20, session_id: "discord:123", type: "assistant" },
    ]);
    assert.equal(
      (core.prepare("SELECT status FROM discord_inbox WHERE id='101'").get() as { status: string })
        .status,
      "interrupted",
    );
    const run = JSON.parse(
      (core.prepare("SELECT data FROM job_runs WHERE id='run-1'").get() as { data: string }).data,
    );
    assert.equal(run.state, "interrupted");
    assert.equal(run.delivery, "unknown");
    assert.deepEqual(run.promptSessions, ["discord:123"]);
    assert.equal(
      (core.prepare("SELECT COUNT(*) count FROM token_usage").get() as { count: number }).count,
      1,
    );
    core.close();

    const embeddings = open(join(destination, "embeddings.db"));
    assert.equal(
      (
        embeddings.prepare("SELECT session_id FROM chunks WHERE id=5").get() as {
          session_id: string;
        }
      ).session_id,
      "discord:123",
    );
    assert.equal(
      (
        embeddings.prepare("SELECT canonical_text FROM facts WHERE id=7").get() as {
          canonical_text: string;
        }
      ).canonical_text,
      "Mike remembers this.",
    );
    assert.equal(
      (embeddings.prepare("SELECT COUNT(*) count FROM fact_embeddings").get() as { count: number })
        .count,
      1,
    );
    embeddings.close();

    const config = JSON.parse(readFileSync(join(destination, "vito.config.json"), "utf8"));
    assert.equal(config.settings.timezone, "Europe/Zagreb");
    assert.deepEqual(config.channels.discord.allowedUserIds, ["mike"]);
    assert.equal(config.channels.discord.allowDms, false);
    assert.equal(config.sessions["discord:123"].requireMention, true);
    assert.equal("streamMode" in config.sessions["discord:123"], false);
    assert.equal(config.sessions["discord:123"]["pi-coding-agent"].model.name, "gpt-session");
    assert.equal(config.sessions["discord:123"]["pi-coding-agent"].thinkingLevel, "low");
    assert.equal(config.cron.jobs[0].script, join(destination, "jobs", "daily.ts"));
    assert.deepEqual(config.cron.jobs[0].delivery, { channel: "discord", target: "123" });

    const repeated = importVitoNext(options);
    assert.equal(repeated.state, "already-imported");

    writeFileSync(script, "export default async () => 'changed';\n");
    assert.throws(() => importVitoNext(options), /destination belongs to a different import/);
  });

  it("refuses an unsupported delivery without leaving partial output", () => {
    const { root, manifestPath } = fixture("mail.send");
    const destination = join(root, "refused");
    assert.throws(
      () =>
        importVitoNext({
          manifestPath,
          destination,
          templateConfigPath: resolve("user.example/vito.config.json"),
        }),
      /job daily has unsupported delivery mail\.send/,
    );
    assert.equal(existsSync(destination), false);
  });

  it("dry-runs the complete conversion without publishing a destination", () => {
    const { root, manifestPath } = fixture();
    const destination = join(root, "dry-run");
    const report = importVitoNext({
      manifestPath,
      destination,
      templateConfigPath: resolve("user.example/vito.config.json"),
      dryRun: true,
    });
    assert.equal(report.state, "dry-run");
    assert.equal(existsSync(destination), false);
  });
});
