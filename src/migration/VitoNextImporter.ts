import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { createDatabase } from "../lib/sqlite/database.js";
import { createEmbeddingDatabase } from "../stores/embeddings/embedding-database.js";
import {
  vitoConfigSchema,
  type ScriptJobConfig,
  type VitoConfig,
} from "../shared/schemas/vito-config.js";

export const VITO_NEXT_IMPORT_FORMAT = 1;

export interface VitoNextImportManifest {
  version: 1;
  history: string;
  semanticMemory: string;
  facts: string;
  jobs: string;
  discord: string;
  usage: string;
  profile: string;
  config: string;
  sessions: string;
  controls: string;
  sessionNames?: string;
  discordAttachments?: string;
  embedding: { model: string; dimensions: number };
}

export interface VitoNextImportReport {
  format: number;
  state: "imported" | "already-imported" | "dry-run";
  sourceDigest: string;
  counts: Record<string, number>;
  warnings: string[];
  checks: {
    sourceIntegrity: "ok";
    targetIntegrity: "ok";
    foreignKeys: "ok";
    networkCalls: 0;
    modelCalls: 0;
  };
  mappings: { sessions: Record<string, string>; jobs: Record<string, string> };
  files: Record<string, string>;
}

type Row = Record<string, unknown>;

function fail(message: string): never {
  throw new Error(`Vito Next import refused: ${message}`);
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string") fail(`${label} must be a string`);
  return value;
}

function integer(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) fail(`${label} must be a safe integer`);
  return number;
}

function jsonObject(value: unknown, label: string): Record<string, unknown> {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      fail(`${label} contains invalid JSON`);
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    fail(`${label} must be a JSON object`);
  return parsed as Record<string, unknown>;
}

function isoMillis(value: unknown, label: string): number {
  const millis = Date.parse(text(value, label));
  if (!Number.isFinite(millis)) fail(`${label} is not an ISO timestamp`);
  return millis;
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function regularFile(path: string, label: string): string {
  const absolute = resolve(path);
  if (!isAbsolute(path) || !existsSync(absolute))
    fail(`${label} must be an existing absolute path`);
  const stats = lstatSync(absolute);
  if (!stats.isFile() || stats.isSymbolicLink()) fail(`${label} must be a regular file`);
  return absolute;
}

function directory(path: string, label: string): string {
  const absolute = resolve(path);
  if (!isAbsolute(path) || !existsSync(absolute))
    fail(`${label} must be an existing absolute directory`);
  const stats = lstatSync(absolute);
  if (!stats.isDirectory() || stats.isSymbolicLink()) fail(`${label} must be a real directory`);
  return absolute;
}

function sourceDatabase(path: string, label: string): Database.Database {
  const file = regularFile(path, label);
  if (existsSync(`${file}-wal`) || existsSync(`${file}-shm`))
    fail(`${label} has live WAL/SHM state; use a quiesced SQLite snapshot`);
  const db = new Database(file, { readonly: true, fileMustExist: true });
  const integrity = db.pragma("integrity_check") as Array<{ integrity_check: string }>;
  if (integrity.length !== 1 || integrity[0]?.integrity_check !== "ok") {
    db.close();
    fail(`${label} failed PRAGMA integrity_check`);
  }
  return db;
}

function requireTables(db: Database.Database, names: string[], label: string): void {
  const present = new Set(
    (
      db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view')").all() as Row[]
    ).map((row) => String(row.name)),
  );
  const missing = names.filter((name) => !present.has(name));
  if (missing.length) fail(`${label} is missing tables: ${missing.join(", ")}`);
}

function parseModel(value: string, label: string): { provider: string; name: string } {
  const split = value.indexOf("/");
  if (split <= 0 || split === value.length - 1) fail(`${label} must be provider/model`);
  return { provider: value.slice(0, split), name: value.slice(split + 1) };
}

function vectorBuffer(value: unknown, dimensions: number, label: string): Buffer {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text(value, label));
  } catch {
    fail(`${label} contains invalid vector JSON`);
  }
  if (!Array.isArray(parsed) || parsed.length !== dimensions)
    fail(`${label} must contain exactly ${dimensions} dimensions`);
  const numbers = parsed.map((item) => Number(item));
  if (numbers.some((item) => !Number.isFinite(item))) fail(`${label} contains a non-finite value`);
  const typed = new Float32Array(numbers);
  return Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
}

function relativeHashes(root: string): Record<string, string> {
  const files: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) fail(`staged output contains symlink ${path}`);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) {
        if (
          entry.name !== ".vito-next-import.json" &&
          !entry.name.endsWith(".db-wal") &&
          !entry.name.endsWith(".db-shm")
        )
          files.push(path);
      } else fail(`staged output contains unsupported filesystem entry ${path}`);
    }
  };
  visit(root);
  return Object.fromEntries(files.map((path) => [path.slice(root.length + 1), sha256File(path)]));
}

function verifyReceipt(destination: string, sourceDigest: string): VitoNextImportReport {
  const receiptPath = join(destination, ".vito-next-import.json");
  if (!existsSync(receiptPath)) fail("destination already exists without an import receipt");
  const receipt = jsonObject(
    readFileSync(receiptPath, "utf8"),
    "destination receipt",
  ) as unknown as VitoNextImportReport;
  if (receipt.format !== VITO_NEXT_IMPORT_FORMAT || receipt.sourceDigest !== sourceDigest)
    fail("destination belongs to a different import");
  const current = relativeHashes(destination);
  const expectedEntries = Object.entries(receipt.files).sort(([a], [b]) => a.localeCompare(b));
  const currentEntries = Object.entries(current).sort(([a], [b]) => a.localeCompare(b));
  if (JSON.stringify(currentEntries) !== JSON.stringify(expectedEntries)) {
    const expected = new Map(expectedEntries);
    const changed = currentEntries
      .filter(([path, hash]) => expected.get(path) !== hash)
      .map(([path]) => path);
    const missing = expectedEntries.filter(([path]) => !(path in current)).map(([path]) => path);
    fail(`destination changed after import (${[...changed, ...missing].join(", ")})`);
  }
  return { ...receipt, state: "already-imported" };
}

