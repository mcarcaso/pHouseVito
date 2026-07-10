import type Database from "better-sqlite3";
import type { Context } from "../context/Context.js";
import type { Queries } from "../db/queries.js";
import type { MessageStore } from "../stores/messages/MessageStore.js";
import type { SessionStore } from "../stores/sessions/SessionStore.js";
import type { TraceStore } from "../stores/traces/TraceStore.js";
import type { VitoConfig } from "../types.js";

export const xDb = (x: Context) => x.get("db") as Database.Database;
export const xConfig = (x: Context) => x.get("config") as VitoConfig;
export const xSoul = (x: Context) => x.get("soul") as string;
export const xSkillsDir = (x: Context) => x.get("skillsDir") as string;
export const xQueries = (x: Context) => x.get("queries") as Queries;
export const xSessionStore = (x: Context) => x.get("sessionStore") as SessionStore;
export const xMessageStore = (x: Context) => x.get("messageStore") as MessageStore;
export const xTraceStore = (x: Context) => x.get("traceStore") as TraceStore;
