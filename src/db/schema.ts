import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname } from "path";

export function createDatabase(dbPath: string): Database.Database {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);

  // Performance settings
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      channel TEXT,
      channel_target TEXT,
      created_at INTEGER NOT NULL,
      last_active_at INTEGER NOT NULL,
      config JSON DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      channel TEXT,
      channel_target TEXT,
      timestamp INTEGER NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system', 'tool')),
      content JSON NOT NULL,
      compacted INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      embedding BLOB
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_messages_compacted ON messages(compacted);
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
    CREATE INDEX IF NOT EXISTS idx_sessions_last_active ON sessions(last_active_at);
  `);

  // Migrations for existing databases
  const columns = db.pragma("table_info(sessions)") as Array<{ name: string }>;
  if (!columns.some((c) => c.name === "config")) {
    db.exec("ALTER TABLE sessions ADD COLUMN config JSON DEFAULT '{}'");
  }

  // Add title column to memories table
  const memoryColumns = db.pragma("table_info(memories)") as Array<{ name: string }>;
  if (!memoryColumns.some((c) => c.name === "title")) {
    db.exec("ALTER TABLE memories ADD COLUMN title TEXT NOT NULL DEFAULT ''");
  }

  return db;
}
