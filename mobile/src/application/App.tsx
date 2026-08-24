import { operationAreas, type OperationArea } from "../screens/operations/operation-catalog";
import {
  NavigationContainer,
  createNavigationContainerRef,
  useNavigation,
} from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { SafeAreaView as ContextSafeAreaView } from "react-native-safe-area-context";
import {
  createNativeStackNavigator,
  type NativeStackNavigationProp,
} from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
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
import {
  DesktopSecretsScreen,
  SecretEditorScreen,
  SecretsScreen,
  type Secret,
} from "../screens/secrets/SecretsScreen";
import {
  SkillDocumentScreen,
  SkillFilesScreen,
  SkillFileScreen,
} from "../screens/skills/SkillMobileScreens";
import { VoiceScreen, type VoiceOverlayStatus } from "../screens/voice/VoiceScreen";
import { VoiceHistoryDetailScreen, VoiceHistoryScreen } from "../screens/voice/VoiceHistoryScreen";
import { api, checkAuth, loadAgentUrl, loadToken, logout, saveToken } from "../services/api/client";
import { AppProviders } from "../providers/AppProviders";
import { createAppStyles } from "./styles";
import { WebStackHeader } from "../components/navigation/WebStackHeader";
import { AdaptiveTabBar } from "../components/navigation/AdaptiveTabBar";
import { GlobalVoiceOverlay } from "../components/voice/GlobalVoiceOverlay";
import { DESKTOP_BREAKPOINT, useThemeStyles, useVitoTheme } from "../hooks/useVitoTheme";

import type {
  ChatStackParamList,
  IdentityStackParamList,
  MainRouteName,
  MainTabParamList,
  MoreStackParamList,
  RootStackParamList,
} from "./navigation/route-types";

type RootNavigation = NativeStackNavigationProp<RootStackParamList>;
const RootStack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<MainTabParamList>();
const ChatStack = createNativeStackNavigator<ChatStackParamList>();
const MoreStack = createNativeStackNavigator<MoreStackParamList>();
const IdentityStack = createNativeStackNavigator<IdentityStackParamList>();
const navigationRef = createNavigationContainerRef<RootStackParamList>();
const idleVoiceStatus: VoiceOverlayStatus = {
  state: "idle",
  muted: false,
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
  const styles = useThemeStyles(createAppStyles);
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
  const styles = useThemeStyles(createAppStyles);
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
  const styles = useThemeStyles(createAppStyles);
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

import {
  RootMemoryScreen,
  JobDetailRoute,
  DriveDirectoryScreen,
  TraceDetailScreen,
  RootOperationItemDetailScreen,
  PiSessionDetailScreen,
  RootOperationScreen,
  IdentityNavigator,
  MoreStackScreen,
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
  MoreMenu,
} from "./navigation/route-screens";
import { OperationRoute } from "./navigation/OperationRoute";
