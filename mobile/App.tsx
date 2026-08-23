import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import { ChatScreen } from "./src/ChatScreen";
import { LoginScreen } from "./src/LoginScreen";
import { checkAuth, loadToken, logout, saveToken, VITO_URL } from "./src/api";
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

type HealthState =
  | { kind: "loading" }
  | { kind: "online"; checkedAt: Date }
  | { kind: "offline"; message: string; checkedAt: Date };

type Screen = "home" | "chat" | "more";

const navigation: Array<{ id: Screen; label: string; icon: string }> = [
  { id: "home", label: "Home", icon: "⌂" },
  { id: "chat", label: "Chat", icon: "●" },
  { id: "more", label: "More", icon: "•••" },
];

export default function App() {
  const [screen, setScreen] = useState<Screen>("chat");
  const [health, setHealth] = useState<HealthState>({ kind: "loading" });
  const [authState, setAuthState] = useState<"loading" | "authenticated" | "login">("loading");
  const { width } = useWindowDimensions();
  const desktop = width >= 760;

  const checkHealth = useCallback(async () => {
    setHealth({ kind: "loading" });
    try {
      const response = await fetch(
        `${VITO_URL}/api/health`,
        Platform.OS === "web" ? { mode: "no-cors" } : undefined,
      );
      // Browser development runs on Metro's port and receives an opaque
      // no-CORS response from Vito. A resolved request still confirms reachability.
      if (response.type !== "opaque" && !response.ok) throw new Error(`HTTP ${response.status}`);
      setHealth({ kind: "online", checkedAt: new Date() });
    } catch (error) {
      setHealth({
        kind: "offline",
        message: error instanceof Error ? error.message : "Connection failed",
        checkedAt: new Date(),
      });
    }
  }, []);

  useEffect(() => {
    void checkHealth();
    void (async () => {
      await loadToken();
      try {
        const status = await checkAuth();
        setAuthState(status.authenticated ? "authenticated" : "login");
      } catch {
        setAuthState("login");
      }
    })();
  }, [checkHealth]);

  const unauthorized = useCallback(() => {
    void saveToken(null);
    setAuthState("login");
  }, []);

  if (authState === "loading") {
    return (
      <SafeAreaView style={styles.loading}>
        <StatusBar style="light" />
        <ActivityIndicator color="#b7f34a" />
      </SafeAreaView>
    );
  }

  if (authState === "login") {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="light" />
        <LoginScreen onSuccess={() => setAuthState("authenticated")} />
      </SafeAreaView>
    );
  }

  const content =
    screen === "home" ? (
      <Home health={health} checkHealth={checkHealth} />
    ) : screen === "chat" ? (
      <ChatScreen onUnauthorized={unauthorized} />
    ) : (
      <ComingSoon
        eyebrow="PARITY PLAN"
        title="One dashboard, every surface."
        body="Settings, jobs, apps, Drive, memory and server controls will move into this shared Expo application one capability at a time."
        action="Sign out"
        onAction={() => void logout().finally(() => setAuthState("login"))}
      />
    );

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={[styles.shell, desktop && styles.shellDesktop]}>
        {desktop && <Navigation screen={screen} setScreen={setScreen} desktop />}
        {screen === "chat" ? (
          <View style={[styles.content, styles.chatContent, desktop && styles.contentDesktop]}>
            <View style={[styles.page, styles.chatPage]}>{content}</View>
          </View>
        ) : (
          <ScrollView contentContainerStyle={[styles.content, desktop && styles.contentDesktop]}>
            <View style={styles.page}>{content}</View>
          </ScrollView>
        )}
        {!desktop && <Navigation screen={screen} setScreen={setScreen} />}
      </View>
    </SafeAreaView>
  );
}

