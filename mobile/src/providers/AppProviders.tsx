import { VitoClientProvider } from "@vito/client";
import { useEffect, useState, type ReactNode } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { subscribeAgentUrl, VITO_URL, vitoTokenStore } from "../services/api/client";
import { VitoThemeProvider } from "./VitoThemeProvider";

export function AppProviders({ children }: { children: ReactNode }) {
  const [baseUrl, setBaseUrl] = useState(VITO_URL);
  useEffect(() => subscribeAgentUrl(setBaseUrl), []);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <VitoClientProvider key={baseUrl} options={{ baseUrl, tokenStore: vitoTokenStore }}>
          <VitoThemeProvider>{children}</VitoThemeProvider>
        </VitoClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
