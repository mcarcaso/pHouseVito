import {
  NavigationContainer,
  type LinkingOptions,
  type NavigatorScreenParams,
  useNavigation,
} from "@react-navigation/native";
import { createBottomTabNavigator, type BottomTabBarProps } from "@react-navigation/bottom-tabs";
import {
  createNativeStackNavigator,
  type NativeStackNavigationProp,
} from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { ChatScreen } from "./src/ChatScreen";
import { LoginScreen } from "./src/LoginScreen";
import { operationAreas, OperationsScreen, type OperationArea } from "./src/OperationsScreen";
import { VoiceScreen } from "./src/VoiceScreen";
import { checkAuth, loadToken, logout, saveToken } from "./src/api";

type MainTabParamList = {
  Chat: undefined;
  Voice: undefined;
  More: undefined;
  Memory: undefined;
  Skills: undefined;
  Jobs: undefined;
  Apps: undefined;
  Drive: undefined;
  Traces: undefined;
  PiSessions: undefined;
  Settings: undefined;
  Secrets: undefined;
  System: undefined;
  Server: undefined;
  Providers: undefined;
};
type MainRouteName = keyof MainTabParamList;
type RootStackParamList = {
  Main: NavigatorScreenParams<MainTabParamList> | undefined;
  MemoryResults: { query: string };
};
type RootNavigation = NativeStackNavigationProp<RootStackParamList>;
const RootStack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<MainTabParamList>();

const routeForArea: Record<OperationArea, MainRouteName> = {
  memory: "Memory",
  skills: "Skills",
  jobs: "Jobs",
  apps: "Apps",
  drive: "Drive",
  traces: "Traces",
  pi: "PiSessions",
  settings: "Settings",
  secrets: "Secrets",
  system: "System",
  server: "Server",
  providers: "Providers",
};
const areaForRoute = Object.fromEntries(
  Object.entries(routeForArea).map(([area, route]) => [route, area]),
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
  skills: { icon: "construct-outline", description: "Capabilities", group: "Intelligence" },
  jobs: { icon: "time-outline", description: "Schedules and routines", group: "Automation" },
  apps: { icon: "grid-outline", description: "Tools and services", group: "Automation" },
  drive: { icon: "folder-outline", description: "Files and sites", group: "Operations" },
  traces: { icon: "search-outline", description: "Execution history", group: "Operations" },
  pi: { icon: "terminal-outline", description: "Runtime state", group: "Operations" },
  settings: { icon: "settings-outline", description: "Behavior and models", group: "Vito" },
  secrets: { icon: "key-outline", description: "Credentials", group: "Vito" },
  system: { icon: "document-text-outline", description: "Soul and instructions", group: "Vito" },
  server: { icon: "server-outline", description: "Service health", group: "Vito" },
  providers: { icon: "cloud-outline", description: "Authentication", group: "Vito" },
};
const labels: Record<MainRouteName, { label: string; icon: IconName }> = {
  Chat: { label: "Chat", icon: "chatbubble-outline" },
  Voice: { label: "Voice", icon: "mic-outline" },
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
          Chat: "chat",
          Voice: "voice",
          More: "more",
          Memory: "memory",
          Skills: "skills",
          Jobs: "jobs",
          Apps: "apps",
          Drive: "drive",
          Traces: "traces",
          PiSessions: "pi-sessions",
          Settings: "settings",
          Secrets: "secrets",
          System: "system",
          Server: "server",
          Providers: "providers",
        },
      },
      MemoryResults: "memory/results/:query",
    },
  },
};

export default function App() {
  const [authState, setAuthState] = useState<"loading" | "authenticated" | "login">("loading");
  useEffect(() => {
    void (async () => {
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
        <StatusBar style="light" />
        <ActivityIndicator color="#b7f34a" />
      </SafeAreaView>
    );
  if (authState === "login")
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="light" />
        <LoginScreen onSuccess={() => setAuthState("authenticated")} />
      </SafeAreaView>
    );
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <NavigationContainer linking={linking}>
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
              />
            )}
          </RootStack.Screen>
          <RootStack.Screen name="MemoryResults" component={MemoryResultsScreen} />
        </RootStack.Navigator>
      </NavigationContainer>
    </SafeAreaView>
  );
}

