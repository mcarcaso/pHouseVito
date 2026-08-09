import type Database from "better-sqlite3";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { Pm2AppProcessService } from "../services/apps/Pm2AppProcessService.js";
import { DefaultAskApiService } from "../services/ask/DefaultAskApiService.js";
import { InMemoryDashboardAuthService } from "../services/auth/InMemoryDashboardAuthService.js";
import { DefaultChannelRegistryService } from "../services/channels/DefaultChannelRegistryService.js";
import { DefaultDashboardChatService } from "../services/chat/DefaultDashboardChatService.js";
import { CronerCronService } from "../services/cron/CronerCronService.js";
import { FileSystemFileService } from "../services/files/FileSystemFileService.js";
import { DefaultMemoryService } from "../services/memory/DefaultMemoryService.js";
import { PiOrchestratorService } from "../services/orchestrator/PiOrchestratorService.js";
import { DefaultProviderService } from "../services/providers/DefaultProviderService.js";
import { FileSecretService } from "../services/secrets/FileSecretService.js";
import { DefaultServerLifecycleService } from "../services/server/DefaultServerLifecycleService.js";
import { FileVitoService } from "../services/vito/FileVitoService.js";
import { FileAppStore } from "../stores/apps/FileAppStore.js";
import { FileAttachmentStore } from "../stores/attachments/FileAttachmentStore.js";
import { FileDriveStore } from "../stores/drive/FileDriveStore.js";
import { createEmbeddingDatabase } from "../stores/embeddings/embedding-database.js";
import { SqliteEmbeddingStore } from "../stores/embeddings/SqliteEmbeddingStore.js";
import { SqliteMessageStore } from "../stores/messages/SqliteMessageStore.js";
import { FilePiSessionStore } from "../stores/pi-sessions/FilePiSessionStore.js";
import { SqliteSessionStore } from "../stores/sessions/SqliteSessionStore.js";
import { FileSkillStore } from "../stores/skills/FileSkillStore.js";
import { FileTraceEventStore } from "../stores/traces/FileTraceEventStore.js";
import { FileTraceStore } from "../stores/traces/FileTraceStore.js";
import { ObjectContext } from "./ObjectContext.js";
import type { Context } from "./Context.js";

export interface RootContextArgs {
  db: Database.Database;
  userDir: string;
  projectDir?: string;
  skillsDir: string;
  logsDir?: string;
  builtinSkillsDir?: string;
  secretsPath?: string;
  piAuthPath?: string;
  piSessionsDir?: string;
  driveDir?: string;
  appsDir?: string;
  attachmentsDir?: string;
}

export function RootContext(args: RootContextArgs): Context {
  return new ObjectContext({
    db: () => args.db,
    userDir: () => args.userDir,
    projectDir: () => args.projectDir ?? process.cwd(),
    skillsDir: () => args.skillsDir,
    builtinSkillsDir: () => args.builtinSkillsDir ?? resolve(process.cwd(), "src", "skills", "builtin"),
    logsDir: () => args.logsDir ?? resolve(process.cwd(), "logs"),
    secretsPath: () => args.secretsPath ?? join(args.userDir, "secrets.json"),
    piAuthPath: () => args.piAuthPath ?? resolve(homedir(), ".pi", "agent", "auth.json"),
    piSessionsDir: () => args.piSessionsDir ?? join(args.userDir, "pi-sessions"),
    driveDir: () => args.driveDir ?? join(args.userDir, "drive"),
    appsDir: () => args.appsDir ?? join(args.userDir, "apps"),
    attachmentsDir: () => args.attachmentsDir ?? resolve(process.cwd(), "data", "attachments"),
    vitoService: () => new FileVitoService(),
    fileService: () => new FileSystemFileService(),
    appProcessService: () => new Pm2AppProcessService(),
    askApiService: () => new DefaultAskApiService(),
    dashboardAuthService: () => new InMemoryDashboardAuthService(),
    channelRegistryService: () => new DefaultChannelRegistryService(),
    dashboardChatService: () => new DefaultDashboardChatService(),
    cronService: () => new CronerCronService(),
    providerService: () => new DefaultProviderService(),
    appStore: () => new FileAppStore(),
    attachmentStore: () => new FileAttachmentStore(),
    driveStore: () => new FileDriveStore(),
    embeddingDb: () => createEmbeddingDatabase(join(args.userDir, "embeddings.db")),
    embeddingStore: () => new SqliteEmbeddingStore(),
    memoryService: () => new DefaultMemoryService(),
    orchestratorService: () => new PiOrchestratorService(),
    secretService: () => new FileSecretService(),
    serverLifecycleService: () => new DefaultServerLifecycleService(),
    piSessionStore: () => new FilePiSessionStore(),
    sessionStore: () => new SqliteSessionStore(),
    skillStore: () => new FileSkillStore(),
    messageStore: () => new SqliteMessageStore(),
    traceStore: () => new FileTraceStore(),
    traceEventStore: () => new FileTraceEventStore(),
  });
}
