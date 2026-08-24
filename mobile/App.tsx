import {
  NavigationContainer,
  createNavigationContainerRef,
  type LinkingOptions,
  type NavigatorScreenParams,
  useNavigation,
} from "@react-navigation/native";
import { createBottomTabNavigator, type BottomTabBarProps } from "@react-navigation/bottom-tabs";
import {
  SafeAreaProvider,
  SafeAreaView as ContextSafeAreaView,
} from "react-native-safe-area-context";
import {
  createNativeStackNavigator,
  type NativeStackNavigationProp,
} from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { ChatScreen, DEFAULT_SESSION } from "./src/ChatScreen";
import {
  IdentityDocumentScreen,
  IdentityHome,
  identityDocumentTitle,
  type IdentityDocument,
} from "./src/IdentityScreen";
import { LoginScreen } from "./src/LoginScreen";
import { operationAreas, OperationsScreen, type OperationArea } from "./src/OperationsScreen";
import { OperationItemDetailScreen } from "./src/OperationItemDetailScreen";
import { SkillsScreen } from "./src/SkillsScreen";
import { SettingsScreen } from "./src/SettingsScreen";
import { ThemeScreen } from "./src/ThemeScreen";
import { JobEditorScreen, JobsScreen } from "./src/JobsScreen";
import {
  DesktopSecretsScreen,
  SecretEditorScreen,
  SecretsScreen,
  type Secret,
} from "./src/SecretsScreen";
import { SkillDocumentScreen, SkillFilesScreen, SkillFileScreen } from "./src/SkillMobileScreens";
import { VoiceScreen, type VoiceOverlayStatus } from "./src/VoiceScreen";
import { VoiceHistoryDetailScreen, VoiceHistoryScreen } from "./src/VoiceHistoryScreen";
import { api, checkAuth, loadAgentUrl, loadToken, logout, saveToken } from "./src/api";
import {
  DESKTOP_BREAKPOINT,
  VitoThemeProvider,
  useThemeStyles,
  useVitoTheme,
  type VitoTheme,
} from "./src/theme";

