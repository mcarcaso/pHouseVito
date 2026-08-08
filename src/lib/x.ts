import type Database from "better-sqlite3";
import type { Context } from "../context/Context.js";
import type { EmbeddingStore } from "../stores/embeddings/EmbeddingStore.js";
import type { CronService } from "../services/cron/CronService.js";
import type { MemoryService } from "../services/memory/MemoryService.js";
import type { SecretService } from "../services/secrets/SecretService.js";
import type { VitoService } from "../services/vito/VitoService.js";
import type { MessageStore } from "../stores/messages/MessageStore.js";
import type { SessionStore } from "../stores/sessions/SessionStore.js";
import type { SkillStore } from "../stores/skills/SkillStore.js";
import type { TraceEventStore } from "../stores/traces/TraceEventStore.js";
import type { TraceStore } from "../stores/traces/TraceStore.js";

// Context accessors are the intentional casting boundary for opaque scopes.
export const xDb = (x: Context): Database.Database => x.get("db") as Database.Database;
export const xEmbeddingDb = (x: Context): Database.Database =>
  x.get("embeddingDb") as Database.Database;
export const xEmbeddingStore = (x: Context): EmbeddingStore =>
  x.get("embeddingStore") as EmbeddingStore;
export const xUserDir = (x: Context): string => x.get("userDir") as string;
export const xSkillsDir = (x: Context): string => x.get("skillsDir") as string;
export const xBuiltinSkillsDir = (x: Context): string =>
  x.get("builtinSkillsDir") as string;
export const xLogsDir = (x: Context): string => x.get("logsDir") as string;
export const xSecretsPath = (x: Context): string => x.get("secretsPath") as string;
export const xPiAuthPath = (x: Context): string => x.get("piAuthPath") as string;
export const xVitoService = (x: Context): VitoService => x.get("vitoService") as VitoService;
export const xCronService = (x: Context): CronService => x.get("cronService") as CronService;
export const xMemoryService = (x: Context): MemoryService =>
  x.get("memoryService") as MemoryService;
export const xSecretService = (x: Context): SecretService =>
  x.get("secretService") as SecretService;
export const xSessionStore = (x: Context): SessionStore => x.get("sessionStore") as SessionStore;
export const xSkillStore = (x: Context): SkillStore => x.get("skillStore") as SkillStore;
export const xMessageStore = (x: Context): MessageStore => x.get("messageStore") as MessageStore;
export const xTraceStore = (x: Context): TraceStore => x.get("traceStore") as TraceStore;
export const xTraceEventStore = (x: Context): TraceEventStore =>
  x.get("traceEventStore") as TraceEventStore;
