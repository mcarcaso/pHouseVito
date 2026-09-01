import type { VitoTheme } from "../../hooks/useVitoTheme";
import { StyleSheet } from "react-native";
import { operationAreas, type OperationArea } from "../../screens/operations/operation-catalog";
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
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
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
import { ChatScreen, DEFAULT_SESSION } from "../../screens/chat/ChatScreen";
import {
  IdentityDocumentScreen,
  IdentityHome,
  identityDocumentTitle,
  type IdentityDocument,
} from "../../screens/identity/IdentityScreen";
import { LoginScreen } from "../../screens/auth/LoginScreen";
import { MemoryAdvancedSheet } from "../../screens/memory/MemoryAdvancedSheet";
import { MemoryScreen, type MemoryPage } from "../../screens/memory/MemoryScreen";
import { OperationWorkspace } from "../../screens/operations/OperationWorkspace";
import { AppDetailScreen, AppsScreen } from "../../screens/apps/AppsScreen";
import { ProviderModelsScreen, ProvidersScreen } from "../../screens/providers/ProvidersScreen";
import { SkillsScreen } from "../../screens/skills/SkillsScreen";
import { SettingsScreen } from "../../screens/settings/SettingsScreen";
import { ThemeScreen } from "../../screens/theme/ThemeScreen";
import { JobEditorScreen, JobsScreen } from "../../screens/jobs/JobsScreen";
import { DriveScreen } from "../../screens/drive/DriveScreen";
import {
  SecretEditorScreen,
  SecretsScreen,
  type Secret,
} from "../../screens/secrets/SecretsScreen";
import {
  SkillDocumentScreen,
  SkillFilesScreen,
  SkillFileScreen,
} from "../../screens/skills/SkillMobileScreens";
import { VoiceScreen, type VoiceOverlayStatus } from "../../screens/voice/VoiceScreen";
import {
  VoiceHistoryDetailScreen,
  VoiceHistoryScreen,
} from "../../screens/voice/VoiceHistoryScreen";
import {
  api,
  checkAuth,
  loadAgentUrl,
  loadToken,
  logout,
  saveToken,
} from "../../services/api/client";
import { AppProviders } from "../../providers/AppProviders";
import { operationMeta } from "./config";
import { WebStackHeader } from "../../components/navigation/WebStackHeader";
import { GlobalVoiceOverlay } from "../../components/voice/GlobalVoiceOverlay";
import { useAgentName } from "../../contexts/agentIdentity";
import { DESKTOP_BREAKPOINT, useThemeStyles, useVitoTheme } from "../../hooks/useVitoTheme";

import type { MainRouteName, MainTabParamList, RootStackParamList } from "./route-types";

type RootNavigation = NativeStackNavigationProp<RootStackParamList>;

export function RootMemoryScreen({ navigation }: { navigation: RootNavigation }) {
  const theme = useVitoTheme();
  const [advanced, setAdvanced] = useState(false);
  const [memoryPage, setMemoryPage] = useState<MemoryPage>("answer");
  const onUnauthorized = useCallback(
    () => navigation.navigate("Main", { screen: "More" }),
    [navigation],
  );

  useLayoutEffect(() => {
    const advancedButton = (
      <Pressable
        accessibilityLabel="Advanced memory settings"
        onPress={() => setAdvanced(true)}
        hitSlop={10}
      >
        <Ionicons name="ellipsis-horizontal-circle-outline" size={24} color={theme.colors.accent} />
      </Pressable>
    );
    navigation.setOptions({
      headerRight: memoryPage === "facts" ? () => advancedButton : undefined,
      header:
        Platform.OS === "web"
          ? () => (
              <WebStackHeader
                onBack={navigation.canGoBack() ? () => navigation.goBack() : undefined}
                right={memoryPage === "facts" ? advancedButton : undefined}
              />
            )
          : undefined,
    });
  }, [memoryPage, navigation, theme]);

  return (
    <>
      <MemoryScreen onUnauthorized={onUnauthorized} onPageChange={setMemoryPage} />
      <MemoryAdvancedSheet
        visible={advanced}
        onClose={() => setAdvanced(false)}
        onUnauthorized={onUnauthorized}
        onOpenPiSession={(id) => {
          setAdvanced(false);
          navigation.navigate("PiSessionDetail", { id });
        }}
      />
    </>
  );
}