type ChatStackParamList = {
  ChatList: undefined;
  ChatConversation: { sessionId: string };
};
type MainTabParamList = {
  Chat: NavigatorScreenParams<ChatStackParamList> | undefined;
  Voice: undefined;
  Identity: undefined;
  More: undefined;
  Memory: undefined;
  Profile: undefined;
  Skills: undefined;
  Jobs: undefined;
  Apps: undefined;
  Drive: undefined;
  Traces: undefined;
  PiSessions: undefined;
  Settings: undefined;
  Theme: undefined;
  Secrets: undefined;
  System: undefined;
  Server: undefined;
  Providers: undefined;
};
type MainRouteName = keyof MainTabParamList;
type RootStackParamList = {
  Main: NavigatorScreenParams<MainTabParamList> | undefined;
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
type RootNavigation = NativeStackNavigationProp<RootStackParamList>;
const RootStack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<MainTabParamList>();
const ChatStack = createNativeStackNavigator<ChatStackParamList>();
const MoreStack = createNativeStackNavigator<{ MoreHome: undefined }>();
const IdentityStack = createNativeStackNavigator<{
  IdentityHome: undefined;
  IdentityDocument: { document: IdentityDocument };
}>();
const navigationRef = createNavigationContainerRef<RootStackParamList>();
const idleVoiceStatus: VoiceOverlayStatus = {
  state: "idle",
  muted: false,
  runningTasks: 0,
  completedTasks: 0,
  failedTasks: 0,
};

const routeForArea: Record<OperationArea, MainRouteName> = {
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
const areaForRoute = Object.fromEntries(
  Object.entries(routeForArea)
    .filter(([area]) => area !== "profile" && area !== "system")
    .map(([area, route]) => [route, area]),
) as Partial<Record<MainRouteName, OperationArea>>;
type IconName = React.ComponentProps<typeof Ionicons>["name"];
const operationMeta: Record<
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
const labels: Record<MainRouteName, { label: string; icon: IconName }> = {
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

const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ["vito://", "https://mikes-mac-mini-1.tail1706d3.ts.net"],
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

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <VitoThemeProvider>
          <AppContent />
        </VitoThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function AppContent() {
  const styles = useThemeStyles(createStyles);
  const theme = useVitoTheme();
  const [authState, setAuthState] = useState<"loading" | "authenticated" | "login">("loading");
  const [voiceStatus, setVoiceStatus] = useState<VoiceOverlayStatus>(idleVoiceStatus);
  const [currentRoute, setCurrentRoute] = useState<string>("Chat");
  const updateVoiceStatus = useCallback((status: VoiceOverlayStatus) => {
    setVoiceStatus(status);
  }, []);
  useEffect(() => {
    void (async () => {
      await loadAgentUrl();
      await loadToken();
      try {
        const status = await checkAuth();
        setAuthState(status.authenticated ? "authenticated" : "login");
      } catch {
        setAuthState("login");
      }
    })();
  }, []);
  const unauthorized = useCallback(() => {
    void saveToken(null);
    setAuthState("login");
  }, []);
  if (authState === "loading")
    return (
      <SafeAreaView style={styles.loading}>
        <StatusBar style={theme.dark ? "light" : "dark"} />
        <ActivityIndicator color={theme.colors.accent} />
      </SafeAreaView>
    );
  if (authState === "login")
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style={theme.dark ? "light" : "dark"} />
        <LoginScreen onSuccess={() => setAuthState("authenticated")} />
      </SafeAreaView>
    );
  return (
    <View style={styles.safeArea}>
      <StatusBar style={theme.dark ? "light" : "dark"} />
      <NavigationContainer
        ref={navigationRef}
        linking={linking}
        onReady={() => setCurrentRoute(navigationRef.getCurrentRoute()?.name ?? "Chat")}
        onStateChange={() => setCurrentRoute(navigationRef.getCurrentRoute()?.name ?? "Chat")}
      >
        <RootStack.Navigator
          screenOptions={{
            headerShown: false,
            animation: Platform.OS === "web" ? "none" : "slide_from_right",
            contentStyle: styles.routeBackground,
          }}
        >
          <RootStack.Screen name="Main">
            {() => (
              <MainTabs
                onUnauthorized={unauthorized}
                onLogout={() => void logout().finally(() => setAuthState("login"))}
                onVoiceStatusChange={updateVoiceStatus}
              />
            )}
          </RootStack.Screen>
          <RootStack.Screen
            name="IdentityHome"
            options={{
              headerShown: true,
              title: "Identity",
              headerBackTitle: "More",
              headerStyle: { backgroundColor: theme.colors.canvas },
              headerTintColor: theme.colors.text,
              headerShadowVisible: false,
            }}
          >
            {({ navigation }) => (
              <IdentityHome
                onOpen={(document) => navigation.navigate("IdentityDocument", { document })}
              />
            )}
          </RootStack.Screen>
          <RootStack.Screen
            name="IdentityDocument"
            options={({ route }) => ({
              headerShown: true,
              title: identityDocumentTitle(route.params.document),
              headerBackTitle: "Identity",
              headerStyle: { backgroundColor: theme.colors.canvas },
              headerTintColor: theme.colors.text,
              headerShadowVisible: false,
            })}
          >
            {({ route }) => <IdentityDocumentScreen document={route.params.document} />}
          </RootStack.Screen>
          <RootStack.Screen
            name="MemoryHome"
            component={RootMemoryScreen}
            options={({ navigation }) => ({
              headerShown: true,
              headerTransparent: false,
              title: "",
              headerBackTitle: "More",
              headerStyle: { backgroundColor: theme.colors.canvas },
              headerTintColor: theme.colors.accent,
              headerShadowVisible: false,
              header:
                Platform.OS === "web"
                  ? () => <WebStackHeader onBack={() => navigation.goBack()} />
                  : undefined,
              headerSearchBarOptions: undefined,
            })}
          />
          <RootStack.Screen
            name="Operation"
            component={RootOperationScreen}
            options={({ route, navigation }) => {
              const area = route.params.area;
              const title = operationAreas.find((item) => item.id === area)?.label ?? "";
              return {
                headerShown: true,
                headerTransparent: false,
                title: area === "memory" ? "" : title,
                headerBackTitle: "More",
                headerStyle: { backgroundColor: theme.colors.canvas },
                headerTintColor: theme.colors.accent,
                headerTitleStyle: { color: theme.colors.text },
                headerShadowVisible: false,
                headerRight:
                  area === "secrets"
                    ? () => (
                        <Pressable
                          accessibilityLabel="Add secret"
                          onPress={() => navigation.navigate("SecretNew")}
                          style={{
                            width: 44,
                            height: 44,
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Ionicons name="add" size={25} color={theme.colors.accent} />
                        </Pressable>
                      )
                    : area === "jobs"
                      ? () => (
                          <View style={{ flexDirection: "row", alignItems: "center" }}>
                            <Pressable
                              accessibilityLabel="Refresh jobs"
                              onPress={() => navigation.setParams({ refreshKey: Date.now() })}
                              style={{
                                width: 40,
                                height: 44,
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              <Ionicons name="refresh" size={20} color={theme.colors.accent} />
                            </Pressable>
                            <Pressable
                              accessibilityLabel="New job"
                              onPress={() => navigation.navigate("JobDetail", {})}
                              style={{
                                width: 40,
                                height: 44,
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              <Ionicons name="add" size={25} color={theme.colors.accent} />
                            </Pressable>
                          </View>
                        )
                      : area === "pi"
                        ? () => (
                            <Pressable
                              accessibilityLabel="Refresh Pi sessions"
                              onPress={() => navigation.setParams({ refreshKey: Date.now() })}
                              style={{
                                width: 44,
                                height: 44,
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              <Ionicons name="refresh" size={21} color={theme.colors.accent} />
                            </Pressable>
                          )
                        : (
                              ["apps", "drive", "traces", "providers", "server"] as OperationArea[]
                            ).includes(area)
                          ? () => (
                              <Pressable
                                accessibilityLabel={`Refresh ${title}`}
                                onPress={() => navigation.setParams({ refreshKey: Date.now() })}
                                style={{
                                  width: 44,
                                  height: 44,
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                              >
                                <Ionicons name="refresh" size={20} color={theme.colors.accent} />
                              </Pressable>
                            )
                          : undefined,
                header:
                  Platform.OS === "web"
                    ? () => (
                        <WebStackHeader
                          onBack={() => navigation.goBack()}
                          title={area === "memory" ? undefined : title}
                          onSearch={
                            area === "memory"
                              ? (query) =>
                                  navigation.navigate("MemoryResults", {
                                    query,
                                    mode: "hybrid",
                                    limit: 10,
                                  })
                              : undefined
                          }
                        />
                      )
                    : undefined,
              };
            }}
          />
          <RootStack.Screen
            name="JobDetail"
            component={JobDetailRoute}
            options={({ route }) => ({
              headerShown: true,
              title: route.params.name ? "Job details" : "New job",
              headerBackTitle: "Jobs",
              headerStyle: { backgroundColor: theme.colors.canvas },
              headerTintColor: theme.colors.accent,
              headerShadowVisible: false,
            })}
          />
          <RootStack.Screen
            name="DriveDirectory"
            component={DriveDirectoryScreen}
            options={({ route }) => ({
              headerShown: true,
              title: route.params.path.split("/").pop() || "Drive",
              headerBackTitle: "Drive",
              headerStyle: { backgroundColor: theme.colors.canvas },
              headerTintColor: theme.colors.accent,
              headerTitleStyle: { color: theme.colors.text },
              headerShadowVisible: false,
            })}
          />
          <RootStack.Screen
            name="TraceDetail"
            component={TraceDetailScreen}
            options={({ route, navigation }) => ({
              headerShown: true,
              title: "Trace Details",
              headerBackTitle: "Traces",
              headerStyle: { backgroundColor: theme.colors.canvas },
              headerTintColor: theme.colors.accent,
              headerTitleStyle: { color: theme.colors.text },
              headerShadowVisible: false,
              headerRight: () => (
                <Pressable
                  accessibilityLabel="Delete trace"
                  onPress={() =>
                    Alert.alert("Delete trace?", route.params.id, [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Delete",
                        style: "destructive",
                        onPress: () =>
                          void api(`/api/logs/${encodeURIComponent(route.params.id)}`, {
                            method: "DELETE",
                          }).then(() => navigation.goBack()),
                      },
                    ])
                  }
                  style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
                >
                  <Ionicons name="trash-outline" size={20} color={theme.colors.danger} />
                </Pressable>
              ),
            })}
          />
          <RootStack.Screen
            name="OperationItemDetail"
            component={RootOperationItemDetailScreen}
            options={({ route }) => ({
              headerShown: true,
              title: route.params.id,
              headerBackTitle: route.params.area === "apps" ? "Apps" : "Providers",
              headerStyle: { backgroundColor: theme.colors.canvas },
              headerTintColor: theme.colors.accent,
              headerTitleStyle: { color: theme.colors.text },
              headerShadowVisible: false,
            })}
          />
          <RootStack.Screen
            name="PiSessionDetail"
            component={PiSessionDetailScreen}
            options={({ route, navigation }) => ({
              headerShown: true,
              title: "Pi session",
              headerBackTitle: "Sessions",
              headerStyle: { backgroundColor: theme.colors.canvas },
              headerTintColor: theme.colors.accent,
              headerShadowVisible: false,
              headerRight: () => (
                <Pressable
                  accessibilityLabel={
                    route.params.raw ? "Show formatted session" : "Show raw session"
                  }
                  onPress={() => navigation.setParams({ raw: !route.params.raw })}
                  style={{ paddingHorizontal: 6, paddingVertical: 8 }}
                >
                  <Text
                    style={{
                      color: route.params.raw ? theme.colors.accent : theme.colors.textSecondary,
                      fontSize: 11,
                      fontWeight: "800",
                    }}
                  >
                    RAW
                  </Text>
                </Pressable>
              ),
              header:
                Platform.OS === "web"
                  ? () => (
                      <WebStackHeader
                        onBack={() => navigation.goBack()}
                        title="Pi session"
                        right={
                          <Pressable
                            onPress={() => navigation.setParams({ raw: !route.params.raw })}
                            style={{ paddingHorizontal: 8, paddingVertical: 6 }}
                          >
                            <Text
                              style={{
                                color: route.params.raw
                                  ? theme.colors.accent
                                  : theme.colors.textSecondary,
                                fontSize: 11,
                                fontWeight: "800",
                              }}
                            >
                              RAW
                            </Text>
                          </Pressable>
                        }
                      />
                    )
                  : undefined,
            })}
          />
          <RootStack.Screen
            name="VoiceHistory"
            component={RootVoiceHistoryScreen}
            options={{
              headerShown: true,
              title: "Past Conversations",
              headerBackTitle: "Voice",
              headerStyle: { backgroundColor: theme.colors.canvas },
              headerTintColor: theme.colors.accent,
              headerTitleStyle: { color: theme.colors.text },
              headerShadowVisible: false,
            }}
          />
          <RootStack.Screen
            name="VoiceHistoryDetail"
            component={RootVoiceHistoryDetailScreen}
            options={{
              headerShown: true,
              title: "Voice Conversation",
              headerBackTitle: "Past Conversations",
              headerStyle: { backgroundColor: theme.colors.canvas },
              headerTintColor: theme.colors.accent,
              headerTitleStyle: { color: theme.colors.text },
              headerShadowVisible: false,
            }}
          />
          <RootStack.Screen
            name="SecretDetail"
            component={RootSecretDetailScreen}
            options={({ route }) => ({
              headerShown: true,
              title: route.params.key,
              headerBackTitle: "Secrets",
              headerStyle: { backgroundColor: theme.colors.canvas },
              headerTintColor: theme.colors.accent,
              headerTitleStyle: { color: theme.colors.text },
              headerShadowVisible: false,
            })}
          />
          <RootStack.Screen
            name="SecretNew"
            component={RootSecretNewScreen}
            options={{
              headerShown: true,
              title: "New Secret",
              headerBackTitle: "Secrets",
              headerStyle: { backgroundColor: theme.colors.canvas },
              headerTintColor: theme.colors.accent,
              headerTitleStyle: { color: theme.colors.text },
              headerShadowVisible: false,
            }}
          />
          <RootStack.Screen
            name="SkillDetail"
            component={RootSkillDetailScreen}
            options={({ route, navigation }) => ({
              headerShown: true,
              title: route.params.name,
              headerBackTitle: "Skills",
              headerStyle: { backgroundColor: theme.colors.canvas },
              headerTintColor: theme.colors.accent,
              headerTitleStyle: { color: theme.colors.text },
              headerShadowVisible: false,
              headerRight: () => (
                <Pressable
                  accessibilityLabel="Browse skill files"
                  hitSlop={8}
                  onPress={() => navigation.navigate("SkillFiles", { name: route.params.name })}
                  style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
                >
                  <Ionicons
                    name="folder-open-outline"
                    size={22}
                    color={theme.colors.accent}
                    style={{ transform: [{ translateY: -3 }] }}
                  />
                </Pressable>
              ),
            })}
          />
          <RootStack.Screen
            name="SkillFiles"
            component={RootSkillFilesScreen}
            options={({ route }) => ({
              headerShown: true,
              title: `${route.params.name} files`,
              headerBackTitle: route.params.name,
              headerStyle: { backgroundColor: theme.colors.canvas },
              headerTintColor: theme.colors.accent,
              headerTitleStyle: { color: theme.colors.text },
              headerShadowVisible: false,
            })}
          />
          <RootStack.Screen
            name="SkillFile"
            component={RootSkillFileScreen}
            options={({ route }) => ({
              headerShown: true,
              title: route.params.fileName,
              headerBackTitle: "Files",
              headerStyle: { backgroundColor: theme.colors.canvas },
              headerTintColor: theme.colors.accent,
              headerTitleStyle: { color: theme.colors.text },
              headerShadowVisible: false,
            })}
          />
          <RootStack.Screen
            name="MemoryResults"
            component={MemoryResultsScreen}
            options={({ navigation }) => ({
              headerShown: true,
              headerTransparent: false,
              title: "",
              headerBackTitle: "Memory",
              headerStyle: { backgroundColor: theme.colors.canvas },
              headerTintColor: theme.colors.accent,
              headerShadowVisible: false,
              header:
                Platform.OS === "web"
                  ? () => <WebStackHeader onBack={() => navigation.goBack()} />
                  : undefined,
            })}
          />
        </RootStack.Navigator>
      </NavigationContainer>
      {voiceStatus.state !== "idle" &&
        voiceStatus.state !== "error" &&
        currentRoute !== "Voice" && (
          <GlobalVoiceOverlay
            status={voiceStatus}
            onPress={() =>
              navigationRef.isReady() && navigationRef.navigate("Main", { screen: "Voice" })
            }
          />
        )}
    </View>
  );
}

function ChatNavigator({
  desktop,
  onUnauthorized,
}: {
  desktop: boolean;
  onUnauthorized: () => void;
}) {
  const styles = useThemeStyles(createStyles);
  return (
    <ChatStack.Navigator
      initialRouteName="ChatList"
      screenOptions={{
        headerShown: false,
        contentStyle: styles.routeBackground,
      }}
    >
      <ChatStack.Screen name="ChatList">
        {({ navigation }) => (
          <ChatScreen
            onUnauthorized={onUnauthorized}
            selectedSessionId={desktop ? DEFAULT_SESSION : null}
            onSelectSession={(session) =>
              navigation.navigate("ChatConversation", { sessionId: session.id })
            }
          />
        )}
      </ChatStack.Screen>
      <ChatStack.Screen name="ChatConversation">
        {({ navigation, route }) => (
          <ChatScreen
            onUnauthorized={onUnauthorized}
            selectedSessionId={route.params.sessionId}
            onSelectSession={(session) =>
              navigation.navigate("ChatConversation", { sessionId: session.id })
            }
            onBack={() => navigation.goBack()}
          />
        )}
      </ChatStack.Screen>
    </ChatStack.Navigator>
  );
}

function MainTabs({
  onUnauthorized,
  onLogout,
  onVoiceStatusChange,
}: {
  onUnauthorized: () => void;
  onLogout: () => void;
  onVoiceStatusChange: (status: VoiceOverlayStatus) => void;
}) {
  const styles = useThemeStyles(createStyles);
  const theme = useVitoTheme();
  const rootNavigation = useNavigation<RootNavigation>();
  const { width } = useWindowDimensions();
  const desktop = width >= DESKTOP_BREAKPOINT;
  const [agentName, setAgentName] = useState("Vito");
  useEffect(() => {
    void api<{ bot?: { name?: string } }>("/api/config").then((config) =>
      setAgentName(config.bot?.name?.trim() || "Vito"),
    );
  }, []);
  return (
    <Tabs.Navigator
      initialRouteName="Chat"
      tabBar={(props) => <AdaptiveTabBar {...props} desktop={desktop} onLogout={onLogout} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: styles.routeBackground,
        tabBarPosition: desktop ? "left" : "bottom",
        animation: "none",
        lazy: false,
      }}
    >
      <Tabs.Screen name="Chat">
        {() => (
          <TabSafeArea desktop={desktop}>
            <ChatNavigator desktop={desktop} onUnauthorized={onUnauthorized} />
          </TabSafeArea>
        )}
      </Tabs.Screen>
      <Tabs.Screen
        name="Voice"
        options={{
          headerShown: !desktop,
          title: `Talk to ${agentName}`,
          headerStyle: { backgroundColor: theme.colors.canvas },
          headerTintColor: theme.colors.text,
          headerTitleStyle: { fontSize: 16, fontWeight: "700" },
          headerShadowVisible: false,
        }}
      >
        {() => (
          <View style={styles.operationRoute}>
            {desktop && (
              <View style={styles.operationToolbar}>
                <Text style={styles.operationToolbarTitle}>Talk to {agentName}</Text>
              </View>
            )}
            <View style={[styles.voiceScreen, desktop && styles.voiceScreenDesktop]}>
              <VoiceScreen
                onUnauthorized={onUnauthorized}
                onStatusChange={onVoiceStatusChange}
                onPastConversations={() => rootNavigation.navigate("VoiceHistory")}
              />
            </View>
          </View>
        )}
      </Tabs.Screen>
      <Tabs.Screen name="Identity">{() => <IdentityNavigator desktop={desktop} />}</Tabs.Screen>
      <Tabs.Screen name="More">
        {() => <MoreStackScreen desktop={desktop} onLogout={onLogout} />}
      </Tabs.Screen>
      {(Object.entries(areaForRoute) as Array<[MainRouteName, OperationArea]>).map(
        ([route, area]) => (
          <Tabs.Screen key={route} name={route}>
            {() => <OperationRoute area={area} desktop={desktop} onUnauthorized={onUnauthorized} />}
          </Tabs.Screen>
        ),
      )}
    </Tabs.Navigator>
  );
}

function WebStackHeader({
  onBack,
  onSearch,
  title,
  right,
}: {
  onBack: () => void;
  onSearch?: (query: string) => void;
  title?: string;
  right?: React.ReactNode;
}) {
  const styles = useThemeStyles(createStyles);
  const theme = useVitoTheme();
  const [query, setQuery] = useState("");
  return (
    <View style={styles.webStackHeader}>
      <Pressable accessibilityLabel="Back" onPress={onBack} style={styles.webBackButton}>
        <Ionicons name="chevron-back" size={24} color={theme.colors.accent} />
      </Pressable>
      {title && <Text style={styles.webHeaderTitle}>{title}</Text>}
      {onSearch && (
        <View style={styles.webHeaderSearch}>
          <Ionicons name="search-outline" size={17} color={theme.colors.accent} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => {
              const value = query.trim();
              if (value) onSearch(value);
            }}
            placeholder="Search memory"
            placeholderTextColor={theme.colors.textMuted}
            returnKeyType="search"
            style={styles.webHeaderSearchInput}
          />
        </View>
      )}
      {right}
    </View>
  );
}

function RootMemoryScreen({ navigation }: { navigation: RootNavigation }) {
  const styles = useThemeStyles(createStyles);
  return (
    <ScrollView
      automaticallyAdjustContentInsets
      contentInsetAdjustmentBehavior={Platform.OS === "ios" ? "automatic" : "never"}
      automaticallyAdjustKeyboardInsets
      automaticallyAdjustsScrollIndicatorInsets
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.fullScreenOperation}
    >
      <OperationsScreen
        initialArea="memory"
        showAreaTabs={false}
        hideMemorySearch
        onUnauthorized={() => navigation.navigate("Main", { screen: "More" })}
        onMemorySearch={(query, mode, limit) =>
          navigation.navigate("MemoryResults", { query, mode, limit })
        }
      />
    </ScrollView>
  );
}

function JobDetailRoute({
  route,
  navigation,
}: {
  route: { params: { name?: string } };
  navigation: RootNavigation;
}) {
  return <JobEditorScreen name={route.params.name} onDone={() => navigation.goBack()} />;
}

function DriveDirectoryScreen({
  route,
  navigation,
}: {
  route: { params: { path: string } };
  navigation: RootNavigation;
}) {
  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 16 }}>
      <OperationsScreen
        initialArea="drive"
        initialDrivePath={route.params.path}
        showAreaTabs={false}
        hideScreenTitle
        hideRefreshToolbar
        onOpenDriveDirectory={(path) => navigation.push("DriveDirectory", { path })}
        onUnauthorized={() => navigation.navigate("Main", { screen: "More" })}
      />
    </ScrollView>
  );
}

function TraceDetailScreen({
  route,
  navigation,
}: {
  route: { params: { id: string } };
  navigation: RootNavigation;
}) {
  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 16 }}>
      <OperationsScreen
        initialArea="traces"
        initialDetail={{ area: "traces", id: route.params.id }}
        showAreaTabs={false}
        hideScreenTitle
        onUnauthorized={() => navigation.navigate("Main", { screen: "More" })}
      />
    </ScrollView>
  );
}

function RootOperationItemDetailScreen({
  route,
}: {
  route: { params: { area: "apps" | "providers"; id: string } };
}) {
  return <OperationItemDetailScreen area={route.params.area} id={route.params.id} />;
}

function PiSessionDetailScreen({
  route,
  navigation,
}: {
  route: { params: { id: string; raw?: boolean } };
  navigation: RootNavigation;
}) {
  const styles = useThemeStyles(createStyles);
  return (
    <ScrollView contentContainerStyle={styles.fullScreenOperation}>
      <OperationsScreen
        initialArea="pi"
        initialDetail={{ area: "pi", id: route.params.id }}
        initialShowRaw={route.params.raw === true}
        showAreaTabs={false}
        hideScreenTitle
        onUnauthorized={() => navigation.navigate("Main", { screen: "More" })}
      />
    </ScrollView>
  );
}

function RootOperationScreen({
  route,
  navigation,
}: {
  route: { params: { area: OperationArea; refreshKey?: number } };
  navigation: RootNavigation;
}) {
  const styles = useThemeStyles(createStyles);
  const theme = useVitoTheme();
  const area = route.params.area;
  const [query, setQuery] = useState("");
  const openResults = (
    value: string,
    mode: "hybrid" | "embedding" | "bm25" = "hybrid",
    limit = 10,
  ) => {
    const search = value.trim();
    if (search) navigation.navigate("MemoryResults", { query: search, mode, limit });
  };
  if (area === "secrets") {
    return (
      <SecretsScreen
        onUnauthorized={() => navigation.navigate("Main", { screen: "More" })}
        onOpen={(secret) => navigation.navigate("SecretDetail", { key: secret.key })}
      />
    );
  }
  if (area === "settings") {
    return (
      <SettingsScreen
        showHeader={false}
        onUnauthorized={() => navigation.navigate("Main", { screen: "More" })}
      />
    );
  }
  if (area === "theme") return <ThemeScreen />;
  if (area === "jobs")
    return (
      <JobsScreen
        refreshKey={route.params.refreshKey}
        onOpen={(name) => navigation.navigate("JobDetail", { name })}
      />
    );
  if (area === "skills") {
    return (
      <SkillsScreen
        onUnauthorized={() => navigation.navigate("Main", { screen: "More" })}
        onOpenSkill={(skill) =>
          navigation.navigate("SkillDetail", {
            name: skill.name,
            description: skill.description,
          })
        }
      />
    );
  }
  return (
    <View style={styles.rootOperation}>
      {area === "memory" && Platform.OS !== "web" && (
        <View style={styles.nativeMemorySearch}>
          <Ionicons name="search-outline" size={17} color={theme.colors.accent} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => openResults(query)}
            placeholder="Search memory"
            placeholderTextColor={theme.colors.textMuted}
            returnKeyType="search"
            style={styles.nativeMemorySearchInput}
          />
        </View>
      )}
      <ScrollView
        automaticallyAdjustContentInsets
        contentInsetAdjustmentBehavior={Platform.OS === "ios" ? "automatic" : "never"}
        automaticallyAdjustsScrollIndicatorInsets
        contentContainerStyle={styles.fullScreenOperation}
      >
        <OperationsScreen
          key={`${area}:${route.params.refreshKey ?? 0}`}
          initialArea={area}
          showAreaTabs={false}
          hideScreenTitle
          hideRefreshToolbar
          onUnauthorized={() => navigation.navigate("Main", { screen: "More" })}
          onOpenStructuredDetail={
            area === "pi"
              ? (_detailArea, id) => navigation.navigate("PiSessionDetail", { id })
              : area === "traces"
                ? (_detailArea, id) => navigation.navigate("TraceDetail", { id })
                : undefined
          }
          onOpenItem={
            area === "apps" || area === "providers"
              ? (detailArea, id) =>
                  navigation.navigate("OperationItemDetail", { area: detailArea, id })
              : undefined
          }
          onOpenDriveDirectory={
            area === "drive" ? (path) => navigation.navigate("DriveDirectory", { path }) : undefined
          }
          hideMemorySearch={area === "memory"}
          onMemorySearch={area === "memory" ? openResults : undefined}
        />
      </ScrollView>
    </View>
  );
}

function IdentityNavigator({ desktop }: { desktop: boolean }) {
  const theme = useVitoTheme();
  const root = useNavigation<RootNavigation>();
  return (
    <IdentityStack.Navigator
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: theme.colors.canvas },
        headerTintColor: theme.colors.text,
        headerTitleStyle: { fontSize: 16, fontWeight: "700" },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: theme.colors.canvas },
      }}
    >
      <IdentityStack.Screen
        name="IdentityHome"
        options={{
          title: "Identity",
          headerShown: !desktop,
          headerLeft: desktop
            ? undefined
            : () => (
                <Pressable
                  accessibilityLabel="Back to More"
                  onPress={() => root.navigate("Main", { screen: "More" })}
                >
                  <Ionicons name="chevron-back" size={25} color={theme.colors.accent} />
                </Pressable>
              ),
        }}
      >
        {({ navigation }) => (
          <IdentityHome
            onOpen={(document) => navigation.navigate("IdentityDocument", { document })}
          />
        )}
      </IdentityStack.Screen>
      <IdentityStack.Screen
        name="IdentityDocument"
        options={({ route }) => ({ title: identityDocumentTitle(route.params.document) })}
      >
        {({ route }) => <IdentityDocumentScreen document={route.params.document} />}
      </IdentityStack.Screen>
    </IdentityStack.Navigator>
  );
}

