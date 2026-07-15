import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { usePlaybackInfo } from "@streamarr-tv/api-client/react";
import { ShakaPlaybackEngine } from "@streamarr-tv/player-shaka";
import type { PlaybackEngineState } from "@streamarr-tv/player-core";
import { useApiClient } from "../lib/ApiClientProvider";
import { WEB_PLAYBACK_CAPABILITIES } from "../lib/playbackCapabilities";

/**
 * Standalone-web playback surface. Calls the real
 * `GET /api/v1/playback/{media_file_id}` negotiation endpoint, then
 * configures `@streamarr-tv/player-shaka` (the same adapter the
 * webOS/VIDAA TV shells use) with whatever it returns, via the shared
 * `PlaybackEngine` interface from `@streamarr-tv/player-core`.
 *
 * `mediaFileId` is the real, resolved `MediaFile` id from
 * `WorkDetailSchema.media_file_id` -- see `WorkDetail.tsx`, which only
 * links here once that field is non-null.
 */
export function PlayerPage() {
  const { mediaFileId } = useParams<{ mediaFileId: string }>();
  const client = useApiClient();
  const playbackState = usePlaybackInfo(client, mediaFileId, WEB_PLAYBACK_CAPABILITIES);

  const videoRef = useRef<HTMLVideoElement>(null);
  const engineRef = useRef<ShakaPlaybackEngine | null>(null);
  const loadedForUrl = useRef<string | null>(null);
  const [engineState, setEngineState] = useState<PlaybackEngineState | null>(null);

  useEffect(() => {
    if (!videoRef.current) return;

    const engine = new ShakaPlaybackEngine();
    engine.attach(videoRef.current);
    engineRef.current = engine;

    const unsubscribe = engine.onStateChange(setEngineState);

    return () => {
      unsubscribe();
      void engine.destroy();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (playbackState.status !== "ready" || !engineRef.current) return;
    if (loadedForUrl.current === playbackState.data.url) return;
    loadedForUrl.current = playbackState.data.url;

    void engineRef.current
      .load({
        url: client.resolveUrl(playbackState.data.url),
        mimeType: playbackState.data.mode === "hls" ? "application/x-mpegURL" : "video/mp4",
      })
      .then(() => engineRef.current?.play());
  }, [playbackState, client]);

  return (
    <div style={{ padding: "2rem", color: "#ffffff" }}>
      <h1>Player</h1>

      {(playbackState.status === "loading" || playbackState.status === "idle") && (
        <p style={{ color: "#a0a0a0" }}>Preparing playback...</p>
      )}
      {playbackState.status === "error" && (
        <p style={{ color: "#e74c3c" }}>Could not start playback ({playbackState.message}).</p>
      )}
      {playbackState.status === "empty" && (
        <p style={{ color: "#a0a0a0" }}>No playable source was returned for this title.</p>
      )}

      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- captions not modeled by the backend yet */}
      <video ref={videoRef} controls style={{ width: "100%", maxWidth: 960, background: "#000" }} />
      <p style={{ color: "#5c5c5c", fontSize: "0.875rem" }}>
        engine state: {engineState?.state ?? "not initialized"}
        {engineState?.error ? ` -- ${engineState.error.message}` : ""}
      </p>
    </div>
  );
}