function copyRegular(source: string, destination: string): void {
  const path = regularFile(source, source);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(path, destination);
  chmodSync(destination, 0o600);
  const stats = statSync(path);
  utimesSync(destination, stats.atime, stats.mtime);
}

function readJsonFile(path: string, label: string): unknown {
  try {
    return JSON.parse(readFileSync(regularFile(path, label), "utf8"));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Vito Next import refused:"))
      throw error;
    fail(`${label} contains invalid JSON`);
  }
}

function scopeMappings(controls: string): {
  sessionTargets: Map<string, string>;
  currentByTarget: Map<string, string>;
} {
  const sessionTargets = new Map<string, string>();
  const currentByTarget = new Map<string, string>();
  for (const file of readdirSync(controls).sort()) {
    const match = /^scope-discord-([0-9]{1,20})\.json$/.exec(file);
    if (!match) continue;
    const value = readJsonFile(join(controls, file), `session scope ${file}`);
    if (!Array.isArray(value) || value.some((id) => typeof id !== "string" || !id))
      fail(`session scope ${file} is invalid`);
    const target = match[1];
    for (const id of value as string[]) {
      const prior = sessionTargets.get(id);
      if (prior && prior !== target)
        fail(`session ${id} belongs to multiple Discord conversations`);
      sessionTargets.set(id, target);
    }
    if (value.length) currentByTarget.set(target, value.at(-1) as string);
  }
  return { sessionTargets, currentByTarget };
}

type ImportedSessionSettings = {
  model?: string;
  thinkingLevel?: "off" | "low" | "medium" | "high";
};

function lastSessionSettings(path: string): ImportedSessionSettings {
  let model: string | undefined;
  let thinkingLevel: ImportedSessionSettings["thinkingLevel"];
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    if (!raw.trim()) continue;
    let row: Row;
    try {
      row = jsonObject(JSON.parse(raw), `Pi session ${path}`);
    } catch {
      fail(`Pi session ${path} contains malformed JSONL`);
    }
    if (
      row.type === "thinking_level_change" &&
      (row.thinkingLevel === "off" ||
        row.thinkingLevel === "low" ||
        row.thinkingLevel === "medium" ||
        row.thinkingLevel === "high")
    )
      thinkingLevel = row.thinkingLevel;
    if (
      row.type === "model_change" &&
      typeof row.provider === "string" &&
      typeof row.modelId === "string"
    )
      model = `${row.provider}/${row.modelId}`;
    if (row.type === "message" && row.message && typeof row.message === "object") {
      const message = row.message as Row;
      if (
        message.role === "assistant" &&
        typeof message.provider === "string" &&
        typeof message.model === "string"
      )
        model = `${message.provider}/${message.model}`;
    }
  }
  return { ...(model ? { model } : {}), ...(thinkingLevel ? { thinkingLevel } : {}) };
}

function importPiSessions(
  source: string,
  target: string,
  mapSession: (id: string) => string,
): {
  settings: Map<string, ImportedSessionSettings>;
  paths: Map<string, string>;
  latestMtime: number;
  ids: string[];
  count: number;
} {
  const settings = new Map<string, ImportedSessionSettings>();
  const paths = new Map<string, string>();
  const ids: string[] = [];
  let latestMtime = 0;
  let count = 0;
  for (const file of readdirSync(source)
    .filter((name) => name.endsWith(".jsonl"))
    .sort()) {
    const sourcePath = join(source, file);
    regularFile(sourcePath, `Pi session ${file}`);
    const first = readFileSync(sourcePath, "utf8").split("\n", 1)[0];
    let header: Row;
    try {
      header = jsonObject(JSON.parse(first), `Pi session header ${file}`);
    } catch {
      fail(`Pi session ${file} has an invalid header`);
    }
    if (
      header.type !== "session" ||
      typeof header.id !== "string" ||
      !/^[A-Za-z0-9_-]{1,100}$/.test(header.id)
    )
      fail(`Pi session ${file} has an invalid session ID`);
    const sourceId = header.id;
    if (ids.includes(sourceId)) fail(`multiple Pi files declare session ID ${sourceId}`);
    ids.push(sourceId);
    const targetId = mapSession(sourceId);
    const destination = join(target, encodeURIComponent(targetId), `${sourceId}.jsonl`);
    copyRegular(sourcePath, destination);
    paths.set(sourceId, destination);
    latestMtime = Math.max(latestMtime, statSync(sourcePath).mtimeMs);
    const sessionSettings = lastSessionSettings(sourcePath);
    if (sessionSettings.model || sessionSettings.thinkingLevel)
      settings.set(sourceId, sessionSettings);
    count++;
  }
  return { settings, paths, latestMtime, ids, count };
}

function tableRows(db: Database.Database, table: string): Row[] {
  return db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all() as Row[];
}

function createLegacyTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE legacy_import_sessions(source_session TEXT PRIMARY KEY,target_session TEXT NOT NULL,scope TEXT,current INTEGER NOT NULL);
    CREATE TABLE legacy_import_history(source_id INTEGER PRIMARY KEY,entry TEXT NOT NULL,parent TEXT,source_session TEXT NOT NULL);
    CREATE TABLE legacy_import_discord(table_name TEXT NOT NULL,source_key TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(table_name,source_key));
    CREATE TABLE legacy_import_jobs(table_name TEXT NOT NULL,source_key TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(table_name,source_key));
  `);
}

function createLegacyEmbeddingTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE legacy_import_memory_chunks(id INTEGER PRIMARY KEY,data TEXT NOT NULL);
    CREATE TABLE legacy_import_fact_rows(table_name TEXT NOT NULL,source_key TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(table_name,source_key));
  `);
}

