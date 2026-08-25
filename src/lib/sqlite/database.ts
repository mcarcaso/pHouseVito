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
      type TEXT NOT NULL CHECK(type IN ('user', 'thought', 'assistant', 'tool_start', 'tool_end')),
      content JSON NOT NULL,
      compacted INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
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

    CREATE TABLE IF NOT EXISTS voice_tasks (
      id TEXT PRIMARY KEY,
      voice_session_id TEXT NOT NULL,
      question TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
      result TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (voice_session_id) REFERENCES sessions(id)
    );
    CREATE INDEX IF NOT EXISTS idx_voice_tasks_session ON voice_tasks(voice_session_id, created_at);

    CREATE TABLE IF NOT EXISTS quick_commands (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK(status IN ('queued','transcribing','processing','completed','empty','failed')),
      transcript TEXT,
      result TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_quick_commands_created ON quick_commands(created_at DESC);

    CREATE TABLE IF NOT EXISTS push_devices (
      token TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_preferences (
      owner_id TEXT PRIMARY KEY,
      preferences TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS push_notification_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      device_token TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      data TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('queued','sending','sent','failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      receipt_id TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(message_id, device_token),
      FOREIGN KEY(message_id) REFERENCES messages(id)
    );
    CREATE INDEX IF NOT EXISTS idx_push_notification_outbox_pending ON push_notification_outbox(status, created_at);
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

  // Add archived column to messages table
  const messageColumns = db.pragma("table_info(messages)") as Array<{ name: string }>;
  if (!messageColumns.some((c) => c.name === "archived")) {
    db.exec("ALTER TABLE messages ADD COLUMN archived INTEGER NOT NULL DEFAULT 0");
    db.exec("CREATE INDEX IF NOT EXISTS idx_messages_archived ON messages(archived)");
  }

  // MIGRATION: Replace 'role' column with unified 'type' column
  // New type values: 'user', 'thought', 'assistant', 'tool_start', 'tool_end'
  const hasRoleColumn = messageColumns.some((c) => c.name === "role");
  const hasTypeColumn = messageColumns.some((c) => c.name === "type");

  if (hasRoleColumn) {
    console.log("[DB Migration] Migrating from 'role' to 'type' column...");

    const hasMessageType = messageColumns.some((c) => c.name === "message_type");

    // Add the new column if it doesn't exist yet (may already exist from partial migration)
    if (!hasTypeColumn) {
      db.exec("ALTER TABLE messages ADD COLUMN type TEXT");
    }

    // Migrate user messages (only where type is still NULL)
    db.exec("UPDATE messages SET type = 'user' WHERE role = 'user' AND type IS NULL");

    // Migrate assistant messages (only where type is still NULL)
    if (hasMessageType) {
      db.exec(
        "UPDATE messages SET type = 'assistant' WHERE role = 'assistant' AND message_type = 'final' AND type IS NULL",
      );
      db.exec(
        "UPDATE messages SET type = 'thought' WHERE role = 'assistant' AND (message_type = 'intermediate' OR message_type IS NULL) AND type IS NULL",
      );
    } else {
      db.exec("UPDATE messages SET type = 'assistant' WHERE role = 'assistant' AND type IS NULL");
    }

    // Migrate tool messages (only where type is still NULL)
    db.exec(
      `UPDATE messages SET type = 'tool_start' WHERE role = 'tool' AND json_extract(content, '$.phase') = 'start' AND type IS NULL`,
    );
    db.exec(
      `UPDATE messages SET type = 'tool_end' WHERE role = 'tool' AND json_extract(content, '$.phase') = 'end' AND type IS NULL`,
    );
    db.exec("UPDATE messages SET type = 'tool_end' WHERE role = 'tool' AND type IS NULL");

    // Map any remaining (system, etc.)
    db.exec("UPDATE messages SET type = 'assistant' WHERE type IS NULL");

    // Rebuild table to drop the old 'role' (and 'message_type') columns
    db.pragma("foreign_keys = OFF");
    db.exec(`
      CREATE TABLE messages_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        channel TEXT,
        channel_target TEXT,
        timestamp INTEGER NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('user', 'thought', 'assistant', 'tool_start', 'tool_end')),
        content JSON NOT NULL,
        compacted INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      INSERT INTO messages_new (id, session_id, channel, channel_target, timestamp, type, content, compacted, archived)
      SELECT id, session_id, channel, channel_target, timestamp, type, content, compacted, archived
      FROM messages;

      DROP TABLE messages;
      ALTER TABLE messages_new RENAME TO messages;

      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
      CREATE INDEX IF NOT EXISTS idx_messages_compacted ON messages(compacted);
      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
      CREATE INDEX IF NOT EXISTS idx_messages_archived ON messages(archived);
      CREATE INDEX IF NOT EXISTS idx_messages_type ON messages(type);
    `);

    db.pragma("foreign_keys = ON");
    console.log("[DB Migration] Migration complete — 'role' column removed, 'type' column active.");
  }

  // Traces table — snapshot of system prompt per request
  db.exec(`
    CREATE TABLE IF NOT EXISTS traces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      channel TEXT,
      timestamp INTEGER NOT NULL,
      user_message TEXT NOT NULL,
      system_prompt TEXT NOT NULL,
      model TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_traces_timestamp ON traces(timestamp);
  `);

  // Migration: Add model column if missing
  const traceColumns = db.pragma("table_info(traces)") as { name: string }[];
  if (!traceColumns.some((c) => c.name === "model")) {
    db.exec("ALTER TABLE traces ADD COLUMN model TEXT");
  }

  // Migration: Add alias column to sessions table
  const sessionColumns = db.pragma("table_info(sessions)") as Array<{ name: string }>;
  if (!sessionColumns.some((c) => c.name === "alias")) {
    db.exec("ALTER TABLE sessions ADD COLUMN alias TEXT DEFAULT NULL");
  }

  // Migration: Add author column to messages table (for tracking who sent each message)
  const msgColsForAuthor = db.pragma("table_info(messages)") as Array<{ name: string }>;
  if (!msgColsForAuthor.some((c) => c.name === "author")) {
    db.exec("ALTER TABLE messages ADD COLUMN author TEXT DEFAULT NULL");
  }

  // Supports session-list previews without scanning every unarchived message per session.
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_messages_session_archived_id ON messages(session_id, archived, id DESC)",
  );

  return db;
}
