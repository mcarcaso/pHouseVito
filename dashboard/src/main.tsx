import React from "react";
import ReactDOM from "react-dom/client";
import { VitoClientProvider, createVitoQueryClient } from "@vito/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

const queryClient = createVitoQueryClient();
const routerBaseName =
  import.meta.env.BASE_URL === "/" ? undefined : import.meta.env.BASE_URL.replace(/\/$/, "");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <VitoClientProvider options={{}} queryClient={queryClient}>
      <BrowserRouter basename={routerBaseName}>
        <App />
      </BrowserRouter>
    </VitoClientProvider>
  </React.StrictMode>,
);