function MoreStackScreen({ desktop, onLogout }: { desktop: boolean; onLogout: () => void }) {
  const theme = useVitoTheme();
  return (
    <MoreStack.Navigator
      screenOptions={{
        headerShown: !desktop,
        headerStyle: { backgroundColor: theme.colors.canvas },
        headerTintColor: theme.colors.text,
        headerTitleStyle: { fontSize: 16, fontWeight: "700" },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: theme.colors.canvas },
      }}
    >
      <MoreStack.Screen name="MoreHome" options={{ title: "More" }}>
        {() => <MoreMenu onLogout={onLogout} />}
      </MoreStack.Screen>
    </MoreStack.Navigator>
  );
}

function MemoryResultsScreen({
  route,
  navigation,
}: {
  route: { params: { query: string; mode: "hybrid" | "embedding" | "bm25"; limit: number } };
  navigation: RootNavigation;
}) {
  const styles = useThemeStyles(createStyles);
  return (
    <ScrollView
      automaticallyAdjustContentInsets
      contentInsetAdjustmentBehavior={Platform.OS === "ios" ? "automatic" : "never"}
      automaticallyAdjustsScrollIndicatorInsets
      contentContainerStyle={styles.fullScreenOperation}
    >
      <OperationsScreen
        initialArea="memory"
        initialMemoryQuery={route.params.query}
        initialMemoryMode={route.params.mode}
        initialMemoryLimit={route.params.limit}
        showAreaTabs={false}
        onUnauthorized={() => navigation.navigate("Main", { screen: "More" })}
      />
    </ScrollView>
  );
}