function archiveRows(db: Database.Database, target: string, table: string, rows: Row[]): void {
  const insert = db.prepare(`INSERT INTO ${target}(table_name,source_key,data) VALUES(?,?,?)`);
  rows.forEach((row, index) => {
    const base = String(row.id ?? row.name ?? row.key ?? row.entry ?? row.chunk ?? "row");
    insert.run(table, `${base}:${index}`, JSON.stringify(row));
  });
}

function sourceDigest(manifest: VitoNextImportManifest, paths: string[]): string {
  const hash = createHash("sha256").update(JSON.stringify(manifest));
  for (const path of paths.sort()) hash.update(path).update(sha256File(path));
  return hash.digest("hex");
}

export function loadVitoNextImportManifest(path: string): VitoNextImportManifest {
  const value = jsonObject(readJsonFile(path, "import manifest"), "import manifest");
  if (value.version !== 1) fail("unsupported manifest version");
  const required = [
    "history",
    "semanticMemory",
    "facts",
    "jobs",
    "discord",
    "usage",
    "profile",
    "config",
    "sessions",
    "controls",
  ];
  for (const key of required)
    if (typeof value[key] !== "string") fail(`manifest.${key} is required`);
  const embedding = jsonObject(value.embedding, "manifest.embedding");
  if (
    typeof embedding.model !== "string" ||
    !Number.isInteger(embedding.dimensions) ||
    Number(embedding.dimensions) <= 0
  )
    fail("manifest.embedding is invalid");
  return value as unknown as VitoNextImportManifest;
}

