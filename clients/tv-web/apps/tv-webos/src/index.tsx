import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { TvApp } from "@streamarr-tv/ui-tv";
import type { PlaybackCapabilities } from "@streamarr-tv/api-client/react";
import { ShakaPlaybackEngine } from "@streamarr-tv/player-shaka";
import { resolveApiBaseUrl } from "@streamarr-tv/domain";

/**
 * webOS ships a modern-enough WebKit/Chromium (webOS 3.x+) to run Shaka
 * Player's MSE + EME pipeline directly, so this shell wires `player-shaka`
 * behind `ui-tv`'s `TvApp` (pairing -> browse -> detail -> player), same as
 * the VIDAA fallback shell. These are a reasonable, documented default
 * capability set for webOS's Chromium-based pipeline -- there is no real
 * device to probe here.
 */
const PLAYBACK_CAPABILITIES: PlaybackCapabilities = {
  containers: "mp4,webm",
  videoCodecs: "h264,h265,vp9",
  audioCodecs: "aac,opus",
};

/** No keyboard on this platform: `?apiBaseUrl=...` (launch query param) or public/streamarr-config.json wins over the default. */
const RUNTIME_CONFIG_URL = `${import.meta.env.BASE_URL}streamarr-config.json`;

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
      clientPlatform="tv-webos"
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

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
