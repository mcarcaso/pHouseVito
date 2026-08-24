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
import { ChatScreen, DEFAULT_SESSION } from "../../screens/chat/ChatScreen";
import {
  IdentityDocumentScreen,
  IdentityHome,
  identityDocumentTitle,
} from "../../screens/identity/IdentityScreen";
import { LoginScreen } from "../../screens/auth/LoginScreen";
import { OperationWorkspace } from "../../screens/operations/OperationWorkspace";
import { OperationItemDetailScreen } from "../../screens/operations/OperationItemDetailScreen";
import { SkillsScreen } from "../../screens/skills/SkillsScreen";
import { SettingsScreen } from "../../screens/settings/SettingsScreen";
import { ThemeScreen } from "../../screens/theme/ThemeScreen";
import { JobEditorScreen, JobsScreen } from "../../screens/jobs/JobsScreen";
import {
  DesktopSecretsScreen,
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
import { createAppStyles } from "../styles";
import { operationMeta } from "./config";
import { WebStackHeader } from "../../components/navigation/WebStackHeader";
import { AdaptiveTabBar } from "../../components/navigation/AdaptiveTabBar";
import { GlobalVoiceOverlay } from "../../components/voice/GlobalVoiceOverlay";
import { DESKTOP_BREAKPOINT, useThemeStyles, useVitoTheme } from "../../hooks/useVitoTheme";

import type {
  ChatStackParamList,
  IdentityStackParamList,
  MainRouteName,
  MainTabParamList,
  MoreStackParamList,
  RootStackParamList,
} from "./route-types";

type RootNavigation = NativeStackNavigationProp<RootStackParamList>;
const MoreStack = createNativeStackNavigator<MoreStackParamList>();
const IdentityStack = createNativeStackNavigator<IdentityStackParamList>();

export function RootMemoryScreen({ navigation }: { navigation: RootNavigation }) {
  const styles = useThemeStyles(createAppStyles);
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
      <OperationWorkspace
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
    <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 16 }}>
      <OperationWorkspace
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

export function TraceDetailScreen({
  route,
  navigation,
}: {
  route: { params: { id: string } };
  navigation: RootNavigation;
}) {
  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 16 }}>
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
}: {
  route: { params: { area: "apps" | "providers"; id: string } };
}) {
  return <OperationItemDetailScreen area={route.params.area} id={route.params.id} />;
}

export function PiSessionDetailScreen({
  route,
  navigation,
}: {
  route: { params: { id: string; raw?: boolean } };
  navigation: RootNavigation;
}) {
  const styles = useThemeStyles(createAppStyles);
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
  const styles = useThemeStyles(createAppStyles);
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

export function IdentityNavigator({ desktop }: { desktop: boolean }) {
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

export function MoreStackScreen({ desktop, onLogout }: { desktop: boolean; onLogout: () => void }) {
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

export function MemoryResultsScreen({
  route,
  navigation,
}: {
  route: { params: { query: string; mode: "hybrid" | "embedding" | "bm25"; limit: number } };
  navigation: RootNavigation;
}) {
  const styles = useThemeStyles(createAppStyles);
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

export function TabSafeArea({
  desktop,
  children,
}: {
  desktop: boolean;
  children: React.ReactNode;
}) {
  const styles = useThemeStyles(createAppStyles);
  return (
    <ContextSafeAreaView edges={desktop ? [] : ["top"]} style={styles.tabSafeArea}>
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
  const styles = useThemeStyles(createAppStyles);
  return (
    <ScrollView contentContainerStyle={[styles.screenFrame, desktop && styles.screenFrameDesktop]}>
      <View style={styles.screenPage}>{children}</View>
    </ScrollView>
  );
}
export function MoreMenu({ onLogout }: { onLogout: () => void }) {
  const styles = useThemeStyles(createAppStyles);
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
