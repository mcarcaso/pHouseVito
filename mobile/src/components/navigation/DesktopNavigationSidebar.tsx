import { Ionicons } from "@expo/vector-icons";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { operationMeta } from "../../application/navigation/config";
import { useAgentName } from "../../contexts/agentIdentity";
import { useThemeStyles, type VitoTheme } from "../../hooks/useVitoTheme";
import { operationAreas, type OperationArea } from "../../screens/operations/operation-catalog";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

export type DesktopDestination =
  | { type: "main"; route: "Home" | "Chat" }
  | { type: "identity" }
  | { type: "memory" }
  | { type: "operation"; area: OperationArea }
  | { type: "settings"; route: "SpeechSettings" | "VoiceModeSettings" | "AppThemeSettings" };

const primaryItems: Array<{
  label: string;
  icon: IconName;
  destination: DesktopDestination;
}> = [
  { label: "Home", icon: "home-outline", destination: { type: "main", route: "Home" } },
  { label: "Chat", icon: "chatbubble-outline", destination: { type: "main", route: "Chat" } },
];

const appSettings: Array<{
  label: string;
  icon: IconName;
  destination: DesktopDestination;
}> = [
  {
    label: "Speech",
    icon: "volume-high-outline",
    destination: { type: "settings", route: "SpeechSettings" },
  },
  {
    label: "Voice Mode",
    icon: "options-outline",
    destination: { type: "settings", route: "VoiceModeSettings" },
  },
  {
    label: "Theme",
    icon: "color-palette-outline",
    destination: { type: "settings", route: "AppThemeSettings" },
  },
];

function destinationKey(destination: DesktopDestination): string {
  if (destination.type === "main" || destination.type === "settings") return destination.route;
  if (destination.type === "operation") return `operation:${destination.area}`;
  return destination.type;
}

export function DesktopNavigationSidebar({
  activeRoute,
  activeOperationArea,
  onSelect,
  onLogout,
}: {
  activeRoute: string;
  activeOperationArea?: OperationArea;
  onSelect: (destination: DesktopDestination) => void;
  onLogout: () => void;
}) {
  const styles = useThemeStyles(createStyles);
  const agentName = useAgentName();
  const activeKey =
    activeRoute === "ChatConversation" || activeRoute === "VoiceConversation"
      ? "Chat"
      : activeRoute === "VoiceHistory" || activeRoute === "VoiceHistoryDetail"
        ? "VoiceModeSettings"
        : activeRoute === "Operation" && activeOperationArea
          ? `operation:${activeOperationArea}`
          : activeRoute === "MemoryHome" || activeRoute === "MemoryResults"
            ? "memory"
            : activeRoute === "IdentityHome" || activeRoute === "IdentityDocument"
              ? "identity"
              : activeRoute;

  const renderItem = (label: string, icon: IconName, destination: DesktopDestination) => {
    const selected = activeKey === destinationKey(destination);
    return (
      <Pressable
        key={destinationKey(destination)}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        onPress={() => onSelect(destination)}
        style={[styles.item, selected && styles.selectedItem]}
      >
        <Ionicons name={icon} size={18} style={[styles.icon, selected && styles.selectedText]} />
        <Text numberOfLines={1} style={[styles.label, selected && styles.selectedText]}>
          {label}
        </Text>
      </Pressable>
    );
  };

  return (
    <View style={styles.sidebar}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.primary}>
          {primaryItems.map((item) => renderItem(item.label, item.icon, item.destination))}
        </View>
        <Text style={styles.sectionLabel}>App Settings</Text>
        {appSettings.map((item) => renderItem(item.label, item.icon, item.destination))}
        {(["Intelligence", "Automation", "Operations", "Agent"] as const).map((group) => (
          <View key={group} style={styles.section}>
            <Text style={styles.sectionLabel}>{group === "Agent" ? agentName : group}</Text>
            {group === "Agent" &&
              renderItem("Identity", "finger-print-outline", { type: "identity" })}
            {operationAreas
              .filter(
                (item) =>
                  item.id !== "profile" &&
                  item.id !== "system" &&
                  item.id !== "theme" &&
                  operationMeta[item.id].group === group,
              )
              .map((item) =>
                renderItem(
                  item.label,
                  operationMeta[item.id].icon,
                  item.id === "memory" ? { type: "memory" } : { type: "operation", area: item.id },
                ),
              )}
          </View>
        ))}
      </ScrollView>
      <Pressable onPress={onLogout} style={styles.signOut}>
        <Ionicons name="log-out-outline" size={18} style={styles.icon} />
        <Text style={styles.label}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const createStyles = (theme: VitoTheme) =>
  StyleSheet.create({
    sidebar: {
      width: 224,
      flexShrink: 0,
      backgroundColor: theme.colors.sidebar,
      borderRightWidth: StyleSheet.hairlineWidth,
      borderRightColor: theme.colors.separatorStrong,
    },
    content: { padding: theme.space.md, paddingBottom: theme.space.xl },
    primary: {
      paddingBottom: theme.space.md,
      marginBottom: theme.space.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.separator,
    },
    section: { marginTop: theme.space.md },
    sectionLabel: {
      color: theme.colors.textMuted,
      fontSize: 11,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.7,
      paddingHorizontal: theme.space.sm,
      marginTop: theme.space.md,
      marginBottom: theme.space.xs,
    },
    item: {
      minHeight: 40,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.sm,
      paddingHorizontal: theme.space.sm,
      borderRadius: theme.space.sm,
    },
    selectedItem: { backgroundColor: theme.colors.accentSurface },
    icon: { width: 20, color: theme.colors.textMuted, textAlign: "center" },
    label: { flex: 1, color: theme.colors.text, fontSize: 14, fontWeight: "600" },
    selectedText: { color: theme.colors.accent },
    signOut: {
      minHeight: 48,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.sm,
      paddingHorizontal: theme.space.xl,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.separator,
    },
  });
