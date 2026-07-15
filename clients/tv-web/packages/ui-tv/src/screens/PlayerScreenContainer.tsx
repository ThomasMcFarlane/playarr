import { useEffect, useRef } from "react";
import type { ApiClient } from "@streamarr-tv/api-client";
import { usePlaybackInfo, type PlaybackCapabilities } from "@streamarr-tv/api-client/react";
import type { PlaybackEngine } from "@streamarr-tv/player-core";
import { AsyncStateMessage } from "../lib/AsyncStateMessage";
import { mimeTypeForPlaybackMode } from "../lib/playback";
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
 * `PlaybackEngine` interface from `@streamarr-tv/player-core`) with
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

  useEffect(() => {
    if (state.status !== "ready") return;
    if (loadedForUrl.current === state.data.url) return;
    loadedForUrl.current = state.data.url;

    void engine
      .load({
        url: client.resolveUrl(state.data.url),
        mimeType: mimeTypeForPlaybackMode(state.data.mode),
      })
      .then(() => engine.play());
  }, [state, engine, client]);

  if (state.status === "loading" || state.status === "idle") {
    return <AsyncStateMessage kind="loading" message="Preparing playback..." />;
  }
  if (state.status === "error") {
    return <AsyncStateMessage kind="error" message={`Could not start playback (${state.message}).`} />;
  }
  if (state.status === "empty") {
    return <AsyncStateMessage kind="empty" message="No playable source was returned for this title." />;
  }

  return <PlayerScreen engine={engine} title={title} onExit={onExit} />;
}
