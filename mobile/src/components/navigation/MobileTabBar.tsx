import { Ionicons } from "@expo/vector-icons";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { labels } from "../../application/navigation/config";
import type { MainRouteName } from "../../application/navigation/route-types";
import { useThemeStyles, type VitoTheme } from "../../hooks/useVitoTheme";

const visibleRoutes: MainRouteName[] = ["Home", "Chat", "Voice", "More"];

export function MobileTabBar({ state, navigation }: BottomTabBarProps) {
  const styles = useThemeStyles(createStyles);
  const current = state.routeNames[state.index] as MainRouteName;
  return (
    <View style={styles.tabBar}>
      <View style={styles.tabList}>
        {visibleRoutes.map((route) => {
          const item = labels[route];
          const active = current === route;
          return (
            <Pressable
              key={route}
              onPress={() => navigation.navigate(route)}
              style={styles.tabItem}
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
