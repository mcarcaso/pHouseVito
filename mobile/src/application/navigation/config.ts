import { Ionicons } from "@expo/vector-icons";
import { getStateFromPath, type LinkingOptions } from "@react-navigation/native";
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
    group: "Intelligence" | "Automation" | "Operations" | "Agent";
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
  settings: { icon: "settings-outline", description: "Behavior and models", group: "Agent" },
  theme: { icon: "color-palette-outline", description: "Color scheme", group: "Agent" },
  secrets: { icon: "key-outline", description: "Credentials", group: "Agent" },
  system: { icon: "document-text-outline", description: "Soul and instructions", group: "Agent" },
  server: { icon: "server-outline", description: "Service health", group: "Agent" },
  providers: { icon: "cloud-outline", description: "Authentication", group: "Agent" },
};
export const labels: Record<MainRouteName, { label: string; icon: IconName }> = {
  Home: { label: "Home", icon: "home-outline" },
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

function baseTabForDeepLink(routeName: string): "Chat" | "Voice" | "More" {
  if (routeName === "ChatConversation") return "Chat";
  if (routeName === "VoiceHistory" || routeName === "VoiceHistoryDetail") return "Voice";
  return "More";
}

function operationForDeepLink(
  routeName: string,
  params: Record<string, unknown>,
): OperationArea | null {
  if (routeName === "SkillDetail" || routeName === "SkillFiles" || routeName === "SkillFile")
    return "skills";
  if (routeName === "DriveDirectory") return "drive";
  if (routeName === "JobDetail") return "jobs";
  if (routeName === "SecretDetail" || routeName === "SecretNew") return "secrets";
  if (routeName === "TraceDetail") return "traces";
  if (routeName === "PiSessionDetail") return "pi";
  if (routeName === "OperationItemDetail") {
    const area = params.area;
    return area === "apps" || area === "providers" ? area : null;
  }
  return null;
}

export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ["vito://", "https://mikes-mac-mini-1.tail1706d3.ts.net"],
  getStateFromPath: (path, options) => {
    const state = getStateFromPath(path, options);
    if (!state || state.routes[0]?.name === "Main") return state;

    const destination = state.routes[0];
    const routeName = destination?.name ?? "";
    const params = (destination?.params ?? {}) as Record<string, unknown>;
    const tab = baseTabForDeepLink(routeName);
    const prefix: Array<{
      name: string;
      params?: Record<string, unknown>;
      state?: { index: number; routes: Array<{ name: string }> };
    }> = [
      {
        name: "Main",
        state: { index: 0, routes: [{ name: tab }] },
      },
    ];

    const operation = operationForDeepLink(routeName, params);
    if (operation) prefix.push({ name: "Operation", params: { area: operation } });
    if (routeName === "MemoryResults") prefix.push({ name: "MemoryHome" });
    if (routeName === "IdentityDocument") prefix.push({ name: "IdentityHome" });
    if (routeName === "VoiceHistoryDetail") prefix.push({ name: "VoiceHistory" });
    if (routeName === "SkillFiles" || routeName === "SkillFile") {
      prefix.push({ name: "SkillDetail", params: { name: params.name } });
    }
    if (routeName === "SkillFile") {
      prefix.push({ name: "SkillFiles", params: { name: params.name } });
    }

    return {
      ...state,
      index: (state.index ?? state.routes.length - 1) + prefix.length,
      routes: [...prefix, ...state.routes],
    };
  },
  config: {
    screens: {
      Main: {
        screens: {
          Home: "home",
          Chat: "chat",
          Voice: "voice",
          Identity: "identity/:id?",
          More: "more",
        },
      },
      ChatConversation: "chat/:sessionId",
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
      SpeechSettings: "app-settings/speech",
      VoiceModeSettings: "app-settings/voice-mode",
      AppThemeSettings: "app-settings/theme",
      TraceDetail: "traces/:id",
      OperationItemDetail: "operation/:area/:id",
      DriveDirectory: "drive/:path",
    },
  },
};
