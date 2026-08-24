import { Ionicons } from "@expo/vector-icons";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { Pressable, ScrollView, Text, View } from "react-native";
import { areaForRoute, labels, operationMeta } from "../../application/navigation/config";
import type { MainRouteName } from "../../application/navigation/route-types";
import { createAppStyles } from "../../application/styles";
import { useThemeStyles } from "../../hooks/useVitoTheme";

export function AdaptiveTabBar({
  state,
  navigation,
  desktop,
  onLogout,
}: BottomTabBarProps & { desktop: boolean; onLogout: () => void }) {
  const styles = useThemeStyles(createAppStyles);
  const current = state.routeNames[state.index] as MainRouteName;
  const visible = desktop
    ? (state.routeNames as MainRouteName[])
    : (["Chat", "Voice", "More"] as MainRouteName[]);
  const moreActive = current === "More" || current in areaForRoute;
  if (desktop)
    return (
      <View style={styles.sidebar}>
        <View style={styles.brand}>
          <Text style={styles.brandName}>Vito</Text>
          <Text style={styles.brandDot}>.</Text>
        </View>
        <ScrollView contentContainerStyle={styles.desktopNavList}>
          {(["Chat", "Voice", "Identity"] as MainRouteName[]).map((route) => (
            <DesktopNavItem key={route} route={route} current={current} navigation={navigation} />
          ))}
          {(["Intelligence", "Automation", "Operations", "Vito"] as const).map((group) => (
            <View key={group}>
              <Text style={styles.navSection}>{group}</Text>
              {visible
                .filter(
                  (route) =>
                    route !== "More" &&
                    route !== "Chat" &&
                    route !== "Voice" &&
                    route !== "Identity" &&
                    operationMeta[areaForRoute[route]!]?.group === group,
                )
                .map((route) => (
                  <DesktopNavItem
                    key={route}
                    route={route}
                    current={current}
                    navigation={navigation}
                  />
                ))}
            </View>
          ))}
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

function DesktopNavItem({
  route,
  current,
  navigation,
}: {
  route: MainRouteName;
  current: MainRouteName;
  navigation: BottomTabBarProps["navigation"];
}) {
  const styles = useThemeStyles(createAppStyles);
  const item = labels[route];
  const active = current === route;
  return (
    <Pressable onPress={() => navigation.navigate(route)} style={styles.navItem}>
      <Ionicons name={item.icon} size={16} style={[styles.navIcon, active && styles.activeText]} />
      <Text style={[styles.navLabel, active && styles.navLabelActive]}>{item.label}</Text>
      {active && <View style={styles.navActiveDot} />}
    </Pressable>
  );
}
