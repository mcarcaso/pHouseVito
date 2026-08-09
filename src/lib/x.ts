import type Database from "better-sqlite3";
import type { Context } from "../context/Context.js";
import type { AppProcessService } from "../services/apps/AppProcessService.js";
import type { AskApiService } from "../services/ask/AskApiService.js";
import type { DashboardAuthService } from "../services/auth/DashboardAuthService.js";
import type { ChannelRegistryService } from "../services/channels/channel-registry-service.js";
import type { DashboardChatService } from "../services/chat/DashboardChatService.js";
import type { FileService } from "../services/files/FileService.js";
import type { ProviderService } from "../services/providers/ProviderService.js";
import type { AppStore } from "../stores/apps/AppStore.js";
import type { AttachmentStore } from "../stores/attachments/AttachmentStore.js";
import type { DriveStore } from "../stores/drive/DriveStore.js";
import type { EmbeddingStore } from "../stores/embeddings/EmbeddingStore.js";
import type { CronService } from "../services/cron/CronService.js";
import type { MemoryService } from "../services/memory/MemoryService.js";
import type { SecretService } from "../services/secrets/SecretService.js";
import type { ServerLifecycleService } from "../services/server/ServerLifecycleService.js";
import type { VitoService } from "../services/vito/VitoService.js";
import type { MessageStore } from "../stores/messages/MessageStore.js";
import type { PiSessionStore } from "../stores/pi-sessions/PiSessionStore.js";
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
export const xDriveStore = (x: Context): DriveStore => x.get("driveStore") as DriveStore;
export const xAppStore = (x: Context): AppStore => x.get("appStore") as AppStore;
export const xAttachmentStore = (x: Context): AttachmentStore =>
  x.get("attachmentStore") as AttachmentStore;
export const xUserDir = (x: Context): string => x.get("userDir") as string;
export const xProjectDir = (x: Context): string => x.get("projectDir") as string;
export const xSkillsDir = (x: Context): string => x.get("skillsDir") as string;
export const xBuiltinSkillsDir = (x: Context): string =>
  x.get("builtinSkillsDir") as string;
export const xLogsDir = (x: Context): string => x.get("logsDir") as string;
export const xSecretsPath = (x: Context): string => x.get("secretsPath") as string;
export const xPiAuthPath = (x: Context): string => x.get("piAuthPath") as string;
export const xPiSessionsDir = (x: Context): string => x.get("piSessionsDir") as string;
export const xDriveDir = (x: Context): string => x.get("driveDir") as string;
export const xAppsDir = (x: Context): string => x.get("appsDir") as string;
export const xAttachmentsDir = (x: Context): string => x.get("attachmentsDir") as string;
export const xVitoService = (x: Context): VitoService => x.get("vitoService") as VitoService;
export const xAppProcessService = (x: Context): AppProcessService =>
  x.get("appProcessService") as AppProcessService;
export const xAskApiService = (x: Context): AskApiService =>
  x.get("askApiService") as AskApiService;
export const xDashboardAuthService = (x: Context): DashboardAuthService =>
  x.get("dashboardAuthService") as DashboardAuthService;
export const xChannelRegistryService = (x: Context): ChannelRegistryService =>
  x.get("channelRegistryService") as ChannelRegistryService;
export const xDashboardChatService = (x: Context): DashboardChatService =>
  x.get("dashboardChatService") as DashboardChatService;
export const xProviderService = (x: Context): ProviderService =>
  x.get("providerService") as ProviderService;
export const xFileService = (x: Context): FileService => x.get("fileService") as FileService;
export const xCronService = (x: Context): CronService => x.get("cronService") as CronService;
export const xMemoryService = (x: Context): MemoryService =>
  x.get("memoryService") as MemoryService;
export const xSecretService = (x: Context): SecretService =>
  x.get("secretService") as SecretService;
export const xServerLifecycleService = (x: Context): ServerLifecycleService =>
  x.get("serverLifecycleService") as ServerLifecycleService;
export const xPiSessionStore = (x: Context): PiSessionStore =>
  x.get("piSessionStore") as PiSessionStore;
export const xSessionStore = (x: Context): SessionStore => x.get("sessionStore") as SessionStore;
export const xSkillStore = (x: Context): SkillStore => x.get("skillStore") as SkillStore;
export const xMessageStore = (x: Context): MessageStore => x.get("messageStore") as MessageStore;
export const xTraceStore = (x: Context): TraceStore => x.get("traceStore") as TraceStore;
export const xTraceEventStore = (x: Context): TraceEventStore =>
  x.get("traceEventStore") as TraceEventStore;
