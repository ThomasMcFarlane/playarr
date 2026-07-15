import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { TvApp } from "@streamarr-tv/ui-tv";
import type { PlaybackCapabilities } from "@streamarr-tv/api-client/react";
import { TizenAvplayEngine } from "@streamarr-tv/player-avplay";
import { resolveApiBaseUrl } from "@streamarr-tv/domain";

/**
 * Tizen app entry point. Tizen TVs play video through the native
 * `webapis.avplay` API rather than a `<video>` element -- there is no MSE
 * pipeline to attach to, so unlike the webOS/VIDAA shells this component
 * renders no video element at all (`TvApp`'s `videoSurface` is omitted);
 * `TizenAvplayEngine` draws to a native plane positioned with
 * `setDisplayRect`. These are a reasonable, documented default capability
 * set for Tizen's AVPlay pipeline -- there is no real device to probe here.
 */
const PLAYBACK_CAPABILITIES: PlaybackCapabilities = {
  containers: "mp4,ts",
  videoCodecs: "h264,h265",
  audioCodecs: "aac",
};

/** No keyboard on this platform: `?apiBaseUrl=...` (launch query param) or public/streamarr-config.json wins over the default. */
const RUNTIME_CONFIG_URL = `${import.meta.env.BASE_URL}streamarr-config.json`;

function App() {
  const [engine] = useState(() => new TizenAvplayEngine());

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
      clientPlatform="tv-tizen"
      playbackCapabilities={PLAYBACK_CAPABILITIES}
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
