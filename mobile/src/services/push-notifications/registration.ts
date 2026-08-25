import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { api } from "../api/client";

const PROJECT_ID = "fc800553-bd47-452e-8144-1c31566f5d40";
const DEVICE_ID_KEY = "phouse-vito-push-device-id";

async function deviceId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (existing) return existing;
  const created = `device_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
  await SecureStore.setItemAsync(DEVICE_ID_KEY, created);
  return created;
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function registerPushNotifications(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  const current = await Notifications.getPermissionsAsync();
  const permission = current.granted ? current : await Notifications.requestPermissionsAsync();
  if (!permission.granted) return false;
  const token = (await Notifications.getExpoPushTokenAsync({ projectId: PROJECT_ID })).data;
  await api("/api/push/devices", {
    method: "POST",
    body: JSON.stringify({
      deviceId: await deviceId(),
      token,
      platform: Platform.OS,
      appId: "phouse-vito-companion",
      showPreview: true,
    }),
  });
  return true;
}
