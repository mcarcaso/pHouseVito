import {
  NavigationContainer,
  type LinkingOptions,
  useNavigation,
  useNavigationContainerRef,
} from "@react-navigation/native";
import {
  createNativeStackNavigator,
  type NativeStackNavigationProp,
} from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
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

type RootStackParamList = {
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

type RouteName = keyof RootStackParamList;
type Navigation = NativeStackNavigationProp<RootStackParamList>;
const Stack = createNativeStackNavigator<RootStackParamList>();

const routeForArea: Record<OperationArea, RouteName> = {
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
) as Partial<Record<RouteName, OperationArea>>;
const primaryRoutes: Array<{ route: RouteName; label: string; icon: string }> = [
  { route: "Chat", label: "Chat", icon: "●" },
  { route: "Voice", label: "Voice", icon: "◉" },
];
const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ["vito://", "https://mikes-mac-mini-1.tail1706d3.ts.net"],
  config: {
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
      <AuthenticatedApp
        onUnauthorized={unauthorized}
        onLogout={() => void logout().finally(() => setAuthState("login"))}
      />
    </SafeAreaView>
  );
}

function AuthenticatedApp({
  onUnauthorized,
  onLogout,
}: {
  onUnauthorized: () => void;
  onLogout: () => void;
}) {
  const { width } = useWindowDimensions();
  const desktop = width >= 760;
  const navigation = useNavigationContainerRef<RootStackParamList>();
  const [current, setCurrent] = useState<RouteName>("Chat");
  const navigate = (route: RouteName) => navigation.isReady() && navigation.navigate(route);
  return (
    <NavigationContainer
      ref={navigation}
      linking={linking}
      onReady={() => setCurrent((navigation.getCurrentRoute()?.name as RouteName) ?? "Chat")}
      onStateChange={() => setCurrent((navigation.getCurrentRoute()?.name as RouteName) ?? "Chat")}
    >
      <View style={[styles.shell, desktop && styles.desktopShell]}>
        {desktop && (
          <DesktopNavigation current={current} onNavigate={navigate} onLogout={onLogout} />
        )}
        <View style={styles.routeContent}>
          <Routes onUnauthorized={onUnauthorized} desktop={desktop} />
        </View>
        {!desktop && <MobileNavigation current={current} onNavigate={navigate} />}
      </View>
    </NavigationContainer>
  );
}

function Routes({ onUnauthorized, desktop }: { onUnauthorized: () => void; desktop: boolean }) {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        animation: Platform.OS === "web" ? "none" : "slide_from_right",
        contentStyle: styles.routeBackground,
      }}
    >
      <Stack.Screen name="Chat">
        {() => <ChatScreen onUnauthorized={onUnauthorized} />}
      </Stack.Screen>
      <Stack.Screen name="Voice">
        {() => (
          <ScreenFrame desktop={desktop}>
            <VoiceScreen onUnauthorized={onUnauthorized} />
          </ScreenFrame>
        )}
      </Stack.Screen>
      <Stack.Screen name="More">{() => <MoreMenu />}</Stack.Screen>
      {(Object.entries(areaForRoute) as Array<[RouteName, OperationArea]>).map(([route, area]) => (
        <Stack.Screen key={route} name={route}>
          {({ navigation }) => (
            <OperationRoute
              area={area}
              desktop={desktop}
              onUnauthorized={onUnauthorized}
              onBack={() => navigation.goBack()}
            />
          )}
        </Stack.Screen>
      ))}
    </Stack.Navigator>
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
  onBack,
}: {
  area: OperationArea;
  desktop: boolean;
  onUnauthorized: () => void;
  onBack: () => void;
}) {
  const scroll = useRef<ScrollView>(null);
  return (
    <ScrollView
      ref={scroll}
      contentContainerStyle={[styles.operationFrame, desktop && styles.operationFrameDesktop]}
    >
      <OperationsScreen
        key={area}
        initialArea={area}
        showAreaTabs={false}
        onUnauthorized={onUnauthorized}
        onBack={desktop ? undefined : onBack}
        onDetailOpen={() => scroll.current?.scrollTo({ y: 0, animated: false })}
      />
    </ScrollView>
  );
}

function DesktopNavigation({
  current,
  onNavigate,
  onLogout,
}: {
  current: RouteName;
  onNavigate: (route: RouteName) => void;
  onLogout: () => void;
}) {
  const items = [
    ...primaryRoutes,
    ...operationAreas.map((item) => ({
      route: routeForArea[item.id],
      label: item.label,
      icon: item.icon,
    })),
  ];
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
        {items.map((item) => (
          <Pressable
            key={item.route}
            onPress={() => onNavigate(item.route)}
            style={[styles.navItem, current === item.route && styles.navItemActive]}
          >
            <Text style={[styles.navIcon, current === item.route && styles.activeText]}>
              {item.icon}
            </Text>
            <Text style={[styles.navLabel, current === item.route && styles.activeText]}>
              {item.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      <Pressable onPress={onLogout} style={styles.signOut}>
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </View>
  );
}

function MobileNavigation({
  current,
  onNavigate,
}: {
  current: RouteName;
  onNavigate: (route: RouteName) => void;
}) {
  const moreActive = current === "More" || current in areaForRoute;
  const items = [...primaryRoutes, { route: "More" as const, label: "More", icon: "•••" }];
  return (
    <View style={styles.tabBar}>
      <View style={styles.tabList}>
        {items.map((item) => {
          const active = item.route === "More" ? moreActive : current === item.route;
          return (
            <Pressable
              key={item.route}
              onPress={() => onNavigate(item.route)}
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
  const navigation = useNavigation<Navigation>();
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
  shell: { flex: 1, minHeight: 0, overflow: "hidden", backgroundColor: "#080a09" },
  desktopShell: { flexDirection: "row" },
  routeContent: { flex: 1, minWidth: 0, minHeight: 0 },
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
    zIndex: 30,
  },
  tabList: { flexDirection: "row", justifyContent: "space-around" },
  tabItem: { minWidth: 78, alignItems: "center", gap: 3, paddingVertical: 5, borderRadius: 10 },
  tabItemActive: { backgroundColor: "#171c15" },
  tabIcon: { color: "#737a73", fontSize: 18, height: 22, fontWeight: "700" },
  tabLabel: { color: "#737a73", fontSize: 10, fontWeight: "700" },
  screenFrame: { flexGrow: 1, padding: 20, paddingBottom: 100 },
  screenFrameDesktop: { padding: 32 },
  screenPage: { width: "100%", maxWidth: 900, alignSelf: "center" },
  operationFrame: { flexGrow: 1, padding: 18, paddingBottom: 100 },
  operationFrameDesktop: { padding: 28 },
  moreScreen: { flexGrow: 1, padding: 18, paddingBottom: 100 },
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
