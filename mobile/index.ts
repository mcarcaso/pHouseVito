import { registerRootComponent } from "expo";
import { createElement } from "react";
import { VitoClientProvider } from "@vito/client";
import App from "./App";
import { VITO_URL, vitoTokenStore } from "./src/api";

function Root() {
  return createElement(
    VitoClientProvider,
    { options: { baseUrl: VITO_URL, tokenStore: vitoTokenStore } },
    createElement(App),
  );
}

registerRootComponent(Root);
