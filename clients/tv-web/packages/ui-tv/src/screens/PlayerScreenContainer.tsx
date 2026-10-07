import { useCallback, useEffect, useRef } from "react";
import type { ApiClient } from "@playarr-tv/api-client";
import { usePlaybackInfo, type PlaybackCapabilities } from "@playarr-tv/api-client/react";
import type { PlaybackEngine } from "@playarr-tv/player-core";
import { AsyncStateMessage } from "../lib/AsyncStateMessage";
import { mimeTypeForPlaybackMode } from "../lib/playback";
import { fetchResumeSeconds, ProgressReporter } from "../lib/progress";
import { PlayerScreen } from "./PlayerScreen";

export interface PlayerScreenContainerProps {
  client: ApiClient;
  engine: PlaybackEngine;
  mediaFileId: string;
  capabilities?: PlaybackCapabilities;
  title?: string;
  onExit?: () => void;
}

/**
 * Calls the real `GET /api/v1/playback/{media_file_id}` negotiation
 * endpoint, then configures the platform `PlaybackEngine` (Shaka on
 * web/webOS/VIDAA, native AVPlay on Tizen -- both implement the same
 * `PlaybackEngine` interface from `@playarr-tv/player-core`) with
 * whatever it returns, before handing off to the presentational
 * `PlayerScreen` for transport controls.
 */
export function PlayerScreenContainer({
  client,
  engine,
  mediaFileId,
  capabilities,
  title,
  onExit,
}: PlayerScreenContainerProps) {
  const state = usePlaybackInfo(client, mediaFileId, capabilities);
  const loadedForUrl = useRef<string | null>(null);

  const reporterRef = useRef<ProgressReporter | null>(null);

  useEffect(() => {
    if (state.status !== "ready") return;
    if (loadedForUrl.current === state.data.url) return;
    loadedForUrl.current = state.data.url;
    const url = state.data.url;
    const mode = state.data.mode;

    void fetchResumeSeconds(client, mediaFileId).then(async (startPositionSeconds) => {
      if (loadedForUrl.current !== url) return;
      const reporter = new ProgressReporter(client, mediaFileId, engine);
      reporter.start();
      reporterRef.current = reporter;
      await engine.load({
        url: client.resolveUrl(url),
        mimeType: mimeTypeForPlaybackMode(mode),
        startPositionSeconds,
      });
      await engine.play();
    });
  }, [state, engine, client, mediaFileId]);

  // Flush on exit, on the page going to the background and when unmounting
  // for any other reason, then stop playback so audio never outlives the screen.
  const finish = useCallback(async () => {
    const reporter = reporterRef.current;
    reporterRef.current = null;
    if (reporter) {
      await reporter.flush();
      reporter.dispose();
    }
    await engine.pause().catch(() => undefined);
  }, [engine]);

  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden") void reporterRef.current?.flush();
    };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onHidden);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onHidden);
      void finish();
    };
  }, [finish]);

  const handleExit = useCallback(() => {
    void finish().finally(() => onExit?.());
  }, [finish, onExit]);

  // Loading and idle fall through to the player itself: Play opens the player
  // straight away, with no interstitial while the session is negotiated.
  if (state.status === "error") {
    return <AsyncStateMessage kind="error" message={`Could not start playback (${state.message}).`} />;
  }
  if (state.status === "empty") {
    return <AsyncStateMessage kind="empty" message="No playable source was returned for this title." />;
  }

  return <PlayerScreen engine={engine} title={title} onExit={onExit ? handleExit : undefined} />;
}
