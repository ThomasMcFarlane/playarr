import { useEffect, useRef, useState } from "react";
import { ShakaPlaybackEngine } from "@streamarr-tv/player-shaka";
import type { PlaybackEngineState } from "@streamarr-tv/player-shaka";

/**
 * Standalone-web playback surface. Uses `@streamarr-tv/player-shaka`
 * directly (the same adapter the webOS/VIDAA TV shells use) rather than
 * `ui-tv`'s `PlayerScreen`, since mouse/keyboard users don't need
 * spatial-nav focus chrome -- native `<video controls>` is enough here.
 */
export function PlayerPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const engineRef = useRef<ShakaPlaybackEngine | null>(null);
  const [state, setState] = useState<PlaybackEngineState | null>(null);

  useEffect(() => {
    if (!videoRef.current) return;

    const engine = new ShakaPlaybackEngine();
    engine.attach(videoRef.current);
    engineRef.current = engine;

    const unsubscribe = engine.onStateChange(setState);

    return () => {
      unsubscribe();
      void engine.destroy();
      engineRef.current = null;
    };
  }, []);

  return (
    <div style={{ padding: "2rem", color: "#ffffff" }}>
      <h1>Player</h1>
      <p style={{ color: "#a0a0a0" }}>
        No source loaded yet -- this page will call{" "}
        <code>engine.load(&#123; url, mimeType, drm &#125;)</code> once a
        real `MediaFile` is selected from the Library.
      </p>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- placeholder, no source loaded yet */}
      <video ref={videoRef} controls style={{ width: "100%", maxWidth: 960, background: "#000" }} />
      <p style={{ color: "#5c5c5c", fontSize: "0.875rem" }}>
        engine state: {state?.state ?? "not initialized"}
      </p>
    </div>
  );
}
