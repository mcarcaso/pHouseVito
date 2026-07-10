import type Database from "better-sqlite3";
import { Queries } from "../db/queries.js";
import { SqliteMessageStore } from "../stores/messages/SqliteMessageStore.js";
import { SqliteSessionStore } from "../stores/sessions/SqliteSessionStore.js";
import { SqliteTraceStore } from "../stores/traces/SqliteTraceStore.js";
import type { VitoConfig } from "../types.js";
import { ObjectContext } from "./ObjectContext.js";
import type { Context } from "./Context.js";

export interface RootContextArgs {
  db: Database.Database;
  config: VitoConfig;
  soul: string;
  skillsDir: string;
}

export function RootContext(args: RootContextArgs): Context {
  return new ObjectContext({
    db: () => args.db,
    config: () => args.config,
    soul: () => args.soul,
    skillsDir: () => args.skillsDir,
    sessionStore: () => new SqliteSessionStore(),
    messageStore: () => new SqliteMessageStore(),
    traceStore: () => new SqliteTraceStore(),
    queries: () => new Queries(args.db),
  });
}
