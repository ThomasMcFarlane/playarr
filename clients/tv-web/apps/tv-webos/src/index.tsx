import { StrictMode, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { SpatialNavProvider, PlayerScreen } from "@streamarr-tv/ui-tv";
import { ShakaPlaybackEngine } from "@streamarr-tv/player-shaka";

/**
 * webOS app entry point. webOS ships a modern-enough WebKit/Chromium (webOS
 * 3.x+) to run Shaka Player's MSE + EME pipeline directly, so this shell
 * wires `player-shaka` behind `ui-tv`'s `PlayerScreen`, the same as the
 * VIDAA fallback shell.
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

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
