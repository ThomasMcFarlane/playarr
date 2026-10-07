import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, HashRouter, Route, Routes } from "react-router-dom";
import { App } from "./App";
import { ApiClientProvider } from "./lib/ApiClientProvider";
import { DownloadsProvider } from "./lib/DownloadsProvider";
import { HomeViewProvider } from "./lib/homeView";
import { LanguageProvider } from "./lib/i18n/LanguageProvider";
import { LiveEventsRoot } from "./lib/liveEvents/LiveEventsRoot";
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
import {
  AcceptableUsePage,
  AccountDeletionPage,
  LicencesPage,
  PrivacyPolicyPage,
  TermsPage,
} from "./pages/Legal";
import "./styles/fonts.css";
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
const isPublicLegalRoute =
  !IS_PACKAGED_TV && /^\/legal\/(privacy|terms|acceptable-use|licences|account-deletion)\/?$/.test(
    window.location.pathname
  );

createRoot(container).render(
  <StrictMode>
    <Router basename={IS_PACKAGED_TV ? undefined : import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <LanguageProvider>
        <ThemeProvider>
          {isPublicLegalRoute ? (
            <Routes>
              <Route path="/legal/privacy" element={<PrivacyPolicyPage />} />
              <Route path="/legal/terms" element={<TermsPage />} />
              <Route path="/legal/acceptable-use" element={<AcceptableUsePage />} />
              <Route path="/legal/licences" element={<LicencesPage />} />
              <Route path="/legal/account-deletion" element={<AccountDeletionPage />} />
            </Routes>
          ) : (
            <HomeViewProvider>
              <ApiClientProvider>
                <ToastProvider>
                  <LiveEventsRoot>
                    <DownloadsProvider>
                      <App />
                    </DownloadsProvider>
                  </LiveEventsRoot>
                </ToastProvider>
              </ApiClientProvider>
            </HomeViewProvider>
          )}
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
