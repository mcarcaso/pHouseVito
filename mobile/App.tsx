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
const labels: Record<MainRouteName, { label: string; icon: string }> = {
  Chat: { label: "Chat", icon: "●" },
  Voice: { label: "Voice", icon: "◉" },
  More: { label: "More", icon: "•••" },
  ...Object.fromEntries(
    operationAreas.map((item) => [routeForArea[item.id], { label: item.label, icon: item.icon }]),
  ),
} as Record<MainRouteName, { label: string; icon: string }>;

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
          <View style={styles.brandMark}>
            <Text style={styles.brandMarkText}>V</Text>
          </View>
          <View>
            <Text style={styles.brandName}>Vito</Text>
            <Text style={styles.brandCaption}>Personal operations</Text>
          </View>
        </View>
        <ScrollView contentContainerStyle={styles.desktopNavList}>
          {visible
            .filter((route) => route !== "More")
            .map((route) => {
              const item = labels[route];
              return (
                <Pressable
                  key={route}
                  onPress={() => navigation.navigate(route)}
                  style={[styles.navItem, current === route && styles.navItemActive]}
                >
                  <Text style={[styles.navIcon, current === route && styles.activeText]}>
                    {item.icon}
                  </Text>
                  <Text style={[styles.navLabel, current === route && styles.activeText]}>
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
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
              <Text style={[styles.tabIcon, active && styles.activeText]}>{item.icon}</Text>
              <Text style={[styles.tabLabel, active && styles.activeText]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function MoreMenu() {
  const navigation = useNavigation<NativeStackNavigationProp<MainTabParamList>>();
  return (
    <ScrollView contentContainerStyle={styles.moreScreen}>
      <View style={styles.moreGrid}>
        {operationAreas.map((item) => (
          <Pressable
            key={item.id}
            onPress={() => navigation.navigate(routeForArea[item.id])}
            style={styles.moreCard}
          >
            <View style={styles.moreCardLabel}>
              <Text style={styles.moreCardIcon}>{item.icon}</Text>
              <Text style={styles.moreCardTitle}>{item.label}</Text>
            </View>
            <Text style={styles.moreArrow}>›</Text>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#080a09" },
  loading: { flex: 1, backgroundColor: "#080a09", alignItems: "center", justifyContent: "center" },
  routeBackground: { backgroundColor: "#080a09" },
  sidebar: {
    width: 224,
    paddingHorizontal: 14,
    paddingTop: 18,
    paddingBottom: 14,
    backgroundColor: "#0d100e",
    borderRightWidth: 1,
    borderRightColor: "#202421",
  },
  brand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    paddingHorizontal: 8,
    marginBottom: 18,
  },
  brandMark: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: "#b7f34a",
    alignItems: "center",
    justifyContent: "center",
  },
  brandMarkText: { color: "#11150d", fontWeight: "900", fontSize: 20 },
  brandName: { color: "#f5f7f4", fontSize: 17, fontWeight: "800" },
  brandCaption: {
    color: "#6f776f",
    fontSize: 8,
    marginTop: 2,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  desktopNavList: { gap: 2, paddingBottom: 10 },
  navItem: {
    minHeight: 39,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 11,
    borderRadius: 10,
  },
  navItemActive: { backgroundColor: "#1a2117" },
  navIcon: { color: "#767d76", fontSize: 16, width: 24, textAlign: "center", fontWeight: "700" },
  navLabel: { color: "#949b94", fontWeight: "600", fontSize: 13 },
  activeText: { color: "#c5fb64" },
  signOut: { padding: 10, alignItems: "center" },
  signOutText: { color: "#687068", fontSize: 11, fontWeight: "700" },
  tabBar: {
    backgroundColor: "#0d100ef2",
    borderTopWidth: 1,
    borderTopColor: "#242824",
    paddingBottom: Platform.OS === "ios" ? 20 : 8,
    paddingTop: 7,
  },
  tabList: { flexDirection: "row", justifyContent: "space-around" },
  tabItem: { minWidth: 78, alignItems: "center", gap: 3, paddingVertical: 5, borderRadius: 10 },
  tabItemActive: { backgroundColor: "#171c15" },
  tabIcon: { color: "#737a73", fontSize: 18, height: 22, fontWeight: "700" },
  tabLabel: { color: "#737a73", fontSize: 10, fontWeight: "700" },
  screenFrame: { flexGrow: 1, padding: 20, paddingBottom: 30 },
  screenFrameDesktop: { padding: 32 },
  screenPage: { width: "100%", maxWidth: 900, alignSelf: "center" },
  operationFrame: { flexGrow: 1, padding: 18, paddingBottom: 30 },
  operationFrameDesktop: { padding: 28 },
  fullScreenOperation: { flexGrow: 1, padding: 18, paddingBottom: 40 },
  moreScreen: { flexGrow: 1, padding: 18, paddingBottom: 30 },
  moreGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  moreCard: {
    width: "48%",
    minHeight: 78,
    backgroundColor: "#151914",
    borderWidth: 1,
    borderColor: "#30362d",
    borderRadius: 16,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  moreCardLabel: { flex: 1, gap: 7 },
  moreCardIcon: { fontSize: 22 },
  moreCardTitle: { color: "#f3f5ef", fontWeight: "800", fontSize: 14 },
  moreArrow: { color: "#b7f34a", fontSize: 24 },
});
