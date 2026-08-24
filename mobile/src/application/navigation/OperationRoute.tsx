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

export function OperationRoute({
  area,
  desktop,
  onUnauthorized,
}: {
  area: OperationArea;
  desktop: boolean;
  onUnauthorized: () => void;
}) {
  const styles = useThemeStyles(createAppStyles);
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
          <OperationWorkspace
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