export function JobDetailRoute({
  route,
  navigation,
}: {
  route: { params: { name?: string } };
  navigation: RootNavigation;
}) {
  return <JobEditorScreen name={route.params.name} onDone={() => navigation.goBack()} />;
}

export function DriveDirectoryScreen({
  route,
  navigation,
}: {
  route: { params: { path: string } };
  navigation: RootNavigation;
}) {
  return (
    <DriveScreen
      path={route.params.path}
      onOpenDirectory={(path) => navigation.push("DriveDirectory", { path })}
      onUnauthorized={() => navigation.navigate("Main", { screen: "More" })}
    />
  );
}

export function TraceDetailScreen({
  route,
  navigation,
}: {
  route: { params: { id: string } };
  navigation: RootNavigation;
}) {
  const styles = useThemeStyles(createStyles);
  return (
    <ScrollView contentContainerStyle={styles.fullScreenOperation}>
      <OperationWorkspace
        initialArea="traces"
        initialDetail={{ area: "traces", id: route.params.id }}
        showAreaTabs={false}
        hideScreenTitle
        onUnauthorized={() => navigation.navigate("Main", { screen: "More" })}
      />
    </ScrollView>
  );
}

export function RootOperationItemDetailScreen({
  route,
  navigation,
}: {
  route: { params: { area: "apps" | "providers"; id: string } };
  navigation: RootNavigation;
}) {
  if (route.params.area === "apps") {
    return <AppDetailScreen name={route.params.id} onDeleted={() => navigation.goBack()} />;
  }
  return <ProviderModelsScreen id={route.params.id} />;
}

