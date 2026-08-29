import Database from "better-sqlite3";

export function createEmbeddingDatabase(path: string): Database.Database {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
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
  return db;
}
