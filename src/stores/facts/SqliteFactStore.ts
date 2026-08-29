import type { Context } from "../../context/Context.js";
import { xEmbeddingDb } from "../../lib/x.js";
import { StoreRecordNotFoundError, UnsupportedStoreOperationError } from "../Store.js";
import type {
  AtomicFact,
  CreateFactArgs,
  FactAuthority,
  FactChunkListArgs,
  FactExtractionChunk,
  FactListArgs,
  FactSource,
  FactStatus,
  FactStore,
  FactVector,
  FactStoreCommand,
  UpdateFactArgs,
} from "./FactStore.js";

interface FactRow {
  id: number;
  fact_set_id: string;
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

function activeFactSetId(x: Context): string {
  const row = xEmbeddingDb(x)
    .prepare("SELECT active_set_id FROM fact_store_state WHERE id = 1")
    .get() as { active_set_id: string } | undefined;
  return row?.active_set_id ?? "v3";
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
    const clauses: string[] = ["fact_set_id = ?"];
    const params: unknown[] = [activeFactSetId(x)];
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
             fact_set_id, fingerprint, canonical_text, kind, slot_key, canonical_value,
             status, authority, valid_from, valid_to, observed_at,
             supersedes_fact_id, entity_text
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           RETURNING *`,
        )
        .get(
          activeFactSetId(x),
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
        `UPDATE facts SET ${assignments.join(", ")}, updated_at = ?
         WHERE id = ? AND fact_set_id = ? RETURNING *`,
      )
      .get(...values, Date.now(), args.id, activeFactSetId(x)) as FactRow | undefined;
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
    if (command.type === "begin_chunk") {
      const now = Date.now();
      db.prepare(
        `INSERT INTO fact_chunk_runs
         (chunk_id, extractor_version, status, attempts, started_at, updated_at)
         VALUES (?, ?, 'processing', 1, ?, ?)
         ON CONFLICT(chunk_id, extractor_version) DO UPDATE SET
           status = 'processing', attempts = attempts + 1, last_error = NULL,
           started_at = excluded.started_at, updated_at = excluded.updated_at`,
      ).run(command.chunkId, command.extractorVersion, now, now);
      return undefined;
    }
    if (command.type === "complete_chunk") {
      const now = Date.now();
      db.prepare(
        `UPDATE fact_chunk_runs SET status = 'completed', facts_inserted = ?,
         facts_supported = ?, facts_rejected = ?, last_error = NULL,
         completed_at = ?, updated_at = ?
         WHERE chunk_id = ? AND extractor_version = ?`,
      ).run(
        command.inserted,
        command.supported,
        command.rejected,
        now,
        now,
        command.chunkId,
        command.extractorVersion,
      );
      return undefined;
    }
    if (command.type === "fail_chunk") {
      db.prepare(
        `UPDATE fact_chunk_runs SET status = 'failed', last_error = ?, updated_at = ?
         WHERE chunk_id = ? AND extractor_version = ?`,
      ).run(command.error.slice(0, 2000), Date.now(), command.chunkId, command.extractorVersion);
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

  listExtractionChunks(x: Context, args: FactChunkListArgs): FactExtractionChunk[] {
    const clauses = ["c.msg_id_start IS NOT NULL", "c.msg_id_end IS NOT NULL"];
    const params: unknown[] = [args.extractorVersion];
    if (!args.includeCompleted) {
      clauses.push(
        "(r.status IS NULL OR (r.status = 'failed' AND r.attempts < 3) OR (r.status = 'processing' AND r.attempts < 3 AND r.updated_at < ?))",
      );
      params.push(Date.now() - 15 * 60 * 1000);
    }
    if (args.sessionId) {
      clauses.push("c.session_id = ?");
      params.push(args.sessionId);
    }
    if (args.afterMessageId !== undefined) {
      clauses.push("c.msg_id_end > ?");
      params.push(args.afterMessageId);
    }
    params.push(args.limit ?? 100);
    const rows = xEmbeddingDb(x)
      .prepare(
        `SELECT c.id, c.session_id, c.day,
                COALESCE(c.embedded_text, CASE WHEN c.context IS NULL THEN c.text ELSE c.context || '\n\n' || c.text END) contextualized_text,
                c.context, c.msg_id_start, c.msg_id_end, c.msg_count,
                COALESCE(r.attempts, 0) attempts
         FROM chunks c
         LEFT JOIN fact_chunk_runs r
           ON r.chunk_id = c.id AND r.extractor_version = ?
         WHERE ${clauses.join(" AND ")}
         ORDER BY c.msg_id_start ASC, c.id ASC
         LIMIT ?`,
      )
      .all(...params) as Array<{
      id: number;
      session_id: string;
      day: string;
      contextualized_text: string;
      context: string | null;
      msg_id_start: number;
      msg_id_end: number;
      msg_count: number;
      attempts: number;
    }>;
    return rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      day: row.day,
      contextualizedText: row.contextualized_text,
      context: row.context,
      messageIdStart: row.msg_id_start,
      messageIdEnd: row.msg_id_end,
      messageCount: row.msg_count,
      attempts: row.attempts,
    }));
  }

  listFactVectors(x: Context): FactVector[] {
    const rows = xEmbeddingDb(x)
      .prepare(
        `SELECT e.fact_id, e.vector FROM fact_embeddings e
         JOIN facts f ON f.id = e.fact_id
         WHERE f.fact_set_id = ?
         ORDER BY e.fact_id`,
      )
      .all(activeFactSetId(x)) as Array<{ fact_id: number; vector: Buffer }>;
    return rows.map((row) => {
      const bytes = Uint8Array.from(row.vector);
      return { factId: row.fact_id, vector: new Float32Array(bytes.buffer) };
    });
  }

  listFactsMissingEmbeddings(x: Context, limit: number): AtomicFact[] {
    const rows = xEmbeddingDb(x)
      .prepare(
        `SELECT f.* FROM facts f
         LEFT JOIN fact_embeddings e ON e.fact_id = f.id
         WHERE f.fact_set_id = ? AND e.fact_id IS NULL
         ORDER BY f.id ASC LIMIT ?`,
      )
      .all(activeFactSetId(x), limit) as FactRow[];
    return this.hydrate(x, rows);
  }

  putFactEmbeddings(x: Context, embeddings: FactVector[]): void {
    const statement = xEmbeddingDb(x).prepare(
      `INSERT INTO fact_embeddings (fact_id, vector, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(fact_id) DO UPDATE SET vector = excluded.vector, updated_at = excluded.updated_at`,
    );
    const write = xEmbeddingDb(x).transaction(() => {
      for (const embedding of embeddings) {
        const vector = Buffer.from(
          embedding.vector.buffer,
          embedding.vector.byteOffset,
          embedding.vector.byteLength,
        );
        statement.run(embedding.factId, vector, Date.now());
      }
    });
    write();
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
         WHERE facts_fts MATCH ? AND f.fact_set_id = ? AND f.status IN (${placeholders})
         ORDER BY facts_fts.rank
         LIMIT ?`,
      )
      .all(args.query, activeFactSetId(x), ...statuses, args.limit) as Array<
      FactRow & { search_score: number }
    >;
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
