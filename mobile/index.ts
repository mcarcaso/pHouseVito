import { registerRootComponent } from "expo";
import { createElement, useEffect, useState } from "react";
import { VitoClientProvider } from "@vito/client";
import App from "./App";
import { subscribeAgentUrl, VITO_URL, vitoTokenStore } from "./src/api";

function Root() {
  const [baseUrl, setBaseUrl] = useState(VITO_URL);
  useEffect(() => subscribeAgentUrl(setBaseUrl), []);
  return createElement(
    VitoClientProvider,
    { key: baseUrl, options: { baseUrl, tokenStore: vitoTokenStore } },
    createElement(App),
  );
}

registerRootComponent(Root);