function RootVoiceHistoryScreen({ navigation }: { navigation: RootNavigation }) {
  return <VoiceHistoryScreen onOpen={(id) => navigation.navigate("VoiceHistoryDetail", { id })} />;
}

function RootVoiceHistoryDetailScreen({ route }: { route: { params: { id: string } } }) {
  return <VoiceHistoryDetailScreen id={route.params.id} />;
}

function RootSecretDetailScreen({
  route,
  navigation,
}: {
  route: { params: { key: string } };
  navigation: RootNavigation;
}) {
  const [secret, setSecret] = useState<Secret | null>(null);
  useEffect(() => {
    void api<Secret[]>("/api/secrets").then((items) =>
      setSecret(items.find((item) => item.key === route.params.key) ?? null),
    );
  }, [route.params.key]);
  if (!secret) return <ActivityIndicator style={{ flex: 1 }} />;
  return (
    <SecretEditorScreen
      secret={secret}
      onSaved={() => navigation.goBack()}
      onDeleted={() => navigation.goBack()}
    />
  );
}

function RootSecretNewScreen({ navigation }: { navigation: RootNavigation }) {
  return <SecretEditorScreen onSaved={() => navigation.goBack()} />;
}

function RootSkillDetailScreen({
  route,
}: {
  route: { params: { name: string; description?: string } };
}) {
  return <SkillDocumentScreen name={route.params.name} description={route.params.description} />;
}

