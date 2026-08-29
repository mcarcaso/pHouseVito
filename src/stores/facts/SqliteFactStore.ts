import type { Context } from "../../context/Context.js";
import { xEmbeddingDb } from "../../lib/x.js";
import { StoreRecordNotFoundError, UnsupportedStoreOperationError } from "../Store.js";
import type {
  AtomicFact,
  CreateFactArgs,
  FactAuthority,
  FactListArgs,
  FactSource,
  FactStatus,
  FactStore,
  FactStoreCommand,
  UpdateFactArgs,
} from "./FactStore.js";

interface FactRow {
  id: number;
  fingerprint: string;
  canonical_text: string;
  kind: AtomicFact["kind"];
  slot_key: string | null;
  canonical_value: string | null;
  status: FactStatus;
  authority: FactAuthority;
  valid_from: string | null;
  valid_to: string | null;
  observed_at: number;
  supersedes_fact_id: number | null;
  created_at: number;
  updated_at: number;
}

interface SourceRow {
  id: number;
  fact_id: number;
  message_id: number;
  session_id: string;
  message_type: FactSource["messageType"];
  quote: string;
  source_timestamp: number;
}

const authorityRank: Record<FactAuthority, number> = {
  assistant_reported: 0,
  user_explicit: 1,
  tool_verified: 2,
};

