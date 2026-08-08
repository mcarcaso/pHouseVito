import type Database from "better-sqlite3";
import { join, resolve } from "node:path";
import { DefaultMemoryService } from "../services/memory/DefaultMemoryService.js";
import { FileVitoService } from "../services/vito/FileVitoService.js";
import { createEmbeddingDatabase } from "../stores/embeddings/embedding-database.js";
import { SqliteEmbeddingStore } from "../stores/embeddings/SqliteEmbeddingStore.js";
import { SqliteMessageStore } from "../stores/messages/SqliteMessageStore.js";
import { SqliteSessionStore } from "../stores/sessions/SqliteSessionStore.js";
import { FileSkillStore } from "../stores/skills/FileSkillStore.js";
import { FileTraceEventStore } from "../stores/traces/FileTraceEventStore.js";
import { FileTraceStore } from "../stores/traces/FileTraceStore.js";
import { ObjectContext } from "./ObjectContext.js";
import type { Context } from "./Context.js";

export interface RootContextArgs {
  db: Database.Database;
  userDir: string;
  skillsDir: string;
  logsDir?: string;
  builtinSkillsDir?: string;
}

export function RootContext(args: RootContextArgs): Context {
  return new ObjectContext({
    db: () => args.db,
    userDir: () => args.userDir,
    skillsDir: () => args.skillsDir,
    builtinSkillsDir: () => args.builtinSkillsDir ?? resolve(process.cwd(), "src", "skills", "builtin"),
    logsDir: () => args.logsDir ?? resolve(process.cwd(), "logs"),
    vitoService: () => new FileVitoService(),
    embeddingDb: () => createEmbeddingDatabase(join(args.userDir, "embeddings.db")),
    embeddingStore: () => new SqliteEmbeddingStore(),
    memoryService: () => new DefaultMemoryService(),
    sessionStore: () => new SqliteSessionStore(),
    skillStore: () => new FileSkillStore(),
    messageStore: () => new SqliteMessageStore(),
    traceStore: () => new FileTraceStore(),
    traceEventStore: () => new FileTraceEventStore(),
  });
}