function Navigation({
  screen,
  setScreen,
  desktop = false,
}: {
  screen: Screen;
  setScreen: (screen: Screen) => void;
  desktop?: boolean;
}) {
  return (
    <View style={desktop ? styles.sidebar : styles.tabBar}>
      {desktop && (
        <View style={styles.brand}>
          <View style={styles.brandMark}>
            <Text style={styles.brandMarkText}>V</Text>
          </View>
          <View>
            <Text style={styles.brandName}>Vito</Text>
            <Text style={styles.brandCaption}>Personal operations</Text>
          </View>
        </View>
      )}
      <View style={desktop ? styles.navList : styles.tabList}>
        {navigation.map((item) => {
          const active = item.id === screen;
          return (
            <Pressable
              accessibilityRole="button"
              key={item.id}
              onPress={() => setScreen(item.id)}
              style={({ pressed }) => [
                desktop ? styles.navItem : styles.tabItem,
                active && (desktop ? styles.navItemActive : styles.tabItemActive),
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.navIcon, active && styles.activeText]}>{item.icon}</Text>
              <Text
                style={[desktop ? styles.navLabel : styles.tabLabel, active && styles.activeText]}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {desktop && <Text style={styles.sidebarFooter}>EXPO FOUNDATION · 0.1</Text>}
    </View>
  );
}

function Home({ health, checkHealth }: { health: HealthState; checkHealth: () => Promise<void> }) {
  const online = health.kind === "online";
  return (
    <View>
      <Text style={styles.eyebrow}>VITO MOBILE</Text>
      <Text style={styles.title}>The family business,{"\n"}now in your pocket.</Text>
      <Text style={styles.subtitle}>
        A shared native and web foundation for managing Vito anywhere. We start small, keep it
        clean, and move toward complete dashboard parity.
      </Text>

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View>
            <Text style={styles.cardLabel}>HOME SERVER</Text>
            <Text style={styles.cardTitle}>Vito connection</Text>
          </View>
          <View style={[styles.statusPill, online ? styles.statusOnline : styles.statusNeutral]}>
            {health.kind === "loading" ? (
              <ActivityIndicator size="small" color="#a3a3a3" />
            ) : (
              <>
                <View style={[styles.statusDot, online ? styles.dotOnline : styles.dotOffline]} />
                <Text style={[styles.statusText, online && styles.statusTextOnline]}>
                  {online ? "Online" : "Offline"}
                </Text>
              </>
            )}
          </View>
        </View>
        <View style={styles.rule} />
        <Text style={styles.endpointLabel}>ENDPOINT</Text>
        <Text style={styles.endpoint} numberOfLines={1}>
          {VITO_URL}
        </Text>
        {health.kind === "offline" && <Text style={styles.errorText}>{health.message}</Text>}
        {health.kind !== "loading" && (
          <Text style={styles.checkedText}>Checked {health.checkedAt.toLocaleTimeString()}</Text>
        )}
        <View style={styles.actions}>
          <Button title="Check again" onPress={() => void checkHealth()} />
          <Button title="Open dashboard" secondary onPress={() => void Linking.openURL(VITO_URL)} />
        </View>
      </View>

      <View style={styles.smallCard}>
        <Text style={styles.smallCardNumber}>✓</Text>
        <View style={styles.smallCardBody}>
          <Text style={styles.smallCardTitle}>Native update verified</Text>
          <Text style={styles.smallCardText}>
            Delivered remotely through EAS Update · August 23
          </Text>
        </View>
      </View>
    </View>
  );
}

function ComingSoon({
  eyebrow,
  title,
  body,
  action,
  onAction,
}: {
  eyebrow: string;
  title: string;
  body: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <View>
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{body}</Text>
      <View style={styles.comingCard}>
        <Text style={styles.comingMark}>V</Text>
        <Text style={styles.comingTitle}>Under construction</Text>
        <Text style={styles.comingText}>
          The current dashboard remains operational while this surface earns parity.
        </Text>
        <Button title={action} onPress={onAction} />
      </View>
    </View>
  );
}

function Button({
  title,
  onPress,
  secondary = false,
}: {
  title: string;
  onPress: () => void;
  secondary?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.buttonSecondary,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.buttonText, secondary && styles.buttonTextSecondary]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#080a09" },
  loading: { flex: 1, backgroundColor: "#080a09", alignItems: "center", justifyContent: "center" },
  shell: { flex: 1, backgroundColor: "#080a09" },
  shellDesktop: { flexDirection: "row" },
  content: { flexGrow: 1, padding: 22, paddingBottom: 116 },
  chatContent: { flex: 1 },
  contentDesktop: { padding: 48, paddingBottom: 48 },
  page: { width: "100%", maxWidth: 860, alignSelf: "center" },
  chatPage: { flex: 1 },
  sidebar: {
    width: 240,
    padding: 24,
    backgroundColor: "#0d100e",
    borderRightWidth: 1,
    borderRightColor: "#202421",
  },
  brand: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 42 },
  brandMark: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#b7f34a",
    alignItems: "center",
    justifyContent: "center",
  },
  brandMarkText: { color: "#11150d", fontWeight: "900", fontSize: 21 },
  brandName: { color: "#f5f7f4", fontSize: 18, fontWeight: "800" },
  brandCaption: {
    color: "#6f776f",
    fontSize: 10,
    marginTop: 2,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  navList: { gap: 7, flex: 1 },
  navItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    paddingVertical: 12,
    paddingHorizontal: 13,
    borderRadius: 11,
  },
  navItemActive: { backgroundColor: "#1a2117" },
  navIcon: { color: "#767d76", fontSize: 17, width: 22, textAlign: "center", fontWeight: "700" },
  navLabel: { color: "#949b94", fontWeight: "600", fontSize: 14 },
  activeText: { color: "#c5fb64" },
  sidebarFooter: { color: "#485048", fontSize: 9, letterSpacing: 1.2 },
  tabBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#0d100ef2",
    borderTopWidth: 1,
    borderTopColor: "#242824",
    paddingBottom: Platform.OS === "ios" ? 24 : 10,
    paddingTop: 8,
    zIndex: 10,
  },
  tabList: { flexDirection: "row", justifyContent: "space-around" },
  tabItem: { minWidth: 78, alignItems: "center", gap: 3, paddingVertical: 6, borderRadius: 10 },
  tabItemActive: { backgroundColor: "#171c15" },
  tabLabel: { color: "#737a73", fontSize: 10, fontWeight: "700" },
  pressed: { opacity: 0.68 },
  eyebrow: {
    color: "#a9e83a",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 2.1,
    marginTop: 10,
    marginBottom: 15,
  },
  title: {
    color: "#f0f2ef",
    fontSize: 42,
    lineHeight: 47,
    fontWeight: "800",
    letterSpacing: -1.8,
    maxWidth: 680,
  },
  subtitle: { color: "#899189", fontSize: 16, lineHeight: 25, marginTop: 18, maxWidth: 650 },
  card: {
    marginTop: 38,
    padding: 22,
    backgroundColor: "#111411",
    borderWidth: 1,
    borderColor: "#282d28",
    borderRadius: 20,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 16,
  },
  cardLabel: { color: "#687068", fontSize: 10, letterSpacing: 1.5, fontWeight: "800" },
  cardTitle: { color: "#e9ece8", fontSize: 21, fontWeight: "700", marginTop: 5 },
  statusPill: {
    minWidth: 86,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 18,
    flexDirection: "row",
    gap: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  statusOnline: { backgroundColor: "#162413" },
  statusNeutral: { backgroundColor: "#202320" },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  dotOnline: { backgroundColor: "#a9e83a" },
  dotOffline: { backgroundColor: "#ef6a62" },
  statusText: { color: "#b7bcb7", fontSize: 12, fontWeight: "700" },
  statusTextOnline: { color: "#c4f56b" },
  rule: { height: 1, backgroundColor: "#252925", marginVertical: 20 },
  endpointLabel: { color: "#626962", fontSize: 9, letterSpacing: 1.4, fontWeight: "800" },
  endpoint: {
    color: "#b9c0b9",
    fontSize: 13,
    marginTop: 7,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
  },
  checkedText: { color: "#5e655e", fontSize: 11, marginTop: 10 },
  errorText: { color: "#ef827b", fontSize: 12, marginTop: 10 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 22 },
  button: {
    backgroundColor: "#b7f34a",
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: 11,
    justifyContent: "center",
    alignItems: "center",
  },
  buttonSecondary: { backgroundColor: "#202420", borderWidth: 1, borderColor: "#303630" },
  buttonText: { color: "#11150d", fontWeight: "800", fontSize: 13 },
  buttonTextSecondary: { color: "#d3d8d2" },
  smallCard: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: "#202520",
    borderRadius: 16,
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  smallCardNumber: { color: "#a9e83a", fontSize: 12, fontWeight: "800", letterSpacing: 1 },
  smallCardBody: { flex: 1 },
  smallCardTitle: { color: "#dce0dc", fontSize: 15, fontWeight: "700" },
  smallCardText: { color: "#737b73", fontSize: 12, lineHeight: 18, marginTop: 4 },
  comingCard: {
    marginTop: 40,
    padding: 28,
    minHeight: 280,
    borderRadius: 20,
    backgroundColor: "#111411",
    borderWidth: 1,
    borderColor: "#282d28",
    alignItems: "flex-start",
    justifyContent: "center",
  },
  comingMark: { color: "#b7f34a", fontSize: 36, fontWeight: "900", marginBottom: 22 },
  comingTitle: { color: "#eef1ed", fontSize: 22, fontWeight: "800" },
  comingText: {
    color: "#7f877f",
    fontSize: 14,
    lineHeight: 21,
    marginTop: 9,
    marginBottom: 24,
    maxWidth: 500,
  },
});
