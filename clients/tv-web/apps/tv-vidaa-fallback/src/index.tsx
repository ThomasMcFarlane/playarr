import { StrictMode, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { SpatialNavProvider, PlayerScreen } from "@streamarr-tv/ui-tv";
import { ShakaPlaybackEngine } from "@streamarr-tv/player-shaka";
import { vidaaOtaEnabled } from "./featureFlags";

/**
 * VIDAA fallback PWA entry point. Bootstraps the same `ui-tv` + `player-shaka`
 * pairing as the webOS shell (VIDAA's browser is Chromium-based and
 * supports MSE + EME), but is packaged/installed as a PWA rather than a
 * platform-native app -- see `manifest.json` and `featureFlags.ts`.
 *
 * This is a minimal bootstrap: a real build would route between Browse /
 * Detail / Player via the app's own router rather than mounting the
 * player screen directly.
 */
function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [engine] = useState(() => new ShakaPlaybackEngine());

  useMemo(() => {
    if (videoRef.current) {
      engine.attach(videoRef.current);
    }
  }, [engine]);

  return (
    <SpatialNavProvider>
      <video ref={videoRef} style={{ position: "fixed", inset: 0, width: "100%", height: "100%" }} />
      <PlayerScreen engine={engine} title="Streamarr" />
    </SpatialNavProvider>
  );
}

const container = document.getElementById("root");
if (!container) {
  throw new Error("#root element not found -- check index.html");
}

if (vidaaOtaEnabled && "serviceWorker" in navigator) {
  // Service worker registration for the OTA self-update path is
  // intentionally not implemented yet -- the VIDAA fallback is
  // PWA-installable via manifest.json alone until that lands.
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