function RootSkillFilesScreen({
  route,
  navigation,
}: {
  route: { params: { name: string } };
  navigation: RootNavigation;
}) {
  return (
    <SkillFilesScreen
      name={route.params.name}
      onOpen={(fileName) => navigation.navigate("SkillFile", { name: route.params.name, fileName })}
    />
  );
}

function RootSkillFileScreen({ route }: { route: { params: { name: string; fileName: string } } }) {
  return <SkillFileScreen name={route.params.name} fileName={route.params.fileName} />;
}

function TabSafeArea({ desktop, children }: { desktop: boolean; children: React.ReactNode }) {
  const styles = useThemeStyles(createStyles);
  return (
    <ContextSafeAreaView edges={desktop ? [] : ["top"]} style={styles.tabSafeArea}>
      {children}
    </ContextSafeAreaView>
  );
}

function ScreenFrame({ desktop, children }: { desktop: boolean; children: React.ReactNode }) {
  const styles = useThemeStyles(createStyles);
  return (
    <ScrollView contentContainerStyle={[styles.screenFrame, desktop && styles.screenFrameDesktop]}>
      <View style={styles.screenPage}>{children}</View>
    </ScrollView>
  );
}
function OperationRoute({
  area,
  desktop,
  onUnauthorized,
}: {
  area: OperationArea;
  desktop: boolean;
  onUnauthorized: () => void;
}) {
  const styles = useThemeStyles(createStyles);
  const theme = useVitoTheme();
  const root = useNavigation<RootNavigation>();
  const [desktopMemorySearch, setDesktopMemorySearch] = useState<{
    query: string;
    mode: "hybrid" | "embedding" | "bm25";
    limit: number;
  } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [desktopStructuredDetail, setDesktopStructuredDetail] = useState<{
    area: "traces" | "pi";
    id: string;
  } | null>(null);
  const [desktopJob, setDesktopJob] = useState<string | "new" | null>(null);
  const [desktopItemDetail, setDesktopItemDetail] = useState<{
    area: "apps" | "providers";
    id: string;
  } | null>(null);
  if (area === "secrets") {
    return <DesktopSecretsScreen onUnauthorized={onUnauthorized} />;
  }
  if (area === "settings") {
    return (
      <View style={styles.operationRoute}>
        <View style={styles.operationToolbar}>
          <Text style={styles.operationToolbarTitle}>Settings</Text>
        </View>
        <SettingsScreen showHeader={false} onUnauthorized={onUnauthorized} />
      </View>
    );
  }
  if (area === "theme") {
    return (
      <View style={styles.operationRoute}>
        <View style={styles.operationToolbar}>
          <Text style={styles.operationToolbarTitle}>Theme</Text>
        </View>
        <ThemeScreen />
      </View>
    );
  }
  if (area === "jobs") {
    return (
      <View style={styles.operationRoute}>
        <View style={styles.operationToolbar}>
          {desktopJob && (
            <Pressable
              accessibilityLabel="Back to jobs"
              onPress={() => setDesktopJob(null)}
              style={styles.operationToolbarButton}
            >
              <Ionicons name="chevron-back" size={21} color={theme.colors.accent} />
            </Pressable>
          )}
          <Text style={styles.operationToolbarTitle}>
            {desktopJob === "new" ? "New job" : desktopJob ? "Job details" : "Jobs"}
          </Text>
          {!desktopJob && (
            <>
              <Pressable
                accessibilityLabel="Refresh jobs"
                onPress={() => setRefreshKey((value) => value + 1)}
                style={styles.operationToolbarButton}
              >
                <Ionicons name="refresh" size={19} color={theme.colors.textSecondary} />
              </Pressable>
              <Pressable
                accessibilityLabel="New job"
                onPress={() => setDesktopJob("new")}
                style={styles.operationToolbarButton}
              >
                <Ionicons name="add" size={23} color={theme.colors.accent} />
              </Pressable>
            </>
          )}
        </View>
        {desktopJob ? (
          <JobEditorScreen
            name={desktopJob === "new" ? undefined : desktopJob}
            onDone={() => {
              setDesktopJob(null);
              setRefreshKey((value) => value + 1);
            }}
          />
        ) : (
          <JobsScreen refreshKey={refreshKey} onOpen={(name) => setDesktopJob(name)} />
        )}
      </View>
    );
  }
  if (area === "skills") {
    return (
      <View style={styles.operationRoute}>
        <View style={styles.operationToolbar}>
          <Text style={styles.operationToolbarTitle}>Skills</Text>
        </View>
        <SkillsScreen onUnauthorized={onUnauthorized} />
      </View>
    );
  }
  const genericToolbarAreas: OperationArea[] = ["apps", "drive", "providers", "server"];
  return (
    <View style={styles.operationRoute}>
      {genericToolbarAreas.includes(area) && (
        <View style={styles.operationToolbar}>
          {desktopItemDetail && (
            <Pressable
              accessibilityLabel={`Back to ${area}`}
              onPress={() => setDesktopItemDetail(null)}
              style={styles.operationToolbarButton}
            >
              <Ionicons name="chevron-back" size={21} color={theme.colors.accent} />
            </Pressable>
          )}
          <Text style={styles.operationToolbarTitle}>
            {desktopItemDetail
              ? desktopItemDetail.id
              : (operationAreas.find((item) => item.id === area)?.label ?? area)}
          </Text>
          {!desktopItemDetail && (
            <Pressable
              accessibilityLabel={`Refresh ${area}`}
              onPress={() => setRefreshKey((value) => value + 1)}
              style={styles.operationToolbarButton}
            >
              <Ionicons name="refresh" size={19} color={theme.colors.textSecondary} />
            </Pressable>
          )}
        </View>
      )}
      {(area === "pi" || area === "traces") && (
        <View style={styles.operationToolbar}>
          {desktopStructuredDetail && (
            <Pressable
              accessibilityLabel={`Back to ${area}`}
              onPress={() => setDesktopStructuredDetail(null)}
              style={styles.operationToolbarButton}
            >
              <Ionicons name="chevron-back" size={21} color={theme.colors.accent} />
            </Pressable>
          )}
          <Text style={styles.operationToolbarTitle}>
            {desktopStructuredDetail
              ? area === "traces"
                ? "Trace details"
                : "Pi session"
              : area === "traces"
                ? "Traces"
                : "Pi sessions"}
          </Text>
          {desktopStructuredDetail?.area === "traces" ? (
            <Pressable
              accessibilityLabel="Delete trace"
              onPress={() =>
                Alert.alert("Delete trace?", desktopStructuredDetail.id, [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Delete",
                    style: "destructive",
                    onPress: () =>
                      void api(`/api/logs/${encodeURIComponent(desktopStructuredDetail.id)}`, {
                        method: "DELETE",
                      }).then(() => {
                        setDesktopStructuredDetail(null);
                        setRefreshKey((value) => value + 1);
                      }),
                  },
                ])
              }
              style={styles.operationToolbarButton}
            >
              <Ionicons name="trash-outline" size={19} color={theme.colors.danger} />
            </Pressable>
          ) : !desktopStructuredDetail ? (
            <Pressable
              accessibilityLabel={`Refresh ${area}`}
              onPress={() => setRefreshKey((value) => value + 1)}
              style={styles.operationToolbarButton}
            >
              <Ionicons name="refresh" size={19} color={theme.colors.textSecondary} />
            </Pressable>
          ) : null}
        </View>
      )}
      {desktopItemDetail ? (
        <OperationItemDetailScreen area={desktopItemDetail.area} id={desktopItemDetail.id} />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.operationFrame, desktop && styles.operationFrameDesktop]}
        >
          <OperationsScreen
            key={
              area === "memory" && desktopMemorySearch
                ? `${area}:${desktopMemorySearch.query}:${desktopMemorySearch.mode}:${desktopMemorySearch.limit}`
                : `${area}:${refreshKey}:${desktopStructuredDetail?.id ?? "list"}`
            }
            initialArea={area}
            initialDetail={desktopStructuredDetail ?? undefined}
            initialMemoryQuery={desktop ? desktopMemorySearch?.query : undefined}
            initialMemoryMode={desktopMemorySearch?.mode}
            initialMemoryLimit={desktopMemorySearch?.limit}
            showAreaTabs={false}
            hideScreenTitle
            hideRefreshToolbar={
              area === "pi" || area === "traces" || genericToolbarAreas.includes(area)
            }
            onUnauthorized={onUnauthorized}
            onOpenItem={
              area === "apps" || area === "providers"
                ? (detailArea, id) => setDesktopItemDetail({ area: detailArea, id })
                : undefined
            }
            onOpenStructuredDetail={
              area === "pi" || area === "traces"
                ? (detailArea, id) => setDesktopStructuredDetail({ area: detailArea, id })
                : undefined
            }
            onMemorySearch={
              area === "memory"
                ? (query, mode, limit) => {
                    if (desktop) setDesktopMemorySearch({ query, mode, limit });
                    else root.navigate("MemoryResults", { query, mode, limit });
                  }
                : undefined
            }
          />
        </ScrollView>
      )}
    </View>
  );
}

