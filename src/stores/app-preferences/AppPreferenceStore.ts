import type { Context } from "../../context/Context.js";
import type { AppPreferences } from "../../shared/schemas/app-preferences.js";

export interface AppPreferenceRecord {
  ownerId: string;
  preferences: AppPreferences;
  updatedAt: number;
}

export interface AppPreferenceStore {
  get(x: Context, ownerId: string): AppPreferenceRecord | null;
  patch(
    x: Context,
    ownerId: string,
    preferences: AppPreferences,
    updatedAt: number,
  ): AppPreferenceRecord;
}
