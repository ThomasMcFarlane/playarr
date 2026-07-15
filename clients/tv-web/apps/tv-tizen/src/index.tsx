import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { SpatialNavProvider, PlayerScreen } from "@streamarr-tv/ui-tv";
import { TizenAvplayEngine } from "@streamarr-tv/player-avplay";

/**
 * Tizen app entry point. Tizen TVs play video through the native
 * `webapis.avplay` API rather than a `<video>` element -- there is no MSE
 * pipeline to attach to, so unlike the webOS/VIDAA shells this component
 * renders no video element at all; `TizenAvplayEngine` draws to a native
 * plane positioned with `setDisplayRect`.
 *
 * This is a minimal bootstrap: a real build would route between Browse /
 * Detail / Player via the app's own router rather than mounting the
 * player screen directly.
 */
function App() {
  const [engine] = useState(() => new TizenAvplayEngine());

  return (
    <SpatialNavProvider>
      <PlayerScreen engine={engine} title="Streamarr" />
    </SpatialNavProvider>
  );
}

const container = document.getElementById("root");
if (!container) {
  throw new Error("#root element not found -- check index.html");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
