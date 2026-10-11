import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { TvApp } from "@playarr-tv/ui-tv";
import type { PlaybackCapabilities } from "@playarr-tv/api-client/react";
import { ShakaPlaybackEngine } from "@playarr-tv/player-shaka";
import { resolveApiBaseUrl } from "@playarr-tv/domain";
import { vidaaOtaEnabled } from "./featureFlags";

/**
 * VIDAA fallback PWA entry point. Bootstraps the same `ui-tv` + `player-shaka`
 * pairing as the webOS shell (VIDAA's browser is Chromium-based and
 * supports MSE + EME), but is packaged/installed as a PWA rather than a
 * platform-native app -- see `manifest.json` and `featureFlags.ts`.
 */
// No HEVC claim until fragmented-MP4 HEVC HLS is verified on VIDAA (TASKS 20.260).
const PLAYBACK_CAPABILITIES: PlaybackCapabilities = {
  containers: "mp4,webm",
  videoCodecs: "h264,vp9",
  audioCodecs: "aac,opus",
};

/** No keyboard on this platform: `?apiBaseUrl=...` (launch query param) or public/playarr-config.json wins over the default. */
const RUNTIME_CONFIG_URL = `${import.meta.env.BASE_URL}playarr-config.json`;

function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [engine] = useState(() => new ShakaPlaybackEngine());

  useMemo(() => {
    if (videoRef.current) {
      engine.attach(videoRef.current);
    }
  }, [engine]);

  const [apiBaseUrl, setApiBaseUrl] = useState<string | null>(null);
  useEffect(() => {
    void resolveApiBaseUrl({ configFileUrl: RUNTIME_CONFIG_URL }).then(setApiBaseUrl);
  }, []);

  if (!apiBaseUrl) {
    // Briefly resolving the runtime config file; nothing to render yet.
    return null;
  }

  return (
    <TvApp
      engine={engine}
      apiBaseUrl={apiBaseUrl}
      clientPlatform="tv-vidaa"
      appVersion={__APP_VERSION__}
      playbackCapabilities={PLAYBACK_CAPABILITIES}
      videoSurface={
        <video ref={videoRef} style={{ position: "fixed", inset: 0, width: "100%", height: "100%" }} />
      }
    />
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
