import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { getStoredApiBaseUrl } from "@streamarr-tv/domain";
import { App } from "./App";
import { ApiClientProvider } from "./lib/ApiClientProvider";
import { initialPublicHttpPageHandoffUrl } from "./lib/httpServerHandoff";
import { ThemeProvider } from "./lib/theme";
import { ToastProvider } from "./lib/toast";
import "./styles/global.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("#root element not found -- check index.html");
}

const routerBase =
  import.meta.env.BASE_URL === "/" ? undefined : import.meta.env.BASE_URL.replace(/\/$/, "");

if (navigator.userAgent.includes("PlayarrAndroidTV/")) {
  document.documentElement.dataset.platform = "android-tv";
}

const initialHandoffUrl = initialPublicHttpPageHandoffUrl(
  window.location.href,
  getStoredApiBaseUrl()
);

if (initialHandoffUrl) {
  window.location.replace(initialHandoffUrl);
} else {
  createRoot(container).render(
    <StrictMode>
      <BrowserRouter basename={routerBase}>
        <ThemeProvider>
          <ApiClientProvider>
            <ToastProvider>
              <App />
            </ToastProvider>
          </ApiClientProvider>
        </ThemeProvider>
      </BrowserRouter>
    </StrictMode>
  );
}
