import Database from "better-sqlite3";

export function createEmbeddingDatabase(path: string): Database.Database {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS fact_sets (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK(status IN ('building', 'ready', 'active', 'retired')),
      source_set_id TEXT,
      policy_version TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      completed_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS fact_store_state (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      active_set_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    INSERT OR IGNORE INTO fact_sets (id, status, policy_version)
      VALUES ('v3', 'active', 'atomic-facts-v3-contextualized-chunks');
    INSERT OR IGNORE INTO fact_store_state (id, active_set_id)
      VALUES (1, 'v3');

    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      day TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      text TEXT NOT NULL,
      context TEXT,
      embedded_text TEXT,
      msg_id_start INTEGER,
      msg_id_end INTEGER,
      msg_count INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(session_id, day, chunk_index)
    );

    CREATE TABLE IF NOT EXISTS embeddings (
      chunk_id INTEGER PRIMARY KEY,
      vector BLOB NOT NULL,
      FOREIGN KEY (chunk_id) REFERENCES chunks(id)
    );

    CREATE INDEX IF NOT EXISTS idx_chunks_session_day ON chunks(session_id, day);
    CREATE INDEX IF NOT EXISTS idx_chunks_day ON chunks(day);

    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      text,
      content='chunks',
      content_rowid='id'
    );

    CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
      INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
    END;
    CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
      INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES('delete', old.id, old.text);
    END;
    CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
      INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES('delete', old.id, old.text);
      INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
    END;

    CREATE TABLE IF NOT EXISTS facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fingerprint TEXT NOT NULL UNIQUE,
      canonical_text TEXT NOT NULL,
      kind TEXT NOT NULL,
      slot_key TEXT,
      canonical_value TEXT,
      status TEXT NOT NULL,
      authority TEXT NOT NULL,
      valid_from TEXT,
      valid_to TEXT,
      observed_at INTEGER NOT NULL,
      supersedes_fact_id INTEGER,
      entity_text TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      FOREIGN KEY (supersedes_fact_id) REFERENCES facts(id)
    );

    CREATE TABLE IF NOT EXISTS fact_embeddings (
      fact_id INTEGER PRIMARY KEY,
      vector BLOB NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      FOREIGN KEY (fact_id) REFERENCES facts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS fact_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fact_id INTEGER NOT NULL,
      message_id INTEGER NOT NULL,
      session_id TEXT NOT NULL,
      message_type TEXT NOT NULL,
      quote TEXT NOT NULL,
      source_timestamp INTEGER NOT NULL,
      FOREIGN KEY (fact_id) REFERENCES facts(id) ON DELETE CASCADE,
      UNIQUE(fact_id, message_id, quote)
    );

    CREATE TABLE IF NOT EXISTS fact_entities (
      fact_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      FOREIGN KEY (fact_id) REFERENCES facts(id) ON DELETE CASCADE,
      UNIQUE(fact_id, normalized_name)
    );

    CREATE TABLE IF NOT EXISTS fact_checkpoints (
      session_id TEXT NOT NULL,
      extractor_version TEXT NOT NULL,
      message_id INTEGER NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      PRIMARY KEY(session_id, extractor_version)
    );

    CREATE TABLE IF NOT EXISTS fact_reconciliation_decisions (
      fact_set_id TEXT NOT NULL,
      old_fact_id INTEGER NOT NULL,
      new_fact_id INTEGER,
      action TEXT NOT NULL,
      target_ids TEXT NOT NULL DEFAULT '[]',
      reason TEXT NOT NULL,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      PRIMARY KEY(fact_set_id, old_fact_id),
      FOREIGN KEY(new_fact_id) REFERENCES facts(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS fact_ingestion_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fact_set_id TEXT NOT NULL,
      chunk_id INTEGER NOT NULL,
      candidate_text TEXT NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('create','duplicate','update','conflict','merge','discard')),
      target_ids TEXT NOT NULL DEFAULT '[]',
      new_fact_id INTEGER,
      reason TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE CASCADE,
      FOREIGN KEY (new_fact_id) REFERENCES facts(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS fact_chunk_runs (
      chunk_id INTEGER NOT NULL,
      extractor_version TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('processing', 'completed', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      facts_inserted INTEGER NOT NULL DEFAULT 0,
      facts_supported INTEGER NOT NULL DEFAULT 0,
      facts_rejected INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      started_at INTEGER,
      completed_at INTEGER,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      PRIMARY KEY(chunk_id, extractor_version),
      FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_fact_chunk_runs_status
      ON fact_chunk_runs(extractor_version, status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_fact_ingestion_decisions_chunk
      ON fact_ingestion_decisions(fact_set_id, chunk_id, id);
    CREATE INDEX IF NOT EXISTS idx_facts_slot_status ON facts(slot_key, status);
    CREATE INDEX IF NOT EXISTS idx_facts_status_observed ON facts(status, observed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_fact_sources_message ON fact_sources(message_id);
    CREATE INDEX IF NOT EXISTS idx_fact_entities_name ON fact_entities(normalized_name);

    CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts USING fts5(
      canonical_text,
      slot_key,
      canonical_value,
      entity_text,
      content='facts',
      content_rowid='id'
    );

    CREATE TRIGGER IF NOT EXISTS facts_ai AFTER INSERT ON facts BEGIN
      INSERT INTO facts_fts(rowid, canonical_text, slot_key, canonical_value, entity_text)
      VALUES (new.id, new.canonical_text, new.slot_key, new.canonical_value, new.entity_text);
    END;
    CREATE TRIGGER IF NOT EXISTS facts_ad AFTER DELETE ON facts BEGIN
      INSERT INTO facts_fts(facts_fts, rowid, canonical_text, slot_key, canonical_value, entity_text)
      VALUES('delete', old.id, old.canonical_text, old.slot_key, old.canonical_value, old.entity_text);
    END;
    CREATE TRIGGER IF NOT EXISTS facts_au AFTER UPDATE ON facts BEGIN
      INSERT INTO facts_fts(facts_fts, rowid, canonical_text, slot_key, canonical_value, entity_text)
      VALUES('delete', old.id, old.canonical_text, old.slot_key, old.canonical_value, old.entity_text);
      INSERT INTO facts_fts(rowid, canonical_text, slot_key, canonical_value, entity_text)
      VALUES (new.id, new.canonical_text, new.slot_key, new.canonical_value, new.entity_text);
    END;
  `);

  const factColumns = db.prepare("PRAGMA table_info(facts)").all() as Array<{ name: string }>;
  if (!factColumns.some((column) => column.name === "fact_set_id")) {
    db.exec("ALTER TABLE facts ADD COLUMN fact_set_id TEXT NOT NULL DEFAULT 'v3'");
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_facts_set_slot_status
      ON facts(fact_set_id, slot_key, status);
    CREATE INDEX IF NOT EXISTS idx_facts_set_status_observed
      ON facts(fact_set_id, status, observed_at DESC);
  `);
  return db;
}
