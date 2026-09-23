#!/usr/bin/env node
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

const FORMAT = 1;

function fail(message) {
  throw new Error(`Vito Next delta merge refused: ${message}`);
}

function absoluteExisting(path, label, directory = false) {
  if (typeof path !== "string" || !isAbsolute(path) || !existsSync(path))
    fail(`${label} must be an existing absolute path`);
  const stats = statSync(path);
  if (directory ? !stats.isDirectory() : !stats.isFile()) fail(`${label} has the wrong type`);
  return resolve(path);
}

function readManifest(path) {
  let value;
  try {
    value = JSON.parse(readFileSync(absoluteExisting(path, "manifest"), "utf8"));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Vito Next delta")) throw error;
    fail("manifest is not valid JSON");
  }
  if (value.version !== 1) fail("manifest version must be 1");
  return {
    baselineUser: absoluteExisting(value.baselineUser, "baselineUser", true),
    importedUser: absoluteExisting(value.importedUser, "importedUser", true),
    migrationMap: absoluteExisting(value.migrationMap, "migrationMap"),
  };
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function open(path, readonly = false) {
  const db = new Database(path, { readonly, fileMustExist: true });
  db.pragma("busy_timeout=5000");
  return db;
}

function integrity(db, label) {
  const rows = db.pragma("integrity_check");
  if (rows.length !== 1 || rows[0].integrity_check !== "ok")
    fail(`${label} failed integrity_check`);
}

function copyBaseline(source, destination) {
  cpSync(source, destination, {
    recursive: true,
    errorOnExist: true,
    filter: (path) => !path.endsWith(".vito-next-delta.json"),
  });
}

function ensureTargetTables(target, imported) {
  const existing = new Set(
    target
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => r.name),
  );
  const wanted = [
    "secret_drops",
    "job_runs",
    "job_run_prompts",
    "job_schedule_state",
    "session_turn_locks",
    "discord_inbox",
    "discord_cursors",
    "discord_deliveries",
    "token_usage",
    "legacy_import_history",
    "legacy_import_sessions",
    "legacy_import_discord",
    "legacy_import_jobs",
  ];
  for (const name of wanted) {
    if (existing.has(name)) continue;
    const row = imported
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?")
      .get(name);
    if (!row?.sql) fail(`normalized import lacks target table ${name}`);
    target.exec(row.sql);
  }
}

function idMaps(mapDb) {
  const result = {};
  for (const kind of ["messages", "chunks", "facts"]) {
    const oldByVito = new Map();
    for (const row of mapDb
      .prepare("SELECT source,target FROM migration_id_map WHERE kind=?")
      .all(kind))
      oldByVito.set(Number(row.target), Number(row.source));
    result[kind] = oldByVito;
  }
  return result;
}

function nextId(db, table) {
  return Number(db.prepare(`SELECT coalesce(max(id),0)+1 id FROM ${table}`).get().id);
}

function createDeltaMap(source, oldByVito, first) {
  const result = new Map();
  let next = first;
  for (const row of source.prepare("SELECT id FROM messages ORDER BY id").all()) {
    const id = Number(row.id);
    if (!oldByVito.has(id)) result.set(id, next++);
  }
  return result;
}

function createTableDeltaMap(source, table, oldByVito, first) {
  const result = new Map();
  let next = first;
  for (const row of source.prepare(`SELECT id FROM ${table} ORDER BY id`).all()) {
    const id = Number(row.id);
    if (!oldByVito.has(id)) result.set(id, next++);
  }
  return result;
}

function mappedId(id, oldByVito, delta, label, nullable = false) {
  if (id == null && nullable) return null;
  const number = Number(id);
  const mapped = oldByVito.get(number) ?? delta.get(number);
  if (mapped == null) fail(`${label} references unmapped id ${String(id)}`);
  return mapped;
}

