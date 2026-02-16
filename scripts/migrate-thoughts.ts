/**
 * One-off migration: Fix thought/assistant classification.
 *
 * For each session, groups messages between user messages. Within each group,
 * the LAST thought/assistant message becomes 'assistant' (the final response);
 * all earlier ones become 'thought' (intermediate).
 *
 * Example:  user, thought, tool, thought, thought
 *        →  user, thought, tool, thought, assistant
 */

import Database from "better-sqlite3";
import { resolve } from "path";

const dbPath = resolve(process.cwd(), "user/vito.db");
const db = new Database(dbPath);

interface Row {
  id: number;
  session_id: string;
  type: string;
}

// Get all messages ordered by session then id
const messages = db
  .prepare("SELECT id, session_id, type FROM messages ORDER BY session_id, id ASC")
  .all() as Row[];

// Group by session
const sessions = new Map<string, Row[]>();
for (const msg of messages) {
  if (!sessions.has(msg.session_id)) sessions.set(msg.session_id, []);
  sessions.get(msg.session_id)!.push(msg);
}

const markAssistant = db.prepare("UPDATE messages SET type = 'assistant' WHERE id = ?");
const markThought = db.prepare("UPDATE messages SET type = 'thought' WHERE id = ?");

let promoted = 0;
let demoted = 0;

const runAll = db.transaction(() => {
  for (const [sessionId, msgs] of sessions) {
    // Collect assistant/thought IDs between user messages
    let groupIds: number[] = [];

    const flushGroup = () => {
      if (groupIds.length === 0) {
        return;
      }
      // Last one becomes 'assistant', rest become 'thought'
      for (let i = 0; i < groupIds.length - 1; i++) {
        markThought.run(groupIds[i]);
        demoted++;
      }
      markAssistant.run(groupIds[groupIds.length - 1]);
      promoted++;
      groupIds = [];
    };

    for (const msg of msgs) {
      if (msg.type === "user") {
        flushGroup();
      } else if (msg.type === "assistant" || msg.type === "thought") {
        groupIds.push(msg.id);
      }
      // tool_start, tool_end — skip
    }

    // Flush the last group
    flushGroup();
  }
});

runAll();

console.log(`Done. Promoted ${promoted} to 'assistant', demoted ${demoted} to 'thought' across ${sessions.size} sessions.`);

db.close();
