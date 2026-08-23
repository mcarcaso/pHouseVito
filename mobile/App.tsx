import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import { ChatScreen } from "./src/ChatScreen";
import { LoginScreen } from "./src/LoginScreen";
import { operationAreas, OperationsScreen, type OperationArea } from "./src/OperationsScreen";
import { VoiceScreen } from "./src/VoiceScreen";
import { checkAuth, loadToken, logout, saveToken } from "./src/api";
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

type Screen = "chat" | "voice" | "more";

const navigation: Array<{ id: Screen; label: string; icon: string }> = [
  { id: "chat", label: "Chat", icon: "●" },
  { id: "voice", label: "Voice", icon: "◉" },
  { id: "more", label: "More", icon: "•••" },
];

export default function App() {
  const [screen, setScreen] = useState<Screen>("chat");
  const [operationArea, setOperationArea] = useState<OperationArea | null>(null);
  const [authState, setAuthState] = useState<"loading" | "authenticated" | "login">("loading");
  const { width } = useWindowDimensions();
  const desktop = width >= 760;

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
    screen === "chat" ? (
      <ChatScreen onUnauthorized={unauthorized} />
    ) : screen === "voice" ? (
      <VoiceScreen onUnauthorized={unauthorized} />
    ) : desktop ? (
      <View>
        <OperationsScreen onUnauthorized={unauthorized} />
        <Button
          title="Sign out"
          secondary
          onPress={() => void logout().finally(() => setAuthState("login"))}
        />
      </View>
    ) : operationArea ? (
      <OperationsScreen
        key={operationArea}
        onUnauthorized={unauthorized}
        initialArea={operationArea}
        showAreaTabs={false}
        onBack={() => setOperationArea(null)}
      />
    ) : (
      <MoreMenu
        onSelect={setOperationArea}
        onLogout={() => void logout().finally(() => setAuthState("login"))}
      />
    );

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={[styles.shell, desktop && styles.shellDesktop]}>
        {desktop && <Navigation screen={screen} setScreen={setScreen} desktop />}
        {screen === "chat" || screen === "voice" ? (
          <View style={[styles.content, styles.chatContent, desktop && styles.contentDesktop]}>
            <View style={[styles.page, styles.chatPage]}>{content}</View>
          </View>
        ) : (
          <ScrollView contentContainerStyle={[styles.content, desktop && styles.contentDesktop]}>
            <View style={styles.page}>{content}</View>
          </ScrollView>
        )}
        {!desktop && (
          <Navigation
            screen={screen}
            setScreen={(next) => {
              if (next === "more") setOperationArea(null);
              setScreen(next);
            }}
          />
        )}
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

function MoreMenu({
  onSelect,
  onLogout,
}: {
  onSelect: (area: OperationArea) => void;
  onLogout: () => void;
}) {
  return (
    <View>
      <Text style={styles.eyebrow}>MORE</Text>
      <Text style={styles.title}>Operations</Text>
      <Text style={styles.subtitle}>Choose where you want to work.</Text>
      <View style={styles.moreGrid}>
        {operationAreas.map((item) => (
          <Pressable key={item.id} onPress={() => onSelect(item.id)} style={styles.moreCard}>
            <Text style={styles.moreCardTitle}>{item.label}</Text>
            <Text style={styles.moreArrow}>›</Text>
          </Pressable>
        ))}
      </View>
      <Pressable onPress={onLogout} style={styles.logoutButton}>
        <Text style={styles.logoutText}>Sign out</Text>
      </Pressable>
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
  moreGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  moreCard: {
    width: "48%",
    minHeight: 82,
    backgroundColor: "#151914",
    borderWidth: 1,
    borderColor: "#30362d",
    borderRadius: 16,
    padding: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  moreCardTitle: { color: "#f3f5ef", fontWeight: "800", fontSize: 15 },
  moreArrow: { color: "#b7f34a", fontSize: 26 },
  logoutButton: { marginTop: 20, alignItems: "center", padding: 14 },
  logoutText: { color: "#92998f", fontWeight: "700" },
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