function MainTabs({
  onUnauthorized,
  onLogout,
}: {
  onUnauthorized: () => void;
  onLogout: () => void;
}) {
  const { width } = useWindowDimensions();
  const desktop = width >= 760;
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
      <Tabs.Screen name="Chat">{() => <ChatScreen onUnauthorized={onUnauthorized} />}</Tabs.Screen>
      <Tabs.Screen name="Voice">
        {() => (
          <ScreenFrame desktop={desktop}>
            <VoiceScreen onUnauthorized={onUnauthorized} />
          </ScreenFrame>
        )}
      </Tabs.Screen>
      <Tabs.Screen name="More" component={MoreMenu} />
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

function MemoryResultsScreen({
  route,
  navigation,
}: {
  route: { params: { query: string } };
  navigation: RootNavigation;
}) {
  return (
    <ScrollView contentContainerStyle={styles.fullScreenOperation}>
      <OperationsScreen
        initialArea="memory"
        initialMemoryQuery={route.params.query}
        showAreaTabs={false}
        onUnauthorized={() => navigation.navigate("Main", { screen: "More" })}
        onBack={() => navigation.goBack()}
      />
    </ScrollView>
  );
}

function ScreenFrame({ desktop, children }: { desktop: boolean; children: React.ReactNode }) {
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
  const root = useNavigation<RootNavigation>();
  return (
    <ScrollView
      contentContainerStyle={[styles.operationFrame, desktop && styles.operationFrameDesktop]}
    >
      <OperationsScreen
        key={area}
        initialArea={area}
        showAreaTabs={false}
        onUnauthorized={onUnauthorized}
        onMemorySearch={
          area === "memory" ? (query) => root.navigate("MemoryResults", { query }) : undefined
        }
      />
    </ScrollView>
  );
}

function AdaptiveTabBar({
  state,
  navigation,
  desktop,
  onLogout,
}: BottomTabBarProps & { desktop: boolean; onLogout: () => void }) {
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
          {(["Chat", "Voice"] as MainRouteName[]).map((route) => (
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

function MoreMenu() {
  const navigation = useNavigation<NativeStackNavigationProp<MainTabParamList>>();
  return (
    <ScrollView contentContainerStyle={styles.moreScreen}>
      {(["Intelligence", "Automation", "Operations", "Vito"] as const).map((group) => (
        <View key={group} style={styles.moreSection}>
          <Text style={styles.moreSectionLabel}>{group}</Text>
          {operationAreas
            .filter((item) => operationMeta[item.id].group === group)
            .map((item) => {
              const meta = operationMeta[item.id];
              return (
                <Pressable
                  key={item.id}
                  onPress={() => navigation.navigate(routeForArea[item.id])}
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#0b0d0b" },
  loading: { flex: 1, backgroundColor: "#0b0d0b", alignItems: "center", justifyContent: "center" },
  routeBackground: { backgroundColor: "#0b0d0b" },
  sidebar: {
    width: 224,
    paddingHorizontal: 14,
    paddingTop: 18,
    paddingBottom: 14,
    backgroundColor: "#0f120f",
    borderRightWidth: 1,
    borderRightColor: "#1d211d",
  },
  brand: { flexDirection: "row", paddingHorizontal: 10, marginBottom: 24 },
  brandName: { color: "#f0f2ed", fontSize: 19, fontWeight: "800" },
  brandDot: { color: "#a3be8c", fontSize: 19, fontWeight: "800" },
  desktopNavList: { paddingBottom: 10 },
  navSection: {
    color: "#7e877e",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginTop: 18,
    marginBottom: 6,
    paddingHorizontal: 10,
  },
  navItem: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    paddingHorizontal: 10,
  },
  navIcon: { color: "#8d958d", width: 18 },
  navLabel: { color: "#aeb4ad", fontWeight: "600", fontSize: 13 },
  navLabelActive: { color: "#f0f2ed", fontWeight: "800" },
  navActiveDot: {
    marginLeft: "auto",
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: "#a3be8c",
  },
  activeText: { color: "#a3be8c" },
  signOut: { padding: 10, alignItems: "center" },
  signOutText: { color: "#687068", fontSize: 11, fontWeight: "700" },
  tabBar: {
    backgroundColor: "#0f120ff5",
    borderTopWidth: 1,
    borderTopColor: "#292e29",
    paddingBottom: Platform.OS === "ios" ? 20 : 8,
    paddingTop: 7,
  },
  tabList: { flexDirection: "row", justifyContent: "space-around" },
  tabItem: { minWidth: 78, alignItems: "center", gap: 3, paddingVertical: 5 },
  tabItemActive: {},
  tabIcon: { color: "#7e877e", height: 22 },
  tabLabel: { color: "#7e877e", fontSize: 10, fontWeight: "700" },
  screenFrame: { flexGrow: 1, padding: 20, paddingBottom: 30 },
  screenFrameDesktop: { padding: 32 },
  screenPage: { width: "100%", maxWidth: 900, alignSelf: "center" },
  operationFrame: { flexGrow: 1, padding: 20, paddingBottom: 30 },
  operationFrameDesktop: { paddingHorizontal: 64, paddingVertical: 54 },
  fullScreenOperation: { flexGrow: 1, padding: 20, paddingBottom: 40 },
  moreScreen: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 24, paddingBottom: 90 },
  moreSection: { marginBottom: 19 },
  moreSectionLabel: {
    color: "#a3be8c",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 5,
  },
  moreRow: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1d211d",
  },
  moreIcon: { color: "#aeb6ad", width: 24 },
  moreRowText: { flex: 1 },
  moreTitle: { color: "#f0f2ed", fontSize: 14, fontWeight: "700" },
  moreDescription: { color: "#7e877e", fontSize: 11, marginTop: 3 },
  moreChevron: { color: "#687068" },
});