function copyNormalizedTable(target, source, table, mode = "INSERT OR IGNORE") {
  const columns = source.pragma(`table_info(${table})`).map((r) => r.name);
  if (!columns.length) fail(`normalized import lacks ${table}`);
  const placeholders = columns.map(() => "?").join(",");
  const insert = target.prepare(
    `${mode} INTO ${table}(${columns.map((x) => `"${x}"`).join(",")}) VALUES(${placeholders})`,
  );
  let count = 0;
  for (const row of source.prepare(`SELECT * FROM ${table}`).iterate()) {
    insert.run(...columns.map((column) => row[column]));
    count++;
  }
  return count;
}

function merge(options) {
  const manifest = readManifest(options.manifest);
  const destination = resolve(options.destination);
  if (!isAbsolute(options.destination)) fail("destination must be absolute");
  if (existsSync(destination)) fail("destination already exists");
  const stage = `${destination}.stage-${process.pid}`;
  if (existsSync(stage)) fail(`staging path already exists: ${stage}`);

  const baselineDb = join(manifest.baselineUser, "vito.db");
  const baselineEmbeddings = join(manifest.baselineUser, "embeddings.db");
  const importedDb = join(manifest.importedUser, "vito.db");
  const importedEmbeddings = join(manifest.importedUser, "embeddings.db");
  for (const [path, label] of [
    [baselineDb, "baseline vito.db"],
    [baselineEmbeddings, "baseline embeddings.db"],
    [importedDb, "normalized vito.db"],
    [importedEmbeddings, "normalized embeddings.db"],
  ])
    absoluteExisting(path, label);

  let target;
  let embeddings;
  let imported;
  let importedMemory;
  let mapDb;
  try {
    copyBaseline(manifest.baselineUser, stage);
    target = open(join(stage, "vito.db"));
    embeddings = open(join(stage, "embeddings.db"));
    imported = open(importedDb, true);
    importedMemory = open(importedEmbeddings, true);
    mapDb = open(manifest.migrationMap, true);
    for (const [db, label] of [
      [target, "baseline vito.db"],
      [embeddings, "baseline embeddings.db"],
      [imported, "normalized vito.db"],
      [importedMemory, "normalized embeddings.db"],
      [mapDb, "migration map"],
    ])
      integrity(db, label);
    ensureTargetTables(target, imported);
    target.pragma("foreign_keys=ON");
    embeddings.pragma("foreign_keys=ON");
    const inheritedEmbeddingForeignKeys = embeddings.pragma("foreign_key_check");

    const maps = idMaps(mapDb);
    const messageDelta = createDeltaMap(imported, maps.messages, nextId(target, "messages"));
    const chunkDelta = createTableDeltaMap(
      importedMemory,
      "chunks",
      maps.chunks,
      nextId(embeddings, "chunks"),
    );
    const factDelta = createTableDeltaMap(
      importedMemory,
      "facts",
      maps.facts,
      nextId(embeddings, "facts"),
    );
    const counts = {
      messages: messageDelta.size,
      chunks: chunkDelta.size,
      facts: factDelta.size,
      sessionsCreated: 0,
      piSessionFiles: 0,
    };

    const apply = target.transaction(() => {
      const insertSession = target.prepare(
        "INSERT INTO sessions(id,channel,channel_target,created_at,last_active_at,config,alias) VALUES(?,?,?,?,?,?,?)",
      );
      const updateSession = target.prepare(
        "UPDATE sessions SET last_active_at=max(last_active_at,?) WHERE id=?",
      );
      const insertMessage = target.prepare(
        "INSERT INTO messages(id,session_id,channel,channel_target,timestamp,type,content,compacted,archived,author) VALUES(?,?,?,?,?,?,?,?,?,?)",
      );
      const sessions = new Map(
        imported
          .prepare("SELECT * FROM sessions")
          .all()
          .map((row) => [row.id, row]),
      );
      const existing = new Set(
        target
          .prepare("SELECT id FROM sessions")
          .all()
          .map((row) => row.id),
      );
      const needed = new Set(
        imported
          .prepare(
            `SELECT DISTINCT session_id FROM messages WHERE id IN (${[...messageDelta.keys()].map(() => "?").join(",") || "NULL"})`,
          )
          .all(...messageDelta.keys())
          .map((row) => row.session_id),
      );
      for (const id of needed) {
        const row = sessions.get(id);
        if (!row) fail(`delta message session ${id} is missing`);
        if (!existing.has(id)) {
          insertSession.run(
            row.id,
            row.channel,
            row.channel_target,
            row.created_at,
            row.last_active_at,
            row.config ?? "{}",
            row.alias ?? null,
          );
          existing.add(id);
          counts.sessionsCreated++;
        } else updateSession.run(row.last_active_at, id);
      }
      for (const [vitoId, targetId] of messageDelta) {
        const row = imported.prepare("SELECT * FROM messages WHERE id=?").get(vitoId);
        insertMessage.run(
          targetId,
          row.session_id,
          row.channel,
          row.channel_target,
          row.timestamp,
          row.type,
          row.content,
          row.compacted,
          row.archived,
          row.author ?? null,
        );
      }
      for (const table of [
        "job_schedule_state",
        "job_runs",
        "job_run_prompts",
        "discord_cursors",
        "discord_inbox",
        "discord_deliveries",
        "token_usage",
        "legacy_import_history",
        "legacy_import_sessions",
        "legacy_import_discord",
        "legacy_import_jobs",
      ])
        counts[table] = copyNormalizedTable(target, imported, table);
      target
        .prepare("UPDATE job_schedule_state SET config=replace(config,?,?)")
        .run(manifest.importedUser, destination);
      target
        .prepare("UPDATE job_runs SET data=replace(data,?,?)")
        .run(manifest.importedUser, destination);
    });
    apply();

    const applyMemory = embeddings.transaction(() => {
      const activeSet = embeddings
        .prepare("SELECT active_set_id FROM fact_store_state WHERE id=1")
        .get()?.active_set_id;
      if (!activeSet) fail("baseline has no active fact set");
      const insertChunk = embeddings.prepare(
        "INSERT INTO chunks(id,session_id,day,chunk_index,text,context,embedded_text,msg_id_start,msg_id_end,msg_count,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      );
      const insertVector = embeddings.prepare(
        "INSERT INTO embeddings(chunk_id,vector) VALUES(?,?)",
      );
      const nextIndex = new Map();
      const getIndex = (session, day) => {
        const key = `${session}\0${day}`;
        if (!nextIndex.has(key)) {
          const row = embeddings
            .prepare(
              "SELECT coalesce(max(chunk_index),-1)+1 value FROM chunks WHERE session_id=? AND day=?",
            )
            .get(session, day);
          nextIndex.set(key, Number(row.value));
        }
        const value = nextIndex.get(key);
        nextIndex.set(key, value + 1);
        return value;
      };
      for (const [vitoId, targetId] of chunkDelta) {
        const row = importedMemory.prepare("SELECT * FROM chunks WHERE id=?").get(vitoId);
        insertChunk.run(
          targetId,
          row.session_id,
          row.day,
          getIndex(row.session_id, row.day),
          row.text,
          row.context,
          row.embedded_text,
          mappedId(row.msg_id_start, maps.messages, messageDelta, `chunk ${vitoId} start`, true),
          mappedId(row.msg_id_end, maps.messages, messageDelta, `chunk ${vitoId} end`, true),
          row.msg_count,
          row.created_at,
        );
        const vector = importedMemory
          .prepare("SELECT vector FROM embeddings WHERE chunk_id=?")
          .get(vitoId);
        if (!vector) fail(`chunk ${vitoId} has no embedding`);
        insertVector.run(targetId, vector.vector);
      }

      const insertFact = embeddings.prepare(
        "INSERT INTO facts(id,fingerprint,canonical_text,kind,slot_key,canonical_value,status,authority,valid_from,valid_to,observed_at,supersedes_fact_id,entity_text,created_at,updated_at,fact_set_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      );
      for (const [vitoId, targetId] of factDelta) {
        const row = importedMemory.prepare("SELECT * FROM facts WHERE id=?").get(vitoId);
        insertFact.run(
          targetId,
          row.fingerprint,
          row.canonical_text,
          row.kind,
          row.slot_key,
          row.canonical_value,
          row.status,
          row.authority,
          row.valid_from,
          row.valid_to,
          row.observed_at,
          null,
          row.entity_text,
          row.created_at,
          row.updated_at,
          activeSet,
        );
      }
      for (const [vitoId, targetId] of factDelta) {
        const row = importedMemory
          .prepare("SELECT supersedes_fact_id FROM facts WHERE id=?")
          .get(vitoId);
        if (row.supersedes_fact_id != null)
          embeddings
            .prepare("UPDATE facts SET supersedes_fact_id=? WHERE id=?")
            .run(
              mappedId(row.supersedes_fact_id, maps.facts, factDelta, `fact ${vitoId} supersedes`),
              targetId,
            );
        for (const entity of importedMemory
          .prepare("SELECT name,normalized_name FROM fact_entities WHERE fact_id=?")
          .all(vitoId))
          embeddings
            .prepare("INSERT INTO fact_entities(fact_id,name,normalized_name) VALUES(?,?,?)")
            .run(targetId, entity.name, entity.normalized_name);
        const vector = importedMemory
          .prepare("SELECT vector,updated_at FROM fact_embeddings WHERE fact_id=?")
          .get(vitoId);
        if (!vector) fail(`fact ${vitoId} has no embedding`);
        embeddings
          .prepare("INSERT INTO fact_embeddings(fact_id,vector,updated_at) VALUES(?,?,?)")
          .run(targetId, vector.vector, vector.updated_at);
        for (const source of importedMemory
          .prepare("SELECT * FROM fact_sources WHERE fact_id=?")
          .all(vitoId))
          embeddings
            .prepare(
              "INSERT INTO fact_sources(fact_id,message_id,session_id,message_type,quote,source_timestamp) VALUES(?,?,?,?,?,?)",
            )
            .run(
              targetId,
              mappedId(source.message_id, maps.messages, messageDelta, `fact ${vitoId} evidence`),
              source.session_id,
              source.message_type,
              source.quote,
              source.source_timestamp,
            );
      }
      for (const [vitoId, targetId] of chunkDelta)
        for (const run of importedMemory
          .prepare("SELECT * FROM fact_chunk_runs WHERE chunk_id=?")
          .all(vitoId))
          embeddings
            .prepare(
              "INSERT INTO fact_chunk_runs(chunk_id,extractor_version,status,attempts,facts_inserted,facts_supported,facts_rejected,last_error,started_at,completed_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            )
            .run(
              targetId,
              run.extractor_version,
              run.status,
              run.attempts,
              run.facts_inserted,
              run.facts_supported,
              run.facts_rejected,
              run.last_error,
              run.started_at,
              run.completed_at,
              run.updated_at,
            );
    });
    applyMemory();

    const importedPi = join(manifest.importedUser, "pi-sessions");
    if (existsSync(importedPi)) {
      const targetPi = join(stage, "pi-sessions");
      mkdirSync(targetPi, { recursive: true });
      cpSync(importedPi, targetPi, {
        recursive: true,
        force: false,
        errorOnExist: false,
        filter: (source) => {
          if (source === importedPi) return true;
          if (statSync(source).isFile()) counts.piSessionFiles++;
          return true;
        },
      });
    }
    const importedJobs = join(manifest.importedUser, "jobs");
    if (existsSync(importedJobs)) cpSync(importedJobs, join(stage, "jobs"), { recursive: true });
    const importedConfig = JSON.parse(
      readFileSync(join(manifest.importedUser, "vito.config.json"), "utf8"),
    );
    const baselineConfigPath = join(stage, "vito.config.json");
    const baselineConfig = JSON.parse(readFileSync(baselineConfigPath, "utf8"));
    baselineConfig.cron = importedConfig.cron;
    for (const job of baselineConfig.cron?.jobs ?? [])
      if (typeof job.script === "string" && job.script.startsWith(manifest.importedUser))
        job.script = `${destination}${job.script.slice(manifest.importedUser.length)}`;
    baselineConfig.sessions = {
      ...(baselineConfig.sessions ?? {}),
      ...(importedConfig.sessions ?? {}),
    };
    writeFileSync(baselineConfigPath, `${JSON.stringify(baselineConfig, null, 2)}\n`, {
      mode: 0o600,
    });
    cpSync(join(manifest.importedUser, "profile.md"), join(stage, "profile.md"));

    for (const [db, label] of [[target, "merged vito.db"]]) {
      integrity(db, label);
      const foreign = db.pragma("foreign_key_check");
      if (foreign.length) fail(`${label} has ${foreign.length} foreign-key violations`);
      db.pragma("wal_checkpoint(TRUNCATE)");
    }
    integrity(embeddings, "merged embeddings.db");
    const mergedEmbeddingForeignKeys = embeddings.pragma("foreign_key_check");
    if (
      JSON.stringify(mergedEmbeddingForeignKeys) !== JSON.stringify(inheritedEmbeddingForeignKeys)
    )
      fail(
        `merged embeddings.db changed the inherited foreign-key violations (${inheritedEmbeddingForeignKeys.length} before, ${mergedEmbeddingForeignKeys.length} after)`,
      );
    embeddings.pragma("wal_checkpoint(TRUNCATE)");
    target.close();
    embeddings.close();
    imported.close();
    importedMemory.close();
    mapDb.close();
    target = embeddings = imported = importedMemory = mapDb = undefined;
    for (const name of ["vito.db-wal", "vito.db-shm", "embeddings.db-wal", "embeddings.db-shm"])
      rmSync(join(stage, name), { force: true });

    const report = {
      format: FORMAT,
      state: options.dryRun ? "dry-run" : "merged",
      source: {
        baseline: sha256(baselineDb),
        imported: sha256(importedDb),
        migrationMap: sha256(manifest.migrationMap),
      },
      counts,
      checks: {
        integrity: "ok",
        foreignKeys: "no-new-violations",
        inheritedEmbeddingForeignKeys: inheritedEmbeddingForeignKeys.length,
        networkCalls: 0,
        modelCalls: 0,
      },
    };
    writeFileSync(join(stage, ".vito-next-delta.json"), `${JSON.stringify(report, null, 2)}\n`, {
      mode: 0o600,
    });
    if (options.dryRun) rmSync(stage, { recursive: true, force: true });
    else renameSync(stage, destination);
    return report;
  } catch (error) {
    for (const db of [target, embeddings, imported, importedMemory, mapDb])
      try {
        db?.close();
      } catch {}
    rmSync(stage, { recursive: true, force: true });
    throw error;
  }
}

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};
if (args.includes("--help")) {
  console.log(
    "Usage: merge-vito-next-delta --manifest FILE --destination DIR [--dry-run] [--json]",
  );
  process.exit(0);
}
const manifest = option("--manifest");
const destination = option("--destination");
if (!manifest || !destination) fail("--manifest and --destination are required");
const report = merge({ manifest, destination, dryRun: args.includes("--dry-run") });
console.log(
  args.includes("--json")
    ? JSON.stringify(report, null, 2)
    : `Delta ${report.state}: ${JSON.stringify(report.counts)}`,
);
