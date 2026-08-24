import { Ionicons } from "@expo/vector-icons";
import type { LinkingOptions } from "@react-navigation/native";
import { operationAreas, type OperationArea } from "../../screens/operations/operation-catalog";
import type { MainRouteName, RootStackParamList } from "./route-types";

export const routeForArea: Record<OperationArea, MainRouteName> = {
  memory: "Memory",
  profile: "Profile",
  skills: "Skills",
  jobs: "Jobs",
  apps: "Apps",
  drive: "Drive",
  traces: "Traces",
  pi: "PiSessions",
  settings: "Settings",
  theme: "Theme",
  secrets: "Secrets",
  system: "System",
  server: "Server",
  providers: "Providers",
};
export const areaForRoute = Object.fromEntries(
  Object.entries(routeForArea)
    .filter(([area]) => area !== "profile" && area !== "system")
    .map(([area, route]) => [route, area]),
) as Partial<Record<MainRouteName, OperationArea>>;
type IconName = React.ComponentProps<typeof Ionicons>["name"];
export const operationMeta: Record<
  OperationArea,
  {
    icon: IconName;
    description: string;
    group: "Intelligence" | "Automation" | "Operations" | "Vito";
  }
> = {
  memory: { icon: "git-branch-outline", description: "Search and recall", group: "Intelligence" },
  profile: {
    icon: "person-outline",
    description: "Stable facts and preferences",
    group: "Intelligence",
  },
  skills: { icon: "construct-outline", description: "Capabilities", group: "Intelligence" },
  jobs: { icon: "time-outline", description: "Schedules and routines", group: "Automation" },
  apps: { icon: "grid-outline", description: "Tools and services", group: "Automation" },
  drive: { icon: "folder-outline", description: "Files and sites", group: "Operations" },
  traces: { icon: "search-outline", description: "Execution history", group: "Operations" },
  pi: { icon: "terminal-outline", description: "Runtime state", group: "Operations" },
  settings: { icon: "settings-outline", description: "Behavior and models", group: "Vito" },
  theme: { icon: "color-palette-outline", description: "Color scheme", group: "Vito" },
  secrets: { icon: "key-outline", description: "Credentials", group: "Vito" },
  system: { icon: "document-text-outline", description: "Soul and instructions", group: "Vito" },
  server: { icon: "server-outline", description: "Service health", group: "Vito" },
  providers: { icon: "cloud-outline", description: "Authentication", group: "Vito" },
};
export const labels: Record<MainRouteName, { label: string; icon: IconName }> = {
  Chat: { label: "Chat", icon: "chatbubble-outline" },
  Voice: { label: "Voice", icon: "mic-outline" },
  Identity: { label: "Identity", icon: "finger-print-outline" },
  More: { label: "More", icon: "ellipsis-horizontal" },
  ...Object.fromEntries(
    operationAreas.map((item) => [
      routeForArea[item.id],
      { label: item.label, icon: operationMeta[item.id].icon },
    ]),
  ),
} as Record<MainRouteName, { label: string; icon: IconName }>;

export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ["rook://", "https://mikes-mac-mini-1.tail1706d3.ts.net"],
  config: {
    screens: {
      Main: {
        screens: {
          Chat: {
            path: "chat",
            screens: {
              ChatList: "",
              ChatConversation: ":sessionId",
            },
          },
          Voice: "voice",
          Identity: "identity",
          More: "more",
          Memory: "memory",
          Profile: "profile",
          Skills: "skills",
          Jobs: "jobs",
          Apps: "apps",
          Drive: "drive",
          Traces: "traces",
          PiSessions: "pi-sessions",
          Settings: "settings",
          Theme: "theme",
          Secrets: "secrets",
          System: "system",
          Server: "server",
          Providers: "providers",
        },
      },
      MemoryHome: "operation/memory",
      IdentityHome: "identity",
      IdentityDocument: "identity/:document",
      Operation: "operation/:area",
      MemoryResults: "memory/results/:query",
      PiSessionDetail: "pi-session",
      JobDetail: "job",
      SkillDetail: "skills/:name",
      SkillFiles: "skills/:name/files",
      SkillFile: "skills/:name/files/:fileName",
      SecretDetail: "secrets/:key",
      SecretNew: "secrets/new",
      VoiceHistory: "voice/history",
      VoiceHistoryDetail: "voice/history/:id",
      TraceDetail: "traces/:id",
      OperationItemDetail: "operation/:area/:id",
      DriveDirectory: "drive/:path",
    },
  },
};
