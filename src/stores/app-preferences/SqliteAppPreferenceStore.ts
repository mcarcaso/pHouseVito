import type { Context } from "../../context/Context.js";
import { xDb } from "../../lib/x.js";
import { appPreferencesSchema, type AppPreferences } from "../../shared/schemas/app-preferences.js";
import type { AppPreferenceRecord, AppPreferenceStore } from "./AppPreferenceStore.js";

interface AppPreferenceRow {
  owner_id: string;
  preferences: string;
  updated_at: number;
}

function toRecord(row: AppPreferenceRow): AppPreferenceRecord {
  return {
    ownerId: row.owner_id,
    preferences: appPreferencesSchema.parse(JSON.parse(row.preferences)),
    updatedAt: row.updated_at,
  };
}

export class SqliteAppPreferenceStore implements AppPreferenceStore {
  get(x: Context, ownerId: string): AppPreferenceRecord | null {
    const row = xDb(x)
      .prepare("SELECT owner_id, preferences, updated_at FROM app_preferences WHERE owner_id = ?")
      .get(ownerId) as AppPreferenceRow | undefined;
    return row ? toRecord(row) : null;
  }

  patch(
    x: Context,
    ownerId: string,
    preferences: AppPreferences,
    updatedAt: number,
  ): AppPreferenceRecord {
    const current = this.get(x, ownerId)?.preferences ?? {};
    const merged = appPreferencesSchema.parse({ ...current, ...preferences });
    xDb(x)
      .prepare(
        `INSERT INTO app_preferences (owner_id, preferences, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(owner_id) DO UPDATE SET
           preferences = excluded.preferences,
           updated_at = excluded.updated_at`,
      )
      .run(ownerId, JSON.stringify(merged), updatedAt);
    return { ownerId, preferences: merged, updatedAt };
  }
}