export function PiSessionDetailScreen({
  route,
  navigation,
}: {
  route: { params: { id: string; raw?: boolean } };
  navigation: RootNavigation;
}) {
  const styles = useThemeStyles(createStyles);
  return (
    <ScrollView contentContainerStyle={styles.fullScreenOperation}>
      <OperationWorkspace
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

export function RootOperationScreen({
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
  if (area === "drive") {
    return (
      <DriveScreen
        onOpenDirectory={(path) => navigation.push("DriveDirectory", { path })}
        onUnauthorized={() => navigation.navigate("Main", { screen: "More" })}
      />
    );
  }
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
  if (area === "providers") {
    return (
      <ProvidersScreen
        refreshKey={route.params.refreshKey}
        onUnauthorized={() => navigation.navigate("Main", { screen: "More" })}
        onOpen={(id) => navigation.navigate("OperationItemDetail", { area: "providers", id })}
      />
    );
  }
  if (area === "apps") {
    return (
      <AppsScreen
        refreshKey={route.params.refreshKey}
        onUnauthorized={() => navigation.navigate("Main", { screen: "More" })}
        onOpen={(id) => navigation.navigate("OperationItemDetail", { area: "apps", id })}
      />
    );
  }
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
        <OperationWorkspace
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
          onOpenItem={undefined}
          hideMemorySearch={area === "memory"}
          onMemorySearch={area === "memory" ? openResults : undefined}
        />
      </ScrollView>
    </View>
  );
}

export function MemoryResultsScreen({
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
      <OperationWorkspace
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

export function RootVoiceHistoryScreen({ navigation }: { navigation: RootNavigation }) {
  return <VoiceHistoryScreen onOpen={(id) => navigation.navigate("VoiceHistoryDetail", { id })} />;
}

export function RootVoiceHistoryDetailScreen({ route }: { route: { params: { id: string } } }) {
  return <VoiceHistoryDetailScreen id={route.params.id} />;
}

export function RootSecretDetailScreen({
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

export function RootSecretNewScreen({ navigation }: { navigation: RootNavigation }) {
  return <SecretEditorScreen onSaved={() => navigation.goBack()} />;
}

export function RootSkillDetailScreen({
  route,
}: {
  route: { params: { name: string; description?: string } };
}) {
  return <SkillDocumentScreen name={route.params.name} description={route.params.description} />;
}

export function RootSkillFilesScreen({
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

export function RootSkillFileScreen({
  route,
}: {
  route: { params: { name: string; fileName: string } };
}) {
  return <SkillFileScreen name={route.params.name} fileName={route.params.fileName} />;
}

export function TabSafeArea({ children }: { children: React.ReactNode }) {
  const styles = useThemeStyles(createStyles);
  return (
    <ContextSafeAreaView edges={["top"]} style={styles.tabSafeArea}>
      {children}
    </ContextSafeAreaView>
  );
}

export function ScreenFrame({
  desktop,
  children,
}: {
  desktop: boolean;
  children: React.ReactNode;
}) {
  const styles = useThemeStyles(createStyles);
  return (
    <ScrollView contentContainerStyle={[styles.screenFrame, desktop && styles.screenFrameDesktop]}>
      <View style={styles.screenPage}>{children}</View>
    </ScrollView>
  );
}
export function MoreMenu({ onLogout }: { onLogout: () => void }) {
  const styles = useThemeStyles(createStyles);
  const agentName = useAgentName();
  const navigation = useNavigation<RootNavigation>();
  const { width } = useWindowDimensions();
  const desktop = Platform.OS === "web" && width >= DESKTOP_BREAKPOINT;
  const openWorkspace = (
    route:
      | { name: "IdentityHome" }
      | { name: "MemoryHome" }
      | { name: "Operation"; params: { area: OperationArea } },
  ) => {
    if (desktop) {
      navigation.reset({ index: 0, routes: [route] });
      return;
    }
    if (route.name === "Operation") navigation.navigate(route.name, route.params);
    else navigation.navigate(route.name);
  };
  return (
    <ScrollView contentContainerStyle={styles.moreScreen}>
      <View style={styles.moreSection}>
        <Text style={styles.moreSectionLabel}>App Settings</Text>
        {[
          {
            route: "SpeechSettings" as const,
            icon: "volume-high-outline" as const,
            title: "Speech",
            description: "Chat message playback, voice, and speed",
          },
          {
            route: "VoiceModeSettings" as const,
            icon: "mic-outline" as const,
            title: "Voice Mode",
            description: "Live conversation provider, model, and voice",
          },
          {
            route: "AppThemeSettings" as const,
            icon: "color-palette-outline" as const,
            title: "Theme",
            description: "Color scheme for this device",
          },
        ].map((item) => (
          <Pressable
            key={item.route}
            onPress={() => navigation.navigate(item.route)}
            style={styles.moreRow}
          >
            <Ionicons name={item.icon} size={18} style={styles.moreIcon} />
            <View style={styles.moreRowText}>
              <Text style={styles.moreTitle}>{item.title}</Text>
              <Text style={styles.moreDescription}>{item.description}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} style={styles.moreChevron} />
          </Pressable>
        ))}
      </View>
      {(["Intelligence", "Automation", "Operations", "Agent"] as const).map((group) => (
        <View key={group} style={styles.moreSection}>
          <Text style={styles.moreSectionLabel}>{group === "Agent" ? agentName : group}</Text>
          {group === "Agent" && (
            <>
              <Pressable
                onPress={() => openWorkspace({ name: "IdentityHome" })}
                style={styles.moreRow}
              >
                <Ionicons name="finger-print-outline" size={18} style={styles.moreIcon} />
                <View style={styles.moreRowText}>
                  <Text style={styles.moreTitle}>Identity</Text>
                  <Text style={styles.moreDescription}>Profile, soul, and instructions</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} style={styles.moreChevron} />
              </Pressable>
            </>
          )}
          {operationAreas
            .filter(
              (item) =>
                item.id !== "profile" &&
                item.id !== "system" &&
                item.id !== "theme" &&
                operationMeta[item.id].group === group,
            )
            .map((item) => {
              const meta = operationMeta[item.id];
              return (
                <Pressable
                  key={item.id}
                  onPress={() =>
                    item.id === "memory"
                      ? openWorkspace({ name: "MemoryHome" })
                      : openWorkspace({ name: "Operation", params: { area: item.id } })
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
    fullScreenOperation: { flexGrow: 1, padding: theme.space.xl, paddingBottom: theme.space.xl },
    rootOperation: { flex: 1, backgroundColor: theme.colors.canvas },
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
    tabSafeArea: { flex: 1, backgroundColor: theme.colors.canvas },
    screenFrame: { flexGrow: 1, padding: theme.space.xl, paddingBottom: theme.space.xxxl },
    screenFrameDesktop: { padding: theme.space.xxxl },
    screenPage: { width: "100%", maxWidth: 900, alignSelf: "center" },
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
