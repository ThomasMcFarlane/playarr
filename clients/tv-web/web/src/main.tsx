import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router-dom";
import { App } from "./App";
import { ApiClientProvider } from "./lib/ApiClientProvider";
import { DownloadsProvider } from "./lib/DownloadsProvider";
import { HomeViewProvider } from "./lib/homeView";
import { LanguageProvider } from "./lib/i18n/LanguageProvider";
import { ThemeProvider } from "./lib/theme";
import { ToastProvider } from "./lib/toast";
import { IS_PACKAGED_TV, PLAYARR_CLIENT_PLATFORM } from "./lib/clientPlatform";
import {
  bootstrapParityMode,
  installParityApplyHook,
  readParityMode,
  readTvCrossEngine,
} from "./lib/parityMode";
import { installCrossEngineHook } from "./lib/crossEngineAssets";
import "./styles/global.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("#root element not found -- check index.html");
}

document.documentElement.dataset.platform = PLAYARR_CLIENT_PLATFORM;

// Product TV cross-engine assets: identical text/media, live layout (no solidify).
const tvCrossEngine = readTvCrossEngine();
if (tvCrossEngine) {
  document.documentElement.dataset.tvCrossEngine = "1";
  installCrossEngineHook();
}

// Legacy solidify modes only when explicitly requested (not tvCrossEngine).
const parityMode = readParityMode();
if (parityMode !== "off" && !tvCrossEngine) {
  document.documentElement.dataset.parity = parityMode;
  installParityApplyHook();
}

const Router = IS_PACKAGED_TV ? HashRouter : BrowserRouter;

createRoot(container).render(
  <StrictMode>
    <Router>
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
    </Router>
  </StrictMode>
);

// Cross-engine assets are applied by the AE gate after catalogue is ready
// (window.__playarrApplyCrossEngineAssets). Avoid racing partial DOM here.
if (parityMode !== "off" && !tvCrossEngine) {
  const run = () => {
    void bootstrapParityMode(parityMode);
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        setTimeout(run, parityMode === "raster" ? 1200 : 0);
      }),
    );
  }
  window.addEventListener("popstate", () => {
    setTimeout(run, 400);
  });
}