function AdaptiveTabBar({
  state,
  navigation,
  desktop,
  onLogout,
}: BottomTabBarProps & { desktop: boolean; onLogout: () => void }) {
  const styles = useThemeStyles(createStyles);
  const current = state.routeNames[state.index] as MainRouteName;
  const visible = desktop
    ? (state.routeNames as MainRouteName[])
    : (["Chat", "Voice", "More"] as MainRouteName[]);
  const moreActive = current === "More" || current in areaForRoute;
  if (desktop)
    return (
      <View style={styles.sidebar}>
        <View style={styles.brand}>
          <Text style={styles.brandName}>Vito</Text>
          <Text style={styles.brandDot}>.</Text>
        </View>
        <ScrollView contentContainerStyle={styles.desktopNavList}>
          {(["Chat", "Voice", "Identity"] as MainRouteName[]).map((route) => (
            <DesktopNavItem key={route} route={route} current={current} navigation={navigation} />
          ))}
          {(["Intelligence", "Automation", "Operations", "Vito"] as const).map((group) => (
            <View key={group}>
              <Text style={styles.navSection}>{group}</Text>
              {visible
                .filter(
                  (route) =>
                    route !== "More" &&
                    route !== "Chat" &&
                    route !== "Voice" &&
                    route !== "Identity" &&
                    operationMeta[areaForRoute[route]!]?.group === group,
                )
                .map((route) => (
                  <DesktopNavItem
                    key={route}
                    route={route}
                    current={current}
                    navigation={navigation}
                  />
                ))}
            </View>
          ))}
        </ScrollView>
        <Pressable onPress={onLogout} style={styles.signOut}>
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </View>
    );
  return (
    <View style={styles.tabBar}>
      <View style={styles.tabList}>
        {visible.map((route) => {
          const item = labels[route];
          const active = route === "More" ? moreActive : current === route;
          return (
            <Pressable
              key={route}
              onPress={() => navigation.navigate(route)}
              style={[styles.tabItem, active && styles.tabItemActive]}
            >
              <Ionicons
                name={item.icon}
                size={20}
                style={[styles.tabIcon, active && styles.activeText]}
              />
              <Text style={[styles.tabLabel, active && styles.activeText]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function DesktopNavItem({
  route,
  current,
  navigation,
}: {
  route: MainRouteName;
  current: MainRouteName;
  navigation: BottomTabBarProps["navigation"];
}) {
  const styles = useThemeStyles(createStyles);
  const item = labels[route];
  const active = current === route;
  return (
    <Pressable onPress={() => navigation.navigate(route)} style={styles.navItem}>
      <Ionicons name={item.icon} size={16} style={[styles.navIcon, active && styles.activeText]} />
      <Text style={[styles.navLabel, active && styles.navLabelActive]}>{item.label}</Text>
      {active && <View style={styles.navActiveDot} />}
    </Pressable>
  );
}

function GlobalVoiceOverlay({
  status,
  onPress,
}: {
  status: VoiceOverlayStatus;
  onPress: () => void;
}) {
  const styles = useThemeStyles(createStyles);
  const theme = useVitoTheme();
  const { width } = useWindowDimensions();
  const desktop = width >= DESKTOP_BREAKPOINT;
  const taskLabel =
    status.completedTasks > 0
      ? `${status.completedTasks} task${status.completedTasks === 1 ? "" : "s"} ready`
      : status.failedTasks > 0
        ? `${status.failedTasks} task${status.failedTasks === 1 ? "" : "s"} failed`
        : status.runningTasks > 0
          ? `${status.runningTasks} task${status.runningTasks === 1 ? "" : "s"} working`
          : null;
  const voiceLabel =
    status.state === "connecting"
      ? "Connecting"
      : status.muted
        ? "Voice muted"
        : status.state === "speaking"
          ? "Vito is speaking"
          : "Vito is listening";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${voiceLabel}${taskLabel ? `, ${taskLabel}` : ""}. Open voice.`}
      onPress={onPress}
      style={[styles.voiceOverlay, desktop && styles.voiceOverlayDesktop]}
    >
      <View style={[styles.voicePulse, status.state === "speaking" && styles.voicePulseSpeaking]}>
        <Ionicons
          name={status.muted ? "mic-off" : status.state === "speaking" ? "volume-high" : "mic"}
          size={16}
          color={theme.colors.accentText}
        />
      </View>
      <View style={styles.voiceOverlayCopy}>
        <Text style={styles.voiceOverlayTitle}>{voiceLabel}</Text>
        <Text style={styles.voiceOverlayDetail}>
          {taskLabel ?? "Tap for transcript and controls"}
        </Text>
      </View>
      {status.completedTasks > 0 && <View style={styles.voiceReadyDot} />}
      <Ionicons name="chevron-up" size={17} color={theme.colors.textMuted} />
    </Pressable>
  );
}

function MoreMenu({ onLogout }: { onLogout: () => void }) {
  const styles = useThemeStyles(createStyles);
  const navigation = useNavigation<RootNavigation>();
  return (
    <ScrollView contentContainerStyle={styles.moreScreen}>
      {(["Intelligence", "Automation", "Operations", "Vito"] as const).map((group) => (
        <View key={group} style={styles.moreSection}>
          <Text style={styles.moreSectionLabel}>{group}</Text>
          {group === "Vito" && (
            <Pressable onPress={() => navigation.navigate("IdentityHome")} style={styles.moreRow}>
              <Ionicons name="finger-print-outline" size={18} style={styles.moreIcon} />
              <View style={styles.moreRowText}>
                <Text style={styles.moreTitle}>Identity</Text>
                <Text style={styles.moreDescription}>Profile, soul, and instructions</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} style={styles.moreChevron} />
            </Pressable>
          )}
          {operationAreas
            .filter(
              (item) =>
                item.id !== "profile" &&
                item.id !== "system" &&
                operationMeta[item.id].group === group,
            )
            .map((item) => {
              const meta = operationMeta[item.id];
              return (
                <Pressable
                  key={item.id}
                  onPress={() =>
                    item.id === "memory"
                      ? navigation.navigate("MemoryHome")
                      : navigation.navigate("Operation", { area: item.id })
                  }
                  style={styles.moreRow}
                >
                  <Ionicons name={meta.icon} size={18} style={styles.moreIcon} />
                  <View style={styles.moreRowText}>
                    <Text style={styles.moreTitle}>{item.label}</Text>
                    <Text style={styles.moreDescription}>{meta.description}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} style={styles.moreChevron} />
                </Pressable>
              );
            })}
        </View>
      ))}
      <Pressable onPress={onLogout} style={styles.mobileSignOut}>
        <Ionicons name="log-out-outline" size={18} color={styles.mobileSignOutText.color} />
        <Text style={styles.mobileSignOutText}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

const createStyles = (theme: VitoTheme) =>
  StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: theme.colors.canvas },
    voiceScreen: { flex: 1, paddingHorizontal: theme.space.xl, paddingBottom: theme.space.md },
    voiceScreenDesktop: {
      padding: theme.space.xxxl,
      maxWidth: 860,
      width: "100%",
      alignSelf: "center",
    },
    voiceOverlay: {
      position: "absolute",
      left: theme.space.md,
      right: theme.space.md,
      bottom: 78,
      minHeight: 62,
      paddingHorizontal: theme.space.md,
      paddingVertical: theme.space.sm,
      borderRadius: 17,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.md,
      backgroundColor: theme.colors.surfaceRaised,
      borderWidth: 1,
      borderColor: theme.colors.separatorStrong,
      shadowColor: "#000",
      shadowOpacity: 0.22,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
      elevation: 12,
      zIndex: 100,
    },
    voiceOverlayDesktop: {
      left: undefined,
      right: theme.space.xl,
      bottom: theme.space.xl,
      width: 310,
    },
    voicePulse: {
      width: 38,
      height: 38,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.accent,
    },
    voicePulseSpeaking: { transform: [{ scale: 1.05 }] },
    voiceOverlayCopy: { flex: 1, minWidth: 0 },
    voiceOverlayTitle: { color: theme.colors.text, fontSize: 13, fontWeight: "800" },
    voiceOverlayDetail: {
      color: theme.colors.textMuted,
      fontSize: 11,
      marginTop: theme.space.xs,
    },
    voiceReadyDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: theme.colors.accent,
    },
    loading: {
      flex: 1,
      backgroundColor: theme.colors.canvas,
      alignItems: "center",
      justifyContent: "center",
    },
    routeBackground: { backgroundColor: theme.colors.canvas },
    sidebar: {
      width: 224,
      paddingHorizontal: theme.space.lg,
      paddingTop: theme.space.xl,
      paddingBottom: theme.space.lg,
      backgroundColor: theme.colors.sidebar,
      borderRightWidth: 1,
      borderRightColor: theme.colors.separator,
    },
    brand: {
      flexDirection: "row",
      paddingHorizontal: theme.space.md,
      marginBottom: theme.space.xxl,
    },
    brandName: { color: theme.colors.text, fontSize: 19, fontWeight: "800" },
    brandDot: { color: theme.colors.accent, fontSize: 19, fontWeight: "800" },
    desktopNavList: { paddingBottom: theme.space.md },
    navSection: {
      color: theme.colors.textMuted,
      fontSize: 9,
      fontWeight: "800",
      letterSpacing: 1.4,
      textTransform: "uppercase",
      marginTop: theme.space.xl,
      marginBottom: theme.space.sm,
      paddingHorizontal: theme.space.md,
    },
    navItem: {
      minHeight: 36,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.md,
      paddingHorizontal: theme.space.md,
    },
    navIcon: { color: theme.colors.textMuted, width: 18 },
    navLabel: { color: theme.colors.textSecondary, fontWeight: "600", fontSize: 13 },
    navLabelActive: { color: theme.colors.text, fontWeight: "800" },
    navActiveDot: {
      marginLeft: "auto",
      width: 5,
      height: 5,
      borderRadius: 3,
      backgroundColor: theme.colors.accent,
    },
    activeText: { color: theme.colors.accent },
    signOut: { padding: theme.space.md, alignItems: "center" },
    signOutText: { color: theme.colors.textMuted, fontSize: 11, fontWeight: "700" },
    tabBar: {
      backgroundColor: theme.colors.sidebar,
      borderTopWidth: 1,
      borderTopColor: theme.colors.separator,
      paddingBottom: Platform.OS === "ios" ? 20 : 8,
      paddingTop: theme.space.sm,
    },
    tabList: { flexDirection: "row", justifyContent: "space-around" },
    tabItem: {
      minWidth: 78,
      alignItems: "center",
      gap: theme.space.xs,
      paddingVertical: theme.space.xs,
    },
    tabItemActive: {},
    tabIcon: { color: theme.colors.textMuted, height: 22 },
    tabLabel: { color: theme.colors.textMuted, fontSize: 10, fontWeight: "700" },
    tabSafeArea: { flex: 1, backgroundColor: theme.colors.canvas },
    screenFrame: { flexGrow: 1, padding: theme.space.xl, paddingBottom: theme.space.xxxl },
    screenFrameDesktop: { padding: theme.space.xxxl },
    screenPage: { width: "100%", maxWidth: 900, alignSelf: "center" },
    operationRoute: { flex: 1, minHeight: 0 },
    operationToolbar: {
      height: 48,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: theme.space.lg,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.separator,
      backgroundColor: theme.colors.canvas,
    },
    operationToolbarTitle: {
      flex: 1,
      color: theme.colors.text,
      fontSize: 15,
      fontWeight: "700",
    },
    operationToolbarButton: {
      width: 34,
      height: 34,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 7,
    },
    operationFrame: { flexGrow: 1, padding: theme.space.xl, paddingBottom: theme.space.xxxl },
    operationFrameDesktop: {
      paddingHorizontal: theme.space.giant,
      paddingVertical: theme.space.huge,
    },
    rootOperation: { flex: 1, backgroundColor: theme.colors.canvas },
    fullScreenOperation: { flexGrow: 1, padding: theme.space.xl, paddingBottom: theme.space.xl },
    nativeMemorySearch: {
      height: 50,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.md,
      marginHorizontal: theme.space.xl,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.separatorStrong,
    },
    nativeMemorySearchInput: {
      flex: 1,
      color: theme.colors.text,
      fontSize: 15,
      paddingVertical: theme.space.md,
    },
    webStackHeader: {
      minHeight: 58,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.md,
      paddingHorizontal: theme.space.xl,
      backgroundColor: theme.colors.canvas,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.separator,
    },
    webBackButton: {
      width: 36,
      height: 44,
      alignItems: "flex-start",
      justifyContent: "center",
    },
    webHeaderTitle: { color: theme.colors.text, fontSize: 16, fontWeight: "700" },
    webHeaderSearch: {
      flex: 1,
      maxWidth: 820,
      height: 44,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.separatorStrong,
    },
    webHeaderSearchInput: {
      flex: 1,
      color: theme.colors.text,
      fontSize: 15,
      paddingVertical: theme.space.md,
    },
    moreScreen: {
      flexGrow: 1,
      paddingHorizontal: theme.space.xl,
      paddingTop: theme.space.xxl,
      paddingBottom: theme.space.giant,
    },
    moreSection: { marginBottom: theme.space.xl },
    moreSectionLabel: {
      color: theme.colors.accent,
      fontSize: 10,
      fontWeight: "800",
      letterSpacing: 1.4,
      textTransform: "uppercase",
      marginBottom: theme.space.xs,
    },
    moreRow: {
      minHeight: 58,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.md,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.separator,
    },
    moreIcon: { color: theme.colors.textSecondary, width: 24 },
    moreRowText: { flex: 1 },
    moreTitle: { color: theme.colors.text, fontSize: 14, fontWeight: "700" },
    moreDescription: { color: theme.colors.textMuted, fontSize: 11, marginTop: theme.space.xs },
    moreChevron: { color: theme.colors.textMuted },
    mobileSignOut: {
      minHeight: 52,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: theme.space.sm,
      marginTop: theme.space.lg,
      borderWidth: 1,
      borderColor: theme.colors.danger,
      borderRadius: 12,
    },
    mobileSignOutText: { color: theme.colors.danger, fontSize: 13, fontWeight: "800" },
  });
