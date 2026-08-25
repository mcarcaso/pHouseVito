import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { api } from "../api/client";

const PROJECT_ID = "fc800553-bd47-452e-8144-1c31566f5d40";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function registerQuickCommandNotifications(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  const current = await Notifications.getPermissionsAsync();
  const permission = current.granted ? current : await Notifications.requestPermissionsAsync();
  if (!permission.granted) return false;
  const token = (await Notifications.getExpoPushTokenAsync({ projectId: PROJECT_ID })).data;
  await api("/api/quick-commands/devices", {
    method: "POST",
    body: JSON.stringify({ token, platform: Platform.OS }),
  });
  return true;
}
