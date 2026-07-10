import type { Context } from "../../context/Context.js";
import { xDb } from "../../lib/x.js";
import type { TraceRow } from "../../types.js";
import type { TraceStore } from "./TraceStore.js";

export class SqliteTraceStore implements TraceStore {
  create(x: Context, args: Omit<TraceRow, "id">): void {
    xDb(x)
      .prepare(
        `INSERT INTO traces (session_id, channel, timestamp, user_message, system_prompt, model)
         VALUES (@session_id, @channel, @timestamp, @user_message, @system_prompt, @model)`
      )
      .run(args);
  }

  listRecent(x: Context, args: { limit?: number } = {}): Omit<TraceRow, "system_prompt">[] {
    return xDb(x)
      .prepare("SELECT id, session_id, channel, timestamp, user_message, model FROM traces ORDER BY timestamp DESC LIMIT ?")
      .all(args.limit ?? 50) as Omit<TraceRow, "system_prompt">[];
  }

  get(x: Context, id: number): TraceRow | undefined {
    return xDb(x)
      .prepare("SELECT * FROM traces WHERE id = ?")
      .get(id) as TraceRow | undefined;
  }
}
