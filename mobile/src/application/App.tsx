import type { VitoTheme } from "../hooks/useVitoTheme";
import { StyleSheet } from "react-native";
import { operationAreas, type OperationArea } from "../screens/operations/operation-catalog";
import {
  NavigationContainer,
  createNavigationContainerRef,
  useNavigation,
} from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { SafeAreaView as ContextSafeAreaView } from "react-native-safe-area-context";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { HeaderButton } from "@react-navigation/elements";
import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { ChatScreen, DEFAULT_SESSION } from "../screens/chat/ChatScreen";
import { HomeScreen, type QuickCommandRecordingStatus } from "../screens/home/HomeScreen";
import { QuickCommandRecordingOverlay } from "../components/quick-command/QuickCommandRecordingOverlay";
import {
  IdentityDocumentScreen,
  IdentityHome,
  identityDocumentTitle,
} from "../screens/identity/IdentityScreen";
import { LoginScreen } from "../screens/auth/LoginScreen";
import { OperationWorkspace } from "../screens/operations/OperationWorkspace";
import { OperationItemDetailScreen } from "../screens/operations/OperationItemDetailScreen";
import { SkillsScreen } from "../screens/skills/SkillsScreen";
import { SettingsScreen } from "../screens/settings/SettingsScreen";
import { ThemeScreen } from "../screens/theme/ThemeScreen";
import { JobEditorScreen, JobsScreen } from "../screens/jobs/JobsScreen";
import { SecretEditorScreen, SecretsScreen, type Secret } from "../screens/secrets/SecretsScreen";
import {
  SkillDocumentScreen,
  SkillFilesScreen,
  SkillFileScreen,
} from "../screens/skills/SkillMobileScreens";
import {
  VoiceScreen,
  type VoiceOverlayControls,
  type VoiceOverlayStatus,
} from "../screens/voice/VoiceScreen";
import { VoiceHistoryDetailScreen, VoiceHistoryScreen } from "../screens/voice/VoiceHistoryScreen";
import { SpeechSettingsScreen } from "../screens/app-settings/AppSettingsScreen";
import { VoiceModeSettingsScreen } from "../screens/app-settings/VoiceModeSettingsScreen";
import { api, checkAuth, loadAgentUrl, loadToken, logout, saveToken } from "../services/api/client";
import { AppProviders } from "../providers/AppProviders";
import { WebStackHeader } from "../components/navigation/WebStackHeader";
import { MobileTabBar } from "../components/navigation/MobileTabBar";
import {
  DesktopNavigationSidebar,
  type DesktopDestination,
} from "../components/navigation/DesktopNavigationSidebar";
import { GlobalVoiceOverlay } from "../components/voice/GlobalVoiceOverlay";
import { AgentIdentityProvider, useAgentName } from "../contexts/agentIdentity";
import { DESKTOP_BREAKPOINT, useThemeStyles, useVitoTheme } from "../hooks/useVitoTheme";
import { registerPushNotifications } from "../services/push-notifications/registration";
import { AuthGenerationGuard } from "../services/auth/auth-generation-guard";

import type {
  MainRouteName,
  MainTabParamList,
  RootStackParamList,
  ResourceRouteParams,
} from "./navigation/route-types";

type RootNavigation = NativeStackNavigationProp<RootStackParamList>;
import { RootStack } from "./navigation/root-stack";
const Tabs = createBottomTabNavigator<MainTabParamList>();
const navigationRef = createNavigationContainerRef<RootStackParamList>();
const desktopPaneRoutes = new Set<keyof RootStackParamList>([
  "ChatConversation",
  "IdentityDocument",
  "MemoryResults",
  "PiSessionDetail",
  "TraceDetail",
  "OperationItemDetail",
  "DriveDirectory",
  "JobDetail",
  "SkillDetail",
  "SkillFiles",
  "SkillFile",
  "SecretDetail",
  "SecretNew",
  "VoiceHistoryDetail",
]);