export function importVitoNext(options: {
  manifestPath: string;
  destination: string;
  templateConfigPath: string;
  dryRun?: boolean;
}): VitoNextImportReport {
  const manifest = loadVitoNextImportManifest(options.manifestPath);
  const destination = resolve(options.destination);
  if (!isAbsolute(options.destination)) fail("destination must be an absolute path");
  const files = {
    history: regularFile(manifest.history, "history database"),
    memory: regularFile(manifest.semanticMemory, "semantic memory database"),
    facts: regularFile(manifest.facts, "facts database"),
    jobs: regularFile(manifest.jobs, "jobs database"),
    discord: regularFile(manifest.discord, "Discord database"),
    usage: regularFile(manifest.usage, "usage database"),
    profile: regularFile(manifest.profile, "profile"),
    config: regularFile(manifest.config, "agent config"),
  };
  const sessions = directory(manifest.sessions, "sessions");
  const controls = directory(manifest.controls, "session controls");
  const templateConfig = regularFile(options.templateConfigPath, "target config template");
  const digestInputs = [...Object.values(files), templateConfig];
  if (manifest.sessionNames) digestInputs.push(regularFile(manifest.sessionNames, "session names"));
  if (manifest.discordAttachments) {
    const attachmentDir = directory(manifest.discordAttachments, "Discord attachments");
    for (const file of readdirSync(attachmentDir).sort())
      digestInputs.push(regularFile(join(attachmentDir, file), `Discord attachment ${file}`));
  }
  for (const file of readdirSync(sessions).filter((name) => name.endsWith(".jsonl")))
    digestInputs.push(regularFile(join(sessions, file), `Pi session ${file}`));
  for (const file of readdirSync(controls).filter((name) => name.endsWith(".json")))
    digestInputs.push(regularFile(join(controls, file), `session control ${file}`));
  const digestJobs = sourceDatabase(files.jobs, "jobs database");
  try {
    requireTables(digestJobs, ["jobs"], "jobs database");
    for (const row of tableRows(digestJobs, "jobs")) {
      const job = jsonObject(row.data, `job ${row.name}`);
      digestInputs.push(
        regularFile(text(job.script, `job ${row.name}.script`), `job ${row.name} script`),
      );
    }
  } finally {
    digestJobs.close();
  }
  const digest = sourceDigest(
    manifest,
    digestInputs.filter((path) => lstatSync(path).isFile()),
  );
  if (existsSync(destination)) return verifyReceipt(destination, digest);

  mkdirSync(dirname(destination), { recursive: true });
  const stage = join(
    dirname(destination),
    `.${basename(destination)}.importing-${digest.slice(0, 12)}`,
  );
  if (existsSync(stage)) rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: false, mode: 0o700 });

  const source = {
    history: sourceDatabase(files.history, "history database"),
    memory: sourceDatabase(files.memory, "semantic memory database"),
    facts: sourceDatabase(files.facts, "facts database"),
    jobs: sourceDatabase(files.jobs, "jobs database"),
    discord: sourceDatabase(files.discord, "Discord database"),
    usage: sourceDatabase(files.usage, "usage database"),
  };
  let target: Database.Database | undefined;
  let embeddings: Database.Database | undefined;
  try {
    requireTables(source.history, ["messages"], "history database");
    requireTables(source.memory, ["chunks", "search", "settings"], "semantic memory database");
    requireTables(
      source.facts,
      ["facts", "evidence", "fact_sets", "settings", "vectors", "coverage", "chunk_runs"],
      "facts database",
    );
    requireTables(source.jobs, ["jobs", "runs", "prompts"], "jobs database");
    requireTables(
      source.discord,
      ["conversations", "messages", "deliveries", "batches"],
      "Discord database",
    );
    requireTables(source.usage, ["usage"], "usage database");

    target = createDatabase(join(stage, "vito.db"));
    embeddings = createEmbeddingDatabase(join(stage, "embeddings.db"));
    createLegacyTables(target);
    createLegacyEmbeddingTables(embeddings);

    const counts: Record<string, number> = {};
    const warnings: string[] = [];
    const scope = scopeMappings(controls);
    if (manifest.sessionNames) {
      const names = jsonObject(
        readJsonFile(manifest.sessionNames, "session names"),
        "session names",
      );
      for (const [name, id] of Object.entries(names)) {
        const match = /^discord-([0-9]{1,20})$/.exec(name);
        if (match && typeof id === "string") {
          const scopedTarget = scope.sessionTargets.get(id);
          if (scopedTarget !== match[1]) {
            warnings.push(
              `Ignored stale session name ${name}: ${id} is ${
                scopedTarget
                  ? `scoped to discord-${scopedTarget}`
                  : "not in a current Discord scope"
              }`,
            );
            continue;
          }
          scope.currentByTarget.set(match[1], id);
        }
      }
    }
    const mapSession = (id: string) => {
      const channel = scope.sessionTargets.get(id);
      return channel ? `discord:${channel}` : id;
    };

    const historyRows = source.history.prepare("SELECT * FROM messages ORDER BY id").all() as Row[];
    const importedAt = historyRows.reduce(
      (latest, row) => Math.max(latest, isoMillis(row.timestamp, `history ${row.id}.timestamp`)),
      0,
    );
    const sessionStats = new Map<string, { min: number; max: number; source: Set<string> }>();
    for (const row of historyRows) {
      const sourceSession = text(row.session, `history ${row.id}.session`);
      const targetSession = mapSession(sourceSession);
      const timestamp = isoMillis(row.timestamp, `history ${row.id}.timestamp`);
      const stats = sessionStats.get(targetSession) ?? {
        min: timestamp,
        max: timestamp,
        source: new Set(),
      };
      stats.min = Math.min(stats.min, timestamp);
      stats.max = Math.max(stats.max, timestamp);
      stats.source.add(sourceSession);
      sessionStats.set(targetSession, stats);
    }
    const copiedSessions = importPiSessions(sessions, join(stage, "pi-sessions"), mapSession);
    for (const sourceSession of copiedSessions.ids) {
      const targetSession = mapSession(sourceSession);
      const stats = sessionStats.get(targetSession) ?? {
        min: importedAt,
        max: importedAt,
        source: new Set<string>(),
      };
      stats.source.add(sourceSession);
      sessionStats.set(targetSession, stats);
    }
    for (const [sourceSession, channel] of scope.sessionTargets) {
      const targetSession = mapSession(sourceSession);
      if (!sessionStats.has(targetSession))
        sessionStats.set(targetSession, {
          min: importedAt,
          max: importedAt,
          source: new Set([sourceSession]),
        });
      else sessionStats.get(targetSession)!.source.add(sourceSession);
      if (!scope.currentByTarget.has(channel)) scope.currentByTarget.set(channel, sourceSession);
    }
    const insertSession = target.prepare(
      "INSERT INTO sessions(id,channel,channel_target,created_at,last_active_at,config,alias) VALUES(?,?,?,?,?,'{}',NULL)",
    );
    const insertMap = target.prepare("INSERT INTO legacy_import_sessions VALUES(?,?,?,?)");
    for (const [targetSession, stats] of [...sessionStats].sort(([a], [b]) => a.localeCompare(b))) {
      const match = /^discord:([0-9]{1,20})$/.exec(targetSession);
      insertSession.run(
        targetSession,
        match ? "discord" : "import",
        match?.[1] ?? "",
        stats.min,
        stats.max,
      );
      for (const sourceSession of [...stats.source].sort()) {
        const channel = scope.sessionTargets.get(sourceSession);
        insertMap.run(
          sourceSession,
          targetSession,
          channel ? `discord-${channel}` : null,
          channel && scope.currentByTarget.get(channel) === sourceSession ? 1 : 0,
        );
      }
    }
    const insertMessage = target.prepare(
      "INSERT INTO messages(id,session_id,channel,channel_target,timestamp,type,content,compacted,archived,author) VALUES(?,?,?,?,?,?,?,0,0,NULL)",
    );
    const insertHistory = target.prepare("INSERT INTO legacy_import_history VALUES(?,?,?,?)");
    for (const row of historyRows) {
      const id = integer(row.id, "history.id");
      const sourceSession = text(row.session, `history ${id}.session`);
      const role = text(row.role, `history ${id}.role`);
      if (role !== "user" && role !== "assistant")
        fail(`history ${id} has unsupported role ${role}`);
      const targetSession = mapSession(sourceSession);
      const match = /^discord:([0-9]{1,20})$/.exec(targetSession);
      insertMessage.run(
        id,
        targetSession,
        match ? "discord" : "import",
        match?.[1] ?? "",
        isoMillis(row.timestamp, `history ${id}.timestamp`),
        role,
        JSON.stringify(text(row.text, `history ${id}.text`)),
      );
      insertHistory.run(
        id,
        text(row.entry, `history ${id}.entry`),
        row.parent === null ? null : text(row.parent, `history ${id}.parent`),
        sourceSession,
      );
    }
    counts.historyMessages = historyRows.length;
    counts.sessions = sessionStats.size;

    counts.piSessions = copiedSessions.count;
    for (const current of scope.currentByTarget.values()) {
      const path = copiedSessions.paths.get(current);
      if (path) {
        const selectedTime = new Date(copiedSessions.latestMtime + 1_000);
        utimesSync(path, selectedTime, selectedTime);
      } else {
        warnings.push(
          `Current source session ${current} has no Pi JSONL; its History remains available`,
        );
      }
    }
    copyRegular(files.profile, join(stage, "profile.md"));

    const targetTemplate = jsonObject(
      readJsonFile(templateConfig, "target config template"),
      "target config template",
    ) as unknown as VitoConfig;
    const sourceConfig = jsonObject(readJsonFile(files.config, "agent config"), "agent config");
    const config = structuredClone(targetTemplate) as VitoConfig;
    if (sourceConfig.settings && typeof sourceConfig.settings === "object") {
      const timezone = (sourceConfig.settings as Row).timezone;
      if (typeof timezone === "string") config.settings.timezone = timezone;
    }
    if (typeof sourceConfig.model === "string")
      config.settings["pi-coding-agent"] = {
        ...(config.settings["pi-coding-agent"] ?? {}),
        model: parseModel(sourceConfig.model, "agent model"),
      };
    const sourceApps =
      sourceConfig.apps && typeof sourceConfig.apps === "object" ? (sourceConfig.apps as Row) : {};
    const discordApp =
      sourceApps.discord && typeof sourceApps.discord === "object"
        ? (sourceApps.discord as Row)
        : undefined;
    const discordConfig =
      discordApp?.config && typeof discordApp.config === "object"
        ? (discordApp.config as Row)
        : undefined;
    if (discordApp) {
      config.channels.discord = {
        ...(config.channels.discord ?? { enabled: false }),
        enabled: discordApp.enabled === true,
        ...(Array.isArray(discordConfig?.allowedChannels)
          ? { allowedChannelIds: discordConfig.allowedChannels.map(String) }
          : {}),
        ...(Array.isArray(discordConfig?.allowedUsers)
          ? { allowedUserIds: discordConfig.allowedUsers.map(String) }
          : {}),
        ...(typeof discordConfig?.dms === "boolean" ? { allowDms: discordConfig.dms } : {}),
        ...(typeof discordConfig?.responseMode === "string"
          ? { streamMode: discordConfig.responseMode as "stream" | "bundled" | "final" }
          : {}),
        settings: {
          ...(config.channels.discord?.settings ?? {}),
          ...(typeof discordConfig?.requireMention === "boolean"
            ? { requireMention: discordConfig.requireMention }
            : {}),
        },
      };
    }
    config.sessions = { ...(config.sessions ?? {}) };
    const conversationSettings =
      discordConfig?.channels && typeof discordConfig.channels === "object"
        ? (discordConfig.channels as Row)
        : {};
    for (const [channel, settings] of Object.entries(conversationSettings)) {
      if (!settings || typeof settings !== "object" || Array.isArray(settings))
        fail(`Discord conversation settings for ${channel} are invalid`);
      const sourceSettings = settings as Row;
      config.sessions[`discord:${channel}`] = {
        ...(config.sessions[`discord:${channel}`] ?? {}),
        ...(typeof sourceSettings.requireMention === "boolean"
          ? { requireMention: sourceSettings.requireMention }
          : {}),
        ...(typeof sourceSettings.responseMode === "string"
          ? { streamMode: sourceSettings.responseMode as "stream" | "bundled" | "final" }
          : {}),
      };
    }
    const applySessionRuntimeSettings = (sourceSession: string, targetSession: string) => {
      const persisted = copiedSessions.settings.get(sourceSession) ?? {};
      let model = persisted.model;
      let thinkingLevel = persisted.thinkingLevel;
      const pendingModelPath = join(controls, `model-${sourceSession}.json`);
      if (existsSync(pendingModelPath)) {
        const pending = readJsonFile(pendingModelPath, `pending model ${sourceSession}`);
        if (pending && typeof pending === "object" && typeof (pending as Row).model === "string")
          model = (pending as Row).model as string;
      }
      const pendingThinkingPath = join(controls, `thinking-${sourceSession}.json`);
      if (existsSync(pendingThinkingPath)) {
        const pending = readJsonFile(
          pendingThinkingPath,
          `pending thinking level ${sourceSession}`,
        );
        const level = pending && typeof pending === "object" ? (pending as Row).level : undefined;
        if (level === "off" || level === "low" || level === "medium" || level === "high")
          thinkingLevel = level;
      }
      if (!model && !thinkingLevel) return;
      config.sessions![targetSession] = {
        ...(config.sessions![targetSession] ?? {}),
        "pi-coding-agent": {
          ...(config.sessions![targetSession]?.["pi-coding-agent"] ?? {}),
          ...(model ? { model: parseModel(model, `session model ${sourceSession}`) } : {}),
          ...(thinkingLevel ? { thinkingLevel } : {}),
        },
      };
    };
    for (const sourceSession of copiedSessions.ids) {
      if (!scope.sessionTargets.has(sourceSession))
        applySessionRuntimeSettings(sourceSession, mapSession(sourceSession));
    }
    for (const [channel, current] of scope.currentByTarget)
      applySessionRuntimeSettings(current, `discord:${channel}`);

    const memoryRows = source.memory.prepare("SELECT * FROM chunks ORDER BY id").all() as Row[];
    const memorySources = new Map<number, Row[]>();
    if (
      source.memory
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sources'")
        .get()
    )
      for (const row of tableRows(source.memory, "sources")) {
        const id = integer(row.chunk, "memory source chunk");
        memorySources.set(id, [...(memorySources.get(id) ?? []), row]);
      }
    const ranges = new Map<number, Row>();
    if (
      source.memory
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='legacy_ranges'")
        .get()
    )
      for (const row of tableRows(source.memory, "legacy_ranges"))
        ranges.set(integer(row.chunk, "legacy range chunk"), row);
    const chunkIndices = new Map<string, number>();
    const insertChunk = embeddings.prepare(
      "INSERT INTO chunks(id,session_id,day,chunk_index,text,context,embedded_text,msg_id_start,msg_id_end,msg_count,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    );
    const insertVector = embeddings.prepare("INSERT INTO embeddings(chunk_id,vector) VALUES(?,?)");
    const insertRawChunk = embeddings.prepare(
      "INSERT INTO legacy_import_memory_chunks VALUES(?,?)",
    );
    for (const row of memoryRows) {
      const id = integer(row.id, "memory.id");
      const sourceSession = text(row.session, `memory ${id}.session`);
      const targetSession = mapSession(sourceSession);
      const day = text(row.day, `memory ${id}.day`);
      const key = `${targetSession}\0${day}`;
      const chunkIndex = chunkIndices.get(key) ?? 0;
      chunkIndices.set(key, chunkIndex + 1);
      const body = text(row.text, `memory ${id}.text`);
      const context = row.context === null ? null : text(row.context, `memory ${id}.context`);
      const range = ranges.get(id);
      const sourcesForChunk = memorySources.get(id) ?? [];
      const ids = sourcesForChunk.map((item) =>
        integer(item.message, `memory ${id} source message`),
      );
      const start = range
        ? integer(range.firstMessage, `memory ${id} range start`)
        : ids.length
          ? Math.min(...ids)
          : null;
      const end = range
        ? integer(range.lastMessage, `memory ${id} range end`)
        : ids.length
          ? Math.max(...ids)
          : null;
      const count = range
        ? integer(range.messageCount, `memory ${id} range count`)
        : new Set(ids).size;
      if (start === null || end === null)
        warnings.push(
          `Memory chunk ${id} has no resolvable message range and remains searchable only`,
        );
      const model = text(row.model, `memory ${id}.model`);
      if (model !== manifest.embedding.model)
        fail(`memory chunk ${id} uses ${model}, not declared model ${manifest.embedding.model}`);
      insertChunk.run(
        id,
        targetSession,
        day,
        chunkIndex,
        body,
        context,
        `${context ?? ""}\n\n${body}`,
        start,
        end,
        count,
        importedAt,
      );
      insertVector.run(
        id,
        vectorBuffer(row.vector, manifest.embedding.dimensions, `memory ${id}.vector`),
      );
      insertRawChunk.run(id, JSON.stringify(row));
    }
    counts.memoryChunks = memoryRows.length;

    const factSets = tableRows(source.facts, "fact_sets");
    const activeRow = source.facts
      .prepare("SELECT value FROM settings WHERE key='activeSet'")
      .get() as Row | undefined;
    const activeSet = activeRow ? text(activeRow.value, "active fact set") : "default";
    embeddings.exec("DELETE FROM fact_store_state; DELETE FROM fact_sets; DELETE FROM facts;");
    const insertSet = embeddings.prepare(
      "INSERT INTO fact_sets(id,status,source_set_id,policy_version,created_at,completed_at) VALUES(?,?,?,?,?,?)",
    );
    for (const row of factSets) {
      const id = text(row.id, "fact set id");
      insertSet.run(
        id,
        id === activeSet ? "active" : "ready",
        null,
        "vito-next-import",
        isoMillis(row.created, `fact set ${id}.created`),
        id === activeSet ? null : isoMillis(row.created, `fact set ${id}.created`),
      );
    }
    if (!factSets.some((row) => row.id === activeSet))
      fail(`active fact set ${activeSet} does not exist`);
    embeddings
      .prepare("INSERT INTO fact_store_state(id,active_set_id,updated_at) VALUES(1,?,?)")
      .run(activeSet, importedAt);
    const sourceFacts = tableRows(source.facts, "facts");
    const insertFact = embeddings.prepare(
      "INSERT INTO facts(id,fingerprint,canonical_text,kind,slot_key,canonical_value,status,authority,valid_from,valid_to,observed_at,supersedes_fact_id,entity_text,created_at,updated_at,fact_set_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    );
    const supersedes: Array<[number, number]> = [];
    for (const row of sourceFacts) {
      const id = integer(row.id, "fact.id");
      const metadata = jsonObject(row.metadata, `fact ${id}.metadata`);
      const entities = Array.isArray(metadata.entities) ? metadata.entities.map(String) : [];
      const observed =
        typeof metadata.observed === "string"
          ? isoMillis(metadata.observed, `fact ${id}.observed`)
          : isoMillis(row.created, `fact ${id}.created`);
      const updated =
        typeof metadata.updated === "string"
          ? isoMillis(metadata.updated, `fact ${id}.updated`)
          : observed;
      const parent =
        metadata.supersedesFactId === null || metadata.supersedesFactId === undefined
          ? null
          : integer(metadata.supersedesFactId, `fact ${id}.supersedesFactId`);
      insertFact.run(
        id,
        text(row.fingerprint, `fact ${id}.fingerprint`),
        text(row.claim, `fact ${id}.claim`),
        text(metadata.kind, `fact ${id}.kind`),
        metadata.slotKey === null || metadata.slotKey === undefined
          ? null
          : text(metadata.slotKey, `fact ${id}.slotKey`),
        metadata.canonicalValue === null || metadata.canonicalValue === undefined
          ? null
          : String(metadata.canonicalValue),
        text(row.status, `fact ${id}.status`),
        text(metadata.authority, `fact ${id}.authority`),
        metadata.validFrom == null ? null : String(metadata.validFrom),
        metadata.validTo == null ? null : String(metadata.validTo),
        observed,
        null,
        entities.join(" "),
        isoMillis(row.created, `fact ${id}.created`),
        updated,
        text(row.set_id, `fact ${id}.set`),
      );
      if (parent !== null) supersedes.push([id, parent]);
      for (const entity of entities)
        embeddings
          .prepare("INSERT INTO fact_entities VALUES(?,?,?)")
          .run(id, entity, entity.trim().toLowerCase());
    }
    for (const [id, parent] of supersedes) {
      if (!sourceFacts.some((row) => Number(row.id) === parent))
        fail(`fact ${id} supersedes missing fact ${parent}`);
      embeddings.prepare("UPDATE facts SET supersedes_fact_id=? WHERE id=?").run(parent, id);
    }
    for (const row of tableRows(source.facts, "evidence")) {
      const fact = integer(row.fact, "evidence.fact");
      embeddings
        .prepare(
          "INSERT INTO fact_sources(fact_id,message_id,session_id,message_type,quote,source_timestamp) VALUES(?,?,?,?,?,?)",
        )
        .run(
          fact,
          integer(row.message, "evidence.message"),
          mapSession(text(row.session, "evidence.session")),
          text(row.messageType, "evidence.messageType"),
          text(row.quote, "evidence.quote"),
          isoMillis(row.observed, "evidence.observed"),
        );
    }
    let importedFactVectors = 0;
    for (const row of tableRows(source.facts, "vectors")) {
      if (row.model !== manifest.embedding.model) continue;
      embeddings
        .prepare("INSERT INTO fact_embeddings(fact_id,vector,updated_at) VALUES(?,?,?)")
        .run(
          integer(row.fact, "fact vector fact"),
          vectorBuffer(row.vector, manifest.embedding.dimensions, `fact ${row.fact}.vector`),
          importedAt,
        );
      importedFactVectors++;
    }
    counts.factVectors = importedFactVectors;
    const chunkIds = new Set(memoryRows.map((row) => Number(row.id)));
    const sourceChunkRuns = tableRows(source.facts, "chunk_runs");
    archiveRows(embeddings, "legacy_import_fact_rows", "chunk_runs", sourceChunkRuns);
    for (const row of sourceChunkRuns) {
      if (row.set_id !== activeSet || !chunkIds.has(Number(row.chunk))) continue;
      const state = text(row.state, "chunk run state");
      const attempts = integer(row.attempts, "chunk run attempts");
      embeddings
        .prepare(
          "INSERT OR REPLACE INTO fact_chunk_runs(chunk_id,extractor_version,status,attempts,last_error,completed_at,updated_at) VALUES(?,?,?,?,?,?,?)",
        )
        .run(
          integer(row.chunk, "chunk run chunk"),
          text(row.version, "chunk run version"),
          state === "completed" ? "completed" : "failed",
          state === "processing" ? Math.max(attempts, 3) : attempts,
          state === "processing"
            ? "Interrupted during runtime migration; held from replay"
            : row.error,
          row.completed ? isoMillis(row.completed, "chunk run completed") : null,
          importedAt,
        );
    }
    for (const table of [
      "revisions",
      "coverage",
      "extraction_decisions",
      "vector_models",
      "settings",
      "fact_sets",
    ])
      if (
        source.facts.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)
      )
        archiveRows(embeddings, "legacy_import_fact_rows", table, tableRows(source.facts, table));
    counts.facts = sourceFacts.length;
    counts.factEvidence = Number(
      (source.facts.prepare("SELECT COUNT(*) count FROM evidence").get() as Row).count,
    );

    const jobs: ScriptJobConfig[] = [];
    const jobMappings: Record<string, string> = {};
    const sourceJobRows = tableRows(source.jobs, "jobs");
    for (const row of sourceJobRows) {
      const sourceJob = jsonObject(row.data, `job ${row.name}`);
      const name = text(sourceJob.name, "job.name");
      const script = regularFile(
        text(sourceJob.script, `job ${name}.script`),
        `job ${name} script`,
      );
      const stagedScript = join(stage, "jobs", `${name}.ts`);
      const targetScript = join(destination, "jobs", `${name}.ts`);
      copyRegular(script, stagedScript);
      const schedule = jsonObject(
        sourceJob.schedule,
        `job ${name}.schedule`,
      ) as ScriptJobConfig["schedule"];
      let delivery: ScriptJobConfig["delivery"];
      if (sourceJob.delivery !== undefined) {
        const sourceDelivery = jsonObject(sourceJob.delivery, `job ${name}.delivery`);
        const input = jsonObject(sourceDelivery.input, `job ${name}.delivery.input`);
        if (sourceDelivery.operation !== "discord.deliver" || typeof input.channel !== "string")
          fail(`job ${name} has unsupported delivery ${String(sourceDelivery.operation)}`);
        delivery = { channel: "discord", target: input.channel };
      }
      const job = {
        name,
        script: targetScript,
        schedule,
        ...(typeof sourceJob.session === "string"
          ? { session: mapSession(sourceJob.session) }
          : {}),
        timeoutMs: integer(sourceJob.timeoutMs, `job ${name}.timeoutMs`),
        enabled: sourceJob.enabled === true,
        ...(delivery ? { delivery } : {}),
      } satisfies ScriptJobConfig;
      jobs.push(job);
      jobMappings[name] = targetScript;
      target
        .prepare("INSERT INTO job_schedule_state(name,config,next_at) VALUES(?,?,?)")
        .run(name, JSON.stringify(job), row.next_at ?? null);
    }
    config.cron.jobs = jobs;
    const jobByName = new Map(jobs.map((job) => [job.name, job]));
    const sourceRunRows = tableRows(source.jobs, "runs");
    const orphanRuns = new Map<string, number>();
    for (const row of sourceRunRows) {
      const name = text(row.name, `job run ${row.id}.name`);
      if (!jobByName.has(name)) orphanRuns.set(name, (orphanRuns.get(name) ?? 0) + 1);
    }
    for (const [name, count] of [...orphanRuns].sort(([a], [b]) => a.localeCompare(b)))
      warnings.push(
        `Archived ${count} historical run(s) for removed job ${name}; no runnable job was created`,
      );
    counts.archivedOrphanJobRuns = [...orphanRuns.values()].reduce((sum, count) => sum + count, 0);
    for (const row of sourceRunRows) {
      const run = jsonObject(row.data, `job run ${row.id}`);
      const name = text(row.name, `job run ${row.id}.name`);
      const job = jobByName.get(name);
      if (!job) continue;
      const state = text(row.state, `job run ${row.id}.state`);
      const sourceDelivery = text(row.delivery, `job run ${row.id}.delivery`);
      const mappedState = state === "running" ? "interrupted" : state;
      const delivery = sourceDelivery === "pending" ? "unknown" : sourceDelivery;
      const targetRun = {
        id: text(row.id, "job run id"),
        job,
        scheduledAt: text(run.scheduledAt, "job run scheduledAt"),
        startedAt: text(run.startedAt, "job run startedAt"),
        finishedAt: run.finishedAt === null ? null : text(run.finishedAt, "job run finishedAt"),
        state: mappedState,
        result: run.result ?? null,
        error:
          state === "running"
            ? "Interrupted during runtime migration; not replayed"
            : (run.error ?? null),
        cancelled: !!row.cancelled,
        delivery,
        promptSessions: [],
      };
      target
        .prepare(
          "INSERT INTO job_runs(id,name,state,scheduled_at,started_at,delivery,data,cancelled) VALUES(?,?,?,?,?,?,?,?)",
        )
        .run(
          targetRun.id,
          name,
          mappedState,
          targetRun.scheduledAt,
          targetRun.startedAt,
          delivery,
          JSON.stringify(targetRun),
          targetRun.cancelled ? 1 : 0,
        );
    }
    const promptSequence = new Map<string, number>();
    for (const row of tableRows(source.jobs, "prompts")) {
      const run = text(row.run, "job prompt run");
      const sequence = promptSequence.get(run) ?? 0;
      promptSequence.set(run, sequence + 1);
      const session = mapSession(text(row.session, "job prompt session"));
      target.prepare("INSERT INTO job_run_prompts VALUES(?,?,?)").run(run, sequence, session);
      const stored = target.prepare("SELECT data FROM job_runs WHERE id=?").get(run) as
        Row | undefined;
      if (stored) {
        const value = jsonObject(stored.data, `target job run ${run}`);
        value.promptSessions = [...((value.promptSessions as string[] | undefined) ?? []), session];
        target.prepare("UPDATE job_runs SET data=? WHERE id=?").run(JSON.stringify(value), run);
      }
    }
    for (const table of ["jobs", "runs", "prompts"])
      archiveRows(target, "legacy_import_jobs", table, tableRows(source.jobs, table));
    counts.jobs = jobs.length;
    counts.jobRuns = sourceRunRows.length;

    for (const row of tableRows(source.discord, "conversations")) {
      if (row.cursor !== null)
        target
          .prepare("INSERT OR REPLACE INTO discord_cursors(channel,completed_through) VALUES(?,?)")
          .run(text(row.id, "Discord conversation id"), text(row.cursor, "Discord cursor"));
    }
    for (const row of tableRows(source.discord, "messages")) {
      const id = text(row.id, "Discord message id");
      target
        .prepare(
          "INSERT OR IGNORE INTO discord_inbox(id,channel,status,data,error,created_at,completed_at) VALUES(?,?,'interrupted',?,'Preserved during runtime migration; not replayed',?,?)",
        )
        .run(
          id,
          text(row.channel, `Discord message ${id}.channel`),
          text(row.data, `Discord message ${id}.data`),
          importedAt,
          importedAt,
        );
    }
    for (const row of tableRows(source.discord, "deliveries"))
      target
        .prepare(
          "INSERT OR IGNORE INTO discord_deliveries(id,fingerprint,status,next_piece,created_at,updated_at) VALUES(?,?,'unknown',?,?,?)",
        )
        .run(
          text(row.id, "Discord delivery id"),
          text(row.fingerprint, "Discord delivery fingerprint"),
          integer(row.next, "Discord delivery next"),
          importedAt,
          importedAt,
        );
    for (const table of ["conversations", "messages", "deliveries", "batches", "steering_choices"])
      if (
        source.discord
          .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
          .get(table)
      )
        archiveRows(target, "legacy_import_discord", table, tableRows(source.discord, table));
    counts.discordInterruptedInputs = Number(
      (source.discord.prepare("SELECT COUNT(*) count FROM messages").get() as Row).count,
    );

    for (const row of tableRows(source.usage, "usage"))
      target
        .prepare("INSERT INTO token_usage VALUES(?,?,?,?,?,?)")
        .run(
          mapSession(text(row.session, "usage.session")),
          text(row.entry, "usage.entry"),
          text(row.timestamp, "usage.timestamp"),
          text(row.provider, "usage.provider"),
          text(row.model, "usage.model"),
          text(row.data, "usage.data"),
        );
    counts.tokenUsage = Number(
      (source.usage.prepare("SELECT COUNT(*) count FROM usage").get() as Row).count,
    );

    if (manifest.discordAttachments) {
      const attachmentDir = directory(manifest.discordAttachments, "Discord attachments");
      let copied = 0;
      for (const name of readdirSync(attachmentDir).sort()) {
        const path = join(attachmentDir, name);
        if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink())
          fail(`Discord attachment ${name} is not a regular file`);
        copyRegular(path, join(stage, "legacy", "discord-outbox", name));
        copied++;
      }
      counts.discordAttachments = copied;
      if (copied)
        warnings.push(
          "Preserved staged Discord outbox files under legacy/discord-outbox; they will not be delivered automatically",
        );
    }

    const parsedConfig = vitoConfigSchema.safeParse(config);
    if (!parsedConfig.success)
      fail(
        `generated Vito config is invalid: ${parsedConfig.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
      );
    writeFileSync(
      join(stage, "vito.config.json"),
      `${JSON.stringify(parsedConfig.data, null, 2)}\n`,
      { mode: 0o600 },
    );

    for (const db of [target, embeddings]) {
      const result = db.pragma("integrity_check") as Array<{ integrity_check: string }>;
      if (result.length !== 1 || result[0]?.integrity_check !== "ok")
        fail("generated database failed integrity check");
      const foreign = db.pragma("foreign_key_check") as Row[];
      if (foreign.length) fail(`generated database has ${foreign.length} foreign-key violations`);
      db.pragma("wal_checkpoint(TRUNCATE)");
    }
    target.close();
    embeddings.close();
    target = undefined;
    embeddings = undefined;

    const report: VitoNextImportReport = {
      format: VITO_NEXT_IMPORT_FORMAT,
      state: options.dryRun ? "dry-run" : "imported",
      sourceDigest: digest,
      counts,
      warnings,
      checks: {
        sourceIntegrity: "ok",
        targetIntegrity: "ok",
        foreignKeys: "ok",
        networkCalls: 0,
        modelCalls: 0,
      },
      mappings: {
        sessions: Object.fromEntries(
          [...new Set(historyRows.map((row) => String(row.session)))]
            .sort()
            .map((id) => [id, mapSession(id)]),
        ),
        jobs: jobMappings,
      },
      files: relativeHashes(stage),
    };
    writeFileSync(join(stage, ".vito-next-import.json"), `${JSON.stringify(report, null, 2)}\n`, {
      mode: 0o600,
    });
    if (options.dryRun) {
      rmSync(stage, { recursive: true, force: true });
      return report;
    }
    renameSync(stage, destination);
    return report;
  } catch (error) {
    target?.close();
    embeddings?.close();
    rmSync(stage, { recursive: true, force: true });
    throw error;
  } finally {
    for (const db of Object.values(source)) db.close();
  }
}
