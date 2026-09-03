import { Ionicons } from "@expo/vector-icons";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { labels } from "../../application/navigation/config";
import type { MainRouteName } from "../../application/navigation/route-types";
import { useThemeStyles, type VitoTheme } from "../../hooks/useVitoTheme";

export const visibleWorkspaceRoutes: MainRouteName[] = ["Home", "Chat", "More"];

export function WorkspaceTabBar({
  active,
  onSelect,
}: {
  active: MainRouteName;
  onSelect: (route: MainRouteName) => void;
}) {
  const styles = useThemeStyles(createStyles);
  return (
    <View style={styles.tabBar}>
      <View style={styles.tabList}>
        {visibleWorkspaceRoutes.map((route) => {
          const item = labels[route];
          const selected = active === route;
          return (
            <Pressable key={route} onPress={() => onSelect(route)} style={styles.tabItem}>
              <Ionicons
                name={item.icon}
                size={20}
                style={[styles.tabIcon, selected && styles.activeText]}
              />
              <Text style={[styles.tabLabel, selected && styles.activeText]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function MobileTabBar({ state, navigation }: BottomTabBarProps) {
  const current = state.routeNames[state.index] as MainRouteName;
  return <WorkspaceTabBar active={current} onSelect={(route) => navigation.navigate(route)} />;
}

const createStyles = (theme: VitoTheme) =>
  StyleSheet.create({
    tabBar: {
      backgroundColor: theme.colors.sidebar,
      borderTopWidth: 1,
      borderTopColor: theme.colors.separator,
      paddingBottom: Platform.OS === "ios" ? 20 : 8,
      paddingTop: theme.space.sm,
    },
    tabList: { flexDirection: "row", justifyContent: "space-around" },
    tabItem: {
      minWidth: 78,
      alignItems: "center",
      gap: theme.space.xs,
      paddingVertical: theme.space.xs,
    },
    tabIcon: { color: theme.colors.textMuted, height: 22 },
    activeText: { color: theme.colors.accent },
    tabLabel: { color: theme.colors.textMuted, fontSize: 10, fontWeight: "700" },
  });
