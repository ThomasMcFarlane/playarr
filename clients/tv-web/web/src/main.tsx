import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { ApiClientProvider } from "./lib/ApiClientProvider";

const container = document.getElementById("root");
if (!container) {
  throw new Error("#root element not found -- check index.html");
}

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <ApiClientProvider>
        <App />
      </ApiClientProvider>
    </BrowserRouter>
  </StrictMode>
);
