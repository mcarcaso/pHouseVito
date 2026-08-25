import type { NavigatorScreenParams } from "@react-navigation/native";
import type { IdentityDocument } from "../../screens/identity/IdentityScreen";
import type { OperationArea } from "../../screens/operations/operation-catalog";

export type ResourceRouteParams = { id?: string };

export type MainTabParamList = {
  Home: undefined;
  Chat: undefined;
  Voice: undefined;
  Identity: ResourceRouteParams | undefined;
  More: undefined;
  Memory: undefined;
  Profile: undefined;
  Skills: ResourceRouteParams | undefined;
  Jobs: ResourceRouteParams | undefined;
  Apps: ResourceRouteParams | undefined;
  Drive: undefined;
  Traces: undefined;
  PiSessions: undefined;
  Settings: undefined;
  Theme: undefined;
  Secrets: undefined;
  System: undefined;
  Server: undefined;
  Providers: ResourceRouteParams | undefined;
};
export type MainRouteName = keyof MainTabParamList;
export type RootStackParamList = {
  Main: NavigatorScreenParams<MainTabParamList> | undefined;
  ChatConversation: { sessionId: string };
  MemoryHome: undefined;
  IdentityHome: undefined;
  IdentityDocument: { document: IdentityDocument };
  Operation: { area: OperationArea; refreshKey?: number };
  MemoryResults: { query: string; mode: "hybrid" | "embedding" | "bm25"; limit: number };
  PiSessionDetail: { id: string; raw?: boolean };
  TraceDetail: { id: string };
  OperationItemDetail: { area: "apps" | "providers"; id: string };
  DriveDirectory: { path: string };
  JobDetail: { name?: string };
  SkillDetail: { name: string; description?: string };
  SkillFiles: { name: string };
  SkillFile: { name: string; fileName: string };
  SecretDetail: { key: string };
  SecretNew: undefined;
  VoiceHistory: undefined;
  VoiceHistoryDetail: { id: string };
};
export type MoreStackParamList = { MoreHome: undefined };
export type IdentityStackParamList = {
  IdentityHome: undefined;
  IdentityDocument: { document: IdentityDocument };
};
