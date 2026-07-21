import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { ApiClientProvider } from "./lib/ApiClientProvider";
import { DownloadsProvider } from "./lib/DownloadsProvider";
import { HomeViewProvider } from "./lib/homeView";
import { LanguageProvider } from "./lib/i18n/LanguageProvider";
import { ThemeProvider } from "./lib/theme";
import { ToastProvider } from "./lib/toast";
import "./styles/global.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("#root element not found -- check index.html");
}

if (navigator.userAgent.includes("PlayarrAndroidTV/")) {
  document.documentElement.dataset.platform = "android-tv";
} else if (navigator.userAgent.includes("PlayarrAndroidMobile/")) {
  document.documentElement.dataset.platform = "android-mobile";
}

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <LanguageProvider>
        <ThemeProvider>
          <HomeViewProvider>
            <ApiClientProvider>
              <ToastProvider>
                <DownloadsProvider>
                  <App />
                </DownloadsProvider>
              </ToastProvider>
            </ApiClientProvider>
          </HomeViewProvider>
        </ThemeProvider>
      </LanguageProvider>
    </BrowserRouter>
  </StrictMode>
);
