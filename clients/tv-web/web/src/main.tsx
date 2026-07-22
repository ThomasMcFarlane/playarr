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
import "./styles/global.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("#root element not found -- check index.html");
}

document.documentElement.dataset.platform = PLAYARR_CLIENT_PLATFORM;

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