const idleVoiceStatus: VoiceOverlayStatus = {
  state: "idle",
  muted: false,
  audioRoute: "speaker",
  runningTasks: 0,
  completedTasks: 0,
  failedTasks: 0,
};

import { areaForRoute, labels, linking, operationMeta, routeForArea } from "./navigation/config";

export default function App() {
  return (
    <AppProviders>
      <AppContent />
    </AppProviders>
  );
}

function AppContent() {
  const styles = useThemeStyles(createStyles);
  const theme = useVitoTheme();
  const { width } = useWindowDimensions();
  const [currentRoute, setCurrentRoute] = useState<string>("Home");
  const [currentOperationArea, setCurrentOperationArea] = useState<OperationArea | undefined>();
  const desktop = Platform.OS === "web" && width >= DESKTOP_BREAKPOINT;
  const desktopDetailOpen =
    desktop && desktopPaneRoutes.has(currentRoute as keyof RootStackParamList);
  const [authState, setAuthState] = useState<"loading" | "authenticated" | "login" | "setup">(
    "loading",
  );
  const authGuard = useRef(new AuthGenerationGuard()).current;
  const acceptUnauthorized = useMemo(() => authGuard.capture(), [authGuard, authState]);
  const markAuthenticated = useCallback(() => {
    authGuard.advance();
    setAuthState("authenticated");
  }, [authGuard]);
  const [voiceStatus, setVoiceStatus] = useState<VoiceOverlayStatus>(idleVoiceStatus);
  const [voiceControls, setVoiceControls] = useState<VoiceOverlayControls | null>(null);
  const [quickCommandRecording, setQuickCommandRecording] =
    useState<QuickCommandRecordingStatus | null>(null);
  const [pendingNotificationSession, setPendingNotificationSession] = useState<string | null>(null);
  useEffect(() => {
    if (Platform.OS === "web") return;
    const openResponse = (response: Notifications.NotificationResponse | null) => {
      const sessionId = response?.notification.request.content.data?.sessionId;
      if (typeof sessionId !== "string") return;
      if (navigationRef.isReady()) navigationRef.navigate("ChatConversation", { sessionId });
      else setPendingNotificationSession(sessionId);
    };
    const subscription = Notifications.addNotificationResponseReceivedListener(openResponse);
    void Notifications.getLastNotificationResponseAsync().then(openResponse);
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (authState === "authenticated") void registerPushNotifications().catch(() => undefined);
  }, [authState]);
  const updateVoiceStatus = useCallback((status: VoiceOverlayStatus) => {
    setVoiceStatus(status);
  }, []);
  const syncNavigationLocation = useCallback(() => {
    const route = navigationRef.getCurrentRoute();
    setCurrentRoute(route?.name ?? "Home");
    const operationRoute = [...(navigationRef.getRootState()?.routes ?? [])]
      .reverse()
      .find((item) => item.name === "Operation");
    const operationParams = operationRoute?.params as { area?: OperationArea } | undefined;
    setCurrentOperationArea(operationParams?.area);
  }, []);
  const selectDesktopDestination = useCallback((destination: DesktopDestination) => {
    if (!navigationRef.isReady()) return;
    if (destination.type === "main") {
      setCurrentOperationArea(undefined);
      navigationRef.reset({
        index: 0,
        routes: [{ name: "Main", params: { screen: destination.route } }],
      });
    } else if (destination.type === "identity") {
      setCurrentOperationArea(undefined);
      navigationRef.reset({ index: 0, routes: [{ name: "IdentityHome" }] });
    } else if (destination.type === "memory") {
      setCurrentOperationArea("memory");
      navigationRef.reset({ index: 0, routes: [{ name: "MemoryHome" }] });
    } else if (destination.type === "operation") {
      setCurrentOperationArea(destination.area);
      navigationRef.reset({
        index: 0,
        routes: [{ name: "Operation", params: { area: destination.area } }],
      });
    } else {
      setCurrentOperationArea(undefined);
      navigationRef.reset({ index: 0, routes: [{ name: destination.route }] });
    }
  }, []);
  useEffect(() => {
    void (async () => {
      await loadAgentUrl();
      await loadToken();
      try {
        const status = await checkAuth();
        if (status.authenticated) markAuthenticated();
        else setAuthState(status.passwordSet ? "login" : "setup");
      } catch {
        setAuthState("login");
      }
    })();
  }, [markAuthenticated]);
  const unauthorized = useCallback(() => {
    if (!acceptUnauthorized()) return;
    // Finish clearing the rejected token before showing login. Otherwise a fast
    // password-manager login can race the old SecureStore deletion.
    void saveToken(null).then(() => setAuthState("login"));
  }, [acceptUnauthorized]);
  if (authState === "loading")
    return (
      <SafeAreaView style={styles.loading}>
        <StatusBar style={theme.dark ? "light" : "dark"} />
        <ActivityIndicator color={theme.colors.accent} />
      </SafeAreaView>
    );
  if (authState === "login" || authState === "setup")
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style={theme.dark ? "light" : "dark"} />
        <LoginScreen
          mode={authState}
          onSuccess={markAuthenticated}
          onPasswordAlreadySet={() => setAuthState("login")}
        />
      </SafeAreaView>
    );
  return (
    <AgentIdentityProvider>
      <View style={[styles.safeArea, desktop && styles.desktopShell]}>
        <StatusBar style={theme.dark ? "light" : "dark"} />
        {desktop && (
          <DesktopNavigationSidebar
            activeRoute={currentRoute}
            activeOperationArea={currentOperationArea}
            onSelect={selectDesktopDestination}
            onLogout={() => void logout().finally(() => setAuthState("login"))}
          />
        )}
        <View style={styles.navigationContent}>
          <NavigationContainer
            ref={navigationRef}
            linking={linking}
            onReady={() => {
              syncNavigationLocation();
              if (pendingNotificationSession) {
                navigationRef.navigate("ChatConversation", {
                  sessionId: pendingNotificationSession,
                });
                setPendingNotificationSession(null);
              }
            }}
            onStateChange={syncNavigationLocation}
          >
            <RootStack.Navigator
              screenOptions={({ route }) => ({
                headerShown: false,
                animation: Platform.OS === "web" ? "none" : "slide_from_right",
                animationEnabled: Platform.OS !== "web",
                presentation:
                  desktop && desktopPaneRoutes.has(route.name) ? "transparentModal" : "card",
                detachPreviousScreen: !(desktop && desktopPaneRoutes.has(route.name)),
                contentStyle:
                  desktop && desktopPaneRoutes.has(route.name)
                    ? styles.desktopDetailRoute
                    : desktopDetailOpen
                      ? styles.desktopWorkspaceRoute
                      : styles.routeBackground,
                cardStyle:
                  desktop && desktopPaneRoutes.has(route.name)
                    ? styles.desktopDetailRoute
                    : desktopDetailOpen
                      ? styles.desktopWorkspaceRoute
                      : styles.routeBackground,
                headerStyle: { backgroundColor: theme.colors.canvas },
                headerTintColor: theme.colors.accent,
                headerTitleStyle: { color: theme.colors.text, fontSize: 16, fontWeight: "700" },
                headerShadowVisible: false,
                headerBackButtonDisplayMode: "minimal",
              })}
            >
              <RootStack.Screen name="Main" options={{ headerShown: true, title: "Chats" }}>
                {() => (
                  <MainTabs
                    onUnauthorized={unauthorized}
                    onLogout={() => void logout().finally(() => setAuthState("login"))}
                    onVoiceStatusChange={updateVoiceStatus}
                    onVoiceControlsChange={setVoiceControls}
                    onQuickCommandRecordingChange={setQuickCommandRecording}
                    desktop={desktop}
                  />
                )}
              </RootStack.Screen>
              <RootStack.Screen
                name="ChatConversation"
                options={{
                  headerShown: true,
                  title: "Chat",
                  headerStyle: { backgroundColor: theme.colors.canvas },
                  headerTintColor: theme.colors.text,
                  headerShadowVisible: false,
                }}
              >
                {({ route }) => (
                  <ChatScreen
                    onUnauthorized={unauthorized}
                    selectedSessionId={route.params.sessionId}
                    onSelectSession={(session) =>
                      navigationRef.navigate("ChatConversation", { sessionId: session.id })
                    }
                  />
                )}
              </RootStack.Screen>
              <RootStack.Screen
                name="IdentityHome"
                options={{
                  headerShown: true,
                  title: "Identity",
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
                  headerStyle: { backgroundColor: theme.colors.canvas },
                  headerTintColor: theme.colors.accent,
                  headerShadowVisible: false,
                  header:
                    Platform.OS === "web"
                      ? () => (
                          <WebStackHeader
                            onBack={navigation.canGoBack() ? () => navigation.goBack() : undefined}
                          />
                        )
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
                  const headerActions =
                    area === "secrets" ? (
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
                    ) : area === "jobs" ? (
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
                    ) : area === "pi" ? (
                      <HeaderButton
                        accessibilityLabel="Refresh Pi sessions"
                        onPress={() => navigation.setParams({ refreshKey: Date.now() })}
                        tintColor={theme.colors.accent}
                      >
                        <Ionicons name="refresh" size={21} color={theme.colors.accent} />
                      </HeaderButton>
                    ) : (
                        ["apps", "drive", "traces", "providers", "server"] as OperationArea[]
                      ).includes(area) ? (
                      <HeaderButton
                        accessibilityLabel={`Refresh ${title}`}
                        onPress={() => navigation.setParams({ refreshKey: Date.now() })}
                        tintColor={theme.colors.accent}
                      >
                        <Ionicons name="refresh" size={20} color={theme.colors.accent} />
                      </HeaderButton>
                    ) : undefined;
                  return {
                    headerShown: true,
                    headerTransparent: false,
                    title: area === "memory" ? "" : title,
                    headerStyle: { backgroundColor: theme.colors.canvas },
                    headerTintColor: theme.colors.accent,
                    headerTitleStyle: { color: theme.colors.text },
                    headerShadowVisible: false,
                    headerRight: headerActions ? () => headerActions : undefined,
                    header:
                      Platform.OS === "web"
                        ? () => (
                            <WebStackHeader
                              onBack={
                                navigation.canGoBack() ? () => navigation.goBack() : undefined
                              }
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
                              right={headerActions}
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
                      style={{
                        width: 44,
                        height: 44,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
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
                  headerStyle: { backgroundColor: theme.colors.canvas },
                  headerTintColor: theme.colors.accent,
                  headerShadowVisible: false,
                  headerRight: () => (
                    <Pressable
                      accessibilityLabel={
                        route.params.raw ? "Show formatted session" : "Show raw session"
                      }
                      onPress={() => navigation.setParams({ raw: !route.params.raw })}
                      style={{ paddingHorizontal: theme.space.sm, paddingVertical: theme.space.sm }}
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
                                style={{
                                  paddingHorizontal: theme.space.sm,
                                  paddingVertical: theme.space.sm,
                                }}
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
                  headerStyle: { backgroundColor: theme.colors.canvas },
                  headerTintColor: theme.colors.accent,
                  headerTitleStyle: { color: theme.colors.text },
                  headerShadowVisible: false,
                }}
              />
              <RootStack.Screen
                name="SpeechSettings"
                component={SpeechSettingsScreen}
                options={{
                  headerShown: true,
                  title: "Speech",
                  headerStyle: { backgroundColor: theme.colors.canvas },
                  headerTintColor: theme.colors.accent,
                  headerTitleStyle: { color: theme.colors.text },
                  headerShadowVisible: false,
                }}
              />
              <RootStack.Screen
                name="VoiceModeSettings"
                component={VoiceModeSettingsScreen}
                options={{
                  headerShown: true,
                  title: "Voice Mode",
                  headerStyle: { backgroundColor: theme.colors.canvas },
                  headerTintColor: theme.colors.accent,
                  headerTitleStyle: { color: theme.colors.text },
                  headerShadowVisible: false,
                }}
              />
              <RootStack.Screen
                name="AppThemeSettings"
                component={ThemeScreen}
                options={{
                  headerShown: true,
                  title: "Theme",
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
                  headerStyle: { backgroundColor: theme.colors.canvas },
                  headerTintColor: theme.colors.accent,
                  headerTitleStyle: { color: theme.colors.text },
                  headerShadowVisible: false,
                  headerRight: () => (
                    <Pressable
                      accessibilityLabel="Browse skill files"
                      hitSlop={8}
                      onPress={() => navigation.navigate("SkillFiles", { name: route.params.name })}
                      style={{
                        width: 44,
                        height: 44,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
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
          {quickCommandRecording && currentRoute !== "Home" && (
            <QuickCommandRecordingOverlay
              status={quickCommandRecording}
              onOpen={() =>
                navigationRef.isReady() && navigationRef.navigate("Main", { screen: "Home" })
              }
            />
          )}
          {voiceStatus.state !== "idle" &&
            voiceStatus.state !== "error" &&
            voiceControls &&
            currentRoute !== "Voice" && (
              <GlobalVoiceOverlay
                status={voiceStatus}
                controls={voiceControls}
                onPress={() =>
                  navigationRef.isReady() && navigationRef.navigate("Main", { screen: "Voice" })
                }
              />
            )}
        </View>
      </View>
    </AgentIdentityProvider>
  );
}

function MainTabs({
  onUnauthorized,
  onLogout,
  onVoiceStatusChange,
  onVoiceControlsChange,
  onQuickCommandRecordingChange,
  desktop,
}: {
  onUnauthorized: () => void;
  onLogout: () => void;
  onVoiceStatusChange: (status: VoiceOverlayStatus) => void;
  onVoiceControlsChange: (controls: VoiceOverlayControls | null) => void;
  onQuickCommandRecordingChange: (status: QuickCommandRecordingStatus | null) => void;
  desktop: boolean;
}) {
  const styles = useThemeStyles(createStyles);
  const theme = useVitoTheme();
  const rootNavigation = useNavigation<RootNavigation>();
  const agentName = useAgentName();
  return (
    <Tabs.Navigator
      initialRouteName="Home"
      tabBar={(props) => (desktop ? null : <MobileTabBar {...props} />)}
      screenListeners={{
        state: (event) => {
          const state = event.data.state;
          const active = state.routes[state.index]?.name;
          if (active === "Home") {
            rootNavigation.setOptions({
              title: "Home",
              headerLeft: undefined,
              headerRight: undefined,
            });
          } else if (active === "Chat") {
            rootNavigation.setOptions({ title: "Chats" });
          } else if (active === "Voice") {
            rootNavigation.setOptions({
              title: `Talk to ${agentName}`,
              headerLeft: undefined,
              headerRight: ({ tintColor }) => (
                <HeaderButton
                  accessibilityLabel="Voice conversation history"
                  onPress={() => rootNavigation.navigate("VoiceHistory")}
                  tintColor={tintColor}
                >
                  <Ionicons name="time-outline" size={22} color={tintColor} />
                </HeaderButton>
              ),
            });
          } else {
            rootNavigation.setOptions({
              title: "More",
              headerLeft: undefined,
              headerRight: undefined,
            });
          }
        },
      }}
      screenOptions={{
        headerShown: false,
        sceneStyle: styles.routeBackground,
        tabBarPosition: "bottom",
        animation: "none",
        lazy: false,
      }}
    >
      <Tabs.Screen name="Home">
        {() => (
          <HomeScreen
            onRecordingStatusChange={onQuickCommandRecordingChange}
            onOpenRun={(sessionId) => rootNavigation.navigate("ChatConversation", { sessionId })}
            onUnauthorized={onUnauthorized}
          />
        )}
      </Tabs.Screen>
      <Tabs.Screen name="Chat">
        {() => (
          <ChatScreen
            onUnauthorized={onUnauthorized}
            selectedSessionId={null}
            onSelectSession={(session) =>
              rootNavigation.navigate("ChatConversation", { sessionId: session.id })
            }
          />
        )}
      </Tabs.Screen>
      <Tabs.Screen
        name="Voice"
        options={{
          title: `Talk to ${agentName}`,
          headerStyle: { backgroundColor: theme.colors.canvas },
          headerTintColor: theme.colors.text,
          headerTitleStyle: { fontSize: 16, fontWeight: "700" },
          headerShadowVisible: false,
        }}
      >
        {() => (
          <View style={styles.operationRoute}>
            <View style={styles.voiceScreen}>
              <VoiceScreen
                onUnauthorized={onUnauthorized}
                onStatusChange={onVoiceStatusChange}
                onControlsChange={onVoiceControlsChange}
                onConfigureOpenAi={() => rootNavigation.navigate("Operation", { area: "secrets" })}
              />
            </View>
          </View>
        )}
      </Tabs.Screen>
      <Tabs.Screen
        name="More"
        options={{
          title: "More",
          headerStyle: { backgroundColor: theme.colors.canvas },
          headerTintColor: theme.colors.text,
          headerShadowVisible: false,
        }}
      >
        {() => <MoreMenu onLogout={onLogout} />}
      </Tabs.Screen>
    </Tabs.Navigator>
  );
}

import {
  RootMemoryScreen,
  JobDetailRoute,
  DriveDirectoryScreen,
  TraceDetailScreen,
  RootOperationItemDetailScreen,
  PiSessionDetailScreen,
  RootOperationScreen,
  MoreMenu,
  MemoryResultsScreen,
  RootVoiceHistoryScreen,
  RootVoiceHistoryDetailScreen,
  RootSecretDetailScreen,
  RootSecretNewScreen,
  RootSkillDetailScreen,
  RootSkillFilesScreen,
  RootSkillFileScreen,
  TabSafeArea,
  ScreenFrame,
} from "./navigation/route-screens";

const createStyles = (theme: VitoTheme) =>
  StyleSheet.create({
    loading: {
      flex: 1,
      backgroundColor: theme.colors.canvas,
      alignItems: "center",
      justifyContent: "center",
    },
    safeArea: { flex: 1, minHeight: 0, backgroundColor: theme.colors.canvas },
    desktopShell: { flexDirection: "row" },
    navigationContent: { flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden" },
    routeBackground: {
      flex: 1,
      minHeight: 0,
      overflow: "hidden",
      backgroundColor: theme.colors.canvas,
    },
    desktopWorkspaceRoute: {
      width: "40%",
      backgroundColor: theme.colors.canvas,
    },
    desktopDetailRoute: {
      marginLeft: "40%",
      width: "60%",
      backgroundColor: theme.colors.canvas,
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderLeftColor: theme.colors.separatorStrong,
    },
    operationRoute: { flex: 1, minHeight: 0 },
    voiceScreen: { flex: 1, paddingHorizontal: theme.space.xl, paddingBottom: theme.space.md },
    voiceScreenDesktop: {
      padding: theme.space.xxxl,
      maxWidth: 860,
      width: "100%",
      alignSelf: "center",
    },
  });
