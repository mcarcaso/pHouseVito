import { registerRootComponent } from "expo";
import { VitoClientProvider } from "@vito/client";
import App from "./App";
import { VITO_URL, vitoTokenStore } from "./src/api";

function Root() {
  return (
    <VitoClientProvider options={{ baseUrl: VITO_URL, tokenStore: vitoTokenStore }}>
      <App />
    </VitoClientProvider>
  );
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(Root);