function parseCanonicalValue(value: string | null): unknown {
  if (value === null) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeEntity(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export class SqliteFactStore implements FactStore {
  private hydrate(x: Context, rows: FactRow[]): AtomicFact[] {
    if (rows.length === 0) return [];
    const db = xEmbeddingDb(x);
    const ids = rows.map((row) => row.id);
    const placeholders = ids.map(() => "?").join(", ");
    const sources = db
      .prepare(`SELECT * FROM fact_sources WHERE fact_id IN (${placeholders}) ORDER BY id`)
      .all(...ids) as SourceRow[];
    const entities = db
      .prepare(
        `SELECT fact_id, name FROM fact_entities WHERE fact_id IN (${placeholders}) ORDER BY rowid`,
      )
      .all(...ids) as Array<{ fact_id: number; name: string }>;
    const sourcesByFact = new Map<number, FactSource[]>();
    for (const source of sources) {
      const values = sourcesByFact.get(source.fact_id) ?? [];
      values.push({
        id: source.id,
        factId: source.fact_id,
        messageId: source.message_id,
        sessionId: source.session_id,
        messageType: source.message_type,
        quote: source.quote,
        sourceTimestamp: source.source_timestamp,
      });
      sourcesByFact.set(source.fact_id, values);
    }
    const entitiesByFact = new Map<number, string[]>();
    for (const entity of entities) {
      const values = entitiesByFact.get(entity.fact_id) ?? [];
      values.push(entity.name);
      entitiesByFact.set(entity.fact_id, values);
    }
    return rows.map((row) => ({
      id: row.id,
      fingerprint: row.fingerprint,
      canonicalText: row.canonical_text,
      kind: row.kind,
      slotKey: row.slot_key,
      canonicalValue: parseCanonicalValue(row.canonical_value),
      status: row.status,
      authority: row.authority,
      validFrom: row.valid_from,
      validTo: row.valid_to,
      observedAt: row.observed_at,
      supersedesFactId: row.supersedes_fact_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      entities: entitiesByFact.get(row.id) ?? [],
      sources: sourcesByFact.get(row.id) ?? [],
    }));
  }

  list(x: Context, args: FactListArgs): AtomicFact[] {
    if (args.ids?.length === 0 || args.fingerprints?.length === 0 || args.slotKeys?.length === 0) {
      return [];
    }
    const clauses: string[] = [];
    const params: unknown[] = [];
    const addIn = (column: string, values: readonly unknown[] | undefined) => {
      if (!values) return;
      clauses.push(`${column} IN (${values.map(() => "?").join(", ")})`);
      params.push(...values);
    };
    addIn("id", args.ids);
    addIn("fingerprint", args.fingerprints);
    addIn("slot_key", args.slotKeys);
    addIn("status", args.statuses);
    addIn("kind", args.kinds);
    addIn("authority", args.authorities);
    if (args.asOf) {
      clauses.push("(valid_from IS NULL OR valid_from <= ?)");
      clauses.push("(valid_to IS NULL OR valid_to >= ?)");
      params.push(args.asOf, args.asOf);
    }
    const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
    const order = args.order === "oldest" ? "observed_at ASC, id ASC" : "observed_at DESC, id DESC";
    const limit = args.limit === undefined ? "" : " LIMIT ?";
    if (args.limit !== undefined) params.push(args.limit);
    const rows = xEmbeddingDb(x)
      .prepare(`SELECT * FROM facts${where} ORDER BY ${order}${limit}`)
      .all(...params) as FactRow[];
    return this.hydrate(x, rows);
  }

  count(x: Context, args: FactListArgs): number {
    // Count through list to keep filtering behavior in one place; fact sets are
    // intentionally compact compared with raw messages.
    return this.list(x, { ...args, limit: undefined }).length;
  }

  create(x: Context, args: CreateFactArgs): AtomicFact {
    const db = xEmbeddingDb(x);
    const create = db.transaction(() => {
      const entityText = args.entities.join(" ");
      const row = db
        .prepare(
          `INSERT INTO facts (
             fingerprint, canonical_text, kind, slot_key, canonical_value,
             status, authority, valid_from, valid_to, observed_at,
             supersedes_fact_id, entity_text
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           RETURNING *`,
        )
        .get(
          args.fingerprint,
          args.canonicalText,
          args.kind,
          args.slotKey,
          args.canonicalValue === null ? null : JSON.stringify(args.canonicalValue),
          args.status,
          args.authority,
          args.validFrom,
          args.validTo,
          args.observedAt,
          args.supersedesFactId,
          entityText,
        ) as FactRow;
      for (const entity of args.entities) {
        db.prepare(
          "INSERT OR IGNORE INTO fact_entities (fact_id, name, normalized_name) VALUES (?, ?, ?)",
        ).run(row.id, entity.trim(), normalizeEntity(entity));
      }
      this.insertSources(db, row.id, args.sources);
      return row;
    });
    const row = create();
    return this.hydrate(x, [row])[0];
  }

  update(x: Context, args: UpdateFactArgs): AtomicFact {
    const entries = Object.entries(args.changes).filter(([, value]) => value !== undefined);
    if (entries.length === 0) {
      const existing = this.list(x, { ids: [args.id] })[0];
      if (!existing) throw new StoreRecordNotFoundError(`Fact not found: ${args.id}`);
      return existing;
    }
    const columns: Record<string, string> = {
      status: "status",
      validTo: "valid_to",
      supersedesFactId: "supersedes_fact_id",
    };
    const assignments = entries.map(([key]) => `${columns[key]} = ?`);
    const values = entries.map(([, value]) => value);
    const row = xEmbeddingDb(x)
      .prepare(
        `UPDATE facts SET ${assignments.join(", ")}, updated_at = ? WHERE id = ? RETURNING *`,
      )
      .get(...values, Date.now(), args.id) as FactRow | undefined;
    if (!row) throw new StoreRecordNotFoundError(`Fact not found: ${args.id}`);
    return this.hydrate(x, [row])[0];
  }

  delete(_x: Context, _args: never): never {
    throw new UnsupportedStoreOperationError("Atomic facts are append-only derived records");
  }

  cmd(x: Context, command: FactStoreCommand): unknown {
    const db = xEmbeddingDb(x);
    if (command.type === "get_checkpoint") {
      const row = db
        .prepare(
          "SELECT message_id FROM fact_checkpoints WHERE session_id = ? AND extractor_version = ?",
        )
        .get(command.sessionId, command.extractorVersion) as { message_id: number } | undefined;
      return row?.message_id ?? null;
    }
    if (command.type === "set_checkpoint") {
      db.prepare(
        `INSERT INTO fact_checkpoints (session_id, extractor_version, message_id, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(session_id, extractor_version) DO UPDATE SET
           message_id = MAX(message_id, excluded.message_id),
           updated_at = excluded.updated_at`,
      ).run(command.sessionId, command.extractorVersion, command.messageId, Date.now());
      return undefined;
    }

    const current = this.list(x, { ids: [command.factId] })[0];
    if (!current) throw new StoreRecordNotFoundError(`Fact not found: ${command.factId}`);
    const authority =
      authorityRank[command.authority] > authorityRank[current.authority]
        ? command.authority
        : current.authority;
    const add = db.transaction(() => {
      this.insertSources(db, command.factId, command.sources);
      db.prepare(
        `UPDATE facts SET authority = ?, observed_at = MAX(observed_at, ?), updated_at = ? WHERE id = ?`,
      ).run(authority, command.observedAt, Date.now(), command.factId);
    });
    add();
    return this.list(x, { ids: [command.factId] })[0];
  }

  searchFts(
    x: Context,
    args: { query: string; limit: number; statuses?: FactStatus[] },
  ): Array<{ fact: AtomicFact; score: number }> {
    const statuses = args.statuses ?? ["active", "historical", "disputed"];
    if (statuses.length === 0) return [];
    const placeholders = statuses.map(() => "?").join(", ");
    const rows = xEmbeddingDb(x)
      .prepare(
        `SELECT f.*, facts_fts.rank * -1 AS search_score
         FROM facts_fts
         JOIN facts f ON f.id = facts_fts.rowid
         WHERE facts_fts MATCH ? AND f.status IN (${placeholders})
         ORDER BY facts_fts.rank
         LIMIT ?`,
      )
      .all(args.query, ...statuses, args.limit) as Array<FactRow & { search_score: number }>;
    const facts = this.hydrate(x, rows);
    return facts.map((fact, index) => ({ fact, score: rows[index].search_score }));
  }

  private insertSources(
    db: ReturnType<typeof xEmbeddingDb>,
    factId: number,
    sources: CreateFactArgs["sources"],
  ): void {
    const statement = db.prepare(
      `INSERT OR IGNORE INTO fact_sources
       (fact_id, message_id, session_id, message_type, quote, source_timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const source of sources) {
      statement.run(
        factId,
        source.messageId,
        source.sessionId,
        source.messageType,
        source.quote,
        source.sourceTimestamp,
      );
    }
  }
}
