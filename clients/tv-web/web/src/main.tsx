import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { ApiClientProvider } from "./lib/ApiClientProvider";
import { ThemeProvider } from "./lib/theme";
import "./styles/global.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("#root element not found -- check index.html");
}

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <ApiClientProvider>
          <App />
        </ApiClientProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>
);
