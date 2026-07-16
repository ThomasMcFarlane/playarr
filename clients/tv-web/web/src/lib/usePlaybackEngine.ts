import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  ApiError,
  describeApiError,
  type ApiClient,
  type PlaybackEventKind,
  type PlaybackInfo,
  type PlaybackInfoParams,
  type PlaybackMode,
  type PlaybackQualityOption,
  type WatchProgress,
} from "@streamarr-tv/api-client";
import { ShakaPlaybackEngine } from "@streamarr-tv/player-shaka";
import type {
  PlaybackAudioTrack,
  PlaybackEngineState,
  PlaybackSubtitleTrack,
} from "@streamarr-tv/player-core";
import { TokenStore } from "@streamarr-tv/device-auth";
import { useApiClient } from "./ApiClientProvider";
import { WEB_PLAYBACK_CAPABILITIES } from "./playbackCapabilities";

const initialNegotiations = new WeakMap<
  ApiClient,
  Map<string, Promise<PlaybackInfo>>
>();

/**
 * React StrictMode deliberately replays effects in development. Playback
 * negotiation creates a server-side session, so issuing it twice is not an
 * harmless duplicate GET: it can also start two transcodes. Share the first
 * in-flight request across the replay and discard it as soon as it settles.
 */
function getInitialPlaybackInfo(
  client: ApiClient,
  mediaFileId: string,
  params: PlaybackInfoParams
): Promise<PlaybackInfo> {
  let clientNegotiations = initialNegotiations.get(client);
  if (!clientNegotiations) {
    clientNegotiations = new Map();
    initialNegotiations.set(client, clientNegotiations);
  }

  const requestKey = `${mediaFileId}:${JSON.stringify(params)}`;
  const existing = clientNegotiations.get(requestKey);
  if (existing) return existing;

  const request = client.getPlaybackInfo(mediaFileId, params);
  clientNegotiations.set(requestKey, request);
  const clearRequest = () => {
    if (clientNegotiations?.get(requestKey) === request) {
      clientNegotiations.delete(requestKey);
    }
  };
  void request.then(clearRequest, clearRequest);
  return request;
}

function isExpiredHlsSessionError(
  negotiation: NegotiationState,
  engineState: PlaybackEngineState
): negotiation is Extract<NegotiationState, { kind: "ready" }> {
  if (negotiation.kind !== "ready" || negotiation.mode !== "hls") return false;
  if (engineState.state !== "error" || engineState.error?.httpStatus !== 404) return false;

  const requestUri = engineState.error.requestUri;
  return Boolean(requestUri?.includes("/api/v1/media/sessions/"));
}

function isOnDemandHlsUrl(url: string): boolean {
  return url.includes("/api/v1/media/sessions/");
}

function sourceTimeToEngineTime(
  positionSeconds: number,
  negotiation: Extract<NegotiationState, { kind: "ready" }>
): number {
  return isOnDemandHlsUrl(negotiation.url)
    ? Math.max(0, positionSeconds - negotiation.sourceOffsetSeconds)
    : positionSeconds;
}

function sourceAudioTracksFromInfo(info: PlaybackInfo): PlaybackAudioTrack[] {
  return info.audio_tracks.map((track) => ({
    id: track.id,
    label: track.label,
    language: track.language ?? undefined,
    roles: [],
    channelsCount: track.channels ?? undefined,
    selected: track.id === info.selected_audio_track_id,
  }));
}

function sourceSubtitleTracksFromInfo(info: PlaybackInfo): PlaybackSubtitleTrack[] {
  return info.subtitle_tracks.map((track) => ({
    id: track.id,
    label: track.label,
    language: track.language ?? undefined,
    roles: [],
    forced: track.forced,
    selected: false,
  }));
}

/**
 * Outcome of `GET /api/v1/playback/{media_file_id}` -- kept separate from
 * `PlaybackEngineState` (the *engine's* state once a source is actually
 * loaded) because the two failure modes need different UI: a negotiation
 * failure means there is nothing to play at all (no `<video>` surface makes
 * sense), while an engine error happens after a real source was handed to
 * Shaka Player.
 *
 * `usePlaybackInfo` in `@streamarr-tv/api-client/react` covers this same
 * request elsewhere in the app, but collapses everything to a plain string
 * message -- this hook calls `ApiClient.getPlaybackInfo` directly instead so
 * a 403 (no Playarr streaming access) can be distinguished from every other
 * failure, per this page's own error-state requirements.
 */
export type NegotiationState =
  | { kind: "loading" }
  | { kind: "error"; forbidden: boolean; message: string }
  | {
      kind: "ready";
      mode: PlaybackMode;
      url: string;
      /** Fixed source-file duration; never the growing edge of an event HLS playlist. */
      durationSeconds: number;
      /** Absolute source time represented by zero in this media timeline. */
      sourceOffsetSeconds: number;
    };

const IDLE_ENGINE_STATE: PlaybackEngineState = {
  state: "idle",
  currentTimeSeconds: 0,
  durationSeconds: 0,
  bufferedSeconds: 0,
  volume: 1,
  muted: false,
  audioTracks: [],
  subtitleTracks: [],
  selectedAudioTrackId: null,
  selectedSubtitleTrackId: null,
};

export interface PlaybackEngineController {
  /** Attach to a `<video>` element via `ref={videoRef}`. */
  videoRef: RefObject<HTMLVideoElement>;
  negotiation: NegotiationState;
  engineState: PlaybackEngineState;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  seek: (positionSeconds: number) => void;
  setVolume: (volume: number) => void;
  setMuted: (muted: boolean) => void;
  audioTracks: PlaybackAudioTrack[];
  subtitleTracks: PlaybackSubtitleTrack[];
  selectedAudioTrackId: string | null;
  selectedSubtitleTrackId: string | null;
  selectAudioTrack: (trackId: string) => void;
  selectSubtitleTrack: (trackId: string | null) => void;
  subtitleSwitching: boolean;
  subtitleError?: string;
  qualityOptions: PlaybackQualityOption[];
  activeQualityId: string;
  qualitySwitching: boolean;
  qualityError?: string;
  selectQuality: (qualityId: string) => void;
  /** Re-runs the negotiation call (e.g. a "Try again" button on the error state). */
  retryNegotiation: () => void;
}

export interface PlaybackLaunchSettings {
  qualityId: string;
  profile: string | null;
  forceTranscode: boolean;
  audioTrackId: string | null;
  audioStreamIndex: number | null;
  subtitleTrackId: string | null;
}

/**
 * Negotiates playback for `mediaFileId` (`GET /api/v1/playback/{id}`), then
 * attaches `@streamarr-tv/player-shaka`'s `ShakaPlaybackEngine` to a
 * `<video>` element and loads whatever the negotiation returned -- a direct
 * progressive file (`mode: "direct"`) or an HLS manifest (`mode: "hls"`),
 * Shaka picks the right internal pipeline for either from the `mimeType`
 * alone, so this hook doesn't need its own direct-vs-HLS branch.
 *
 * Wires `ShakaPlaybackEngine.setAuthHeaderProvider` to the current access
 * token (`TokenStore`, the same store `ApiClientProvider` uses) so every
 * manifest/segment/license request Shaka's `NetworkingEngine` makes carries
 * `Authorization: Bearer <token>` -- see that method's doc comment in
 * `player-shaka` for why this is necessary (those requests are made by
 * Shaka directly, not through `ApiClient`, so `ApiClient`'s own auth
 * middleware never sees them).
 */
export function usePlaybackEngine(
  mediaFileId: string | undefined,
  startPositionSeconds?: number,
  initialSettings?: PlaybackLaunchSettings | null
): PlaybackEngineController {
  const client = useApiClient();
  const videoRef = useRef<HTMLVideoElement>(null);
  const engineRef = useRef<ShakaPlaybackEngine | null>(null);
  const loadedForUrl = useRef<string | null>(null);
  const progressPromiseRef = useRef<Promise<WatchProgress | undefined> | null>(null);
  const latestPlaybackRef = useRef({
    positionMs: 0,
    durationMs: 0,
    state: IDLE_ENGINE_STATE.state,
  });
  const previousPlaybackStateRef = useRef(IDLE_ENGINE_STATE.state);
  const lastProgressWriteAtRef = useRef(0);
  const qualitySwitchRequestRef = useRef(0);
  const sourceSwitchBarrierRef = useRef<Promise<void>>(Promise.resolve());
  const latestUserSeekRef = useRef<number | null>(null);
  const pendingQualitySwitchRef = useRef<{
    positionSeconds: number;
    shouldPlay: boolean;
  } | null>(null);
  const negotiationRequestRef = useRef<PlaybackInfoParams>(WEB_PLAYBACK_CAPABILITIES);
  const automaticRecoveryUrlRef = useRef<string | null>(null);
  const initialNegotiationRef = useRef(true);
  const activeSessionIdRef = useRef<string | null>(null);
  const onDemandTranscodeRef = useRef(false);
  const sourceOffsetSecondsRef = useRef(0);
  const sourceAudioStreamIndicesRef = useRef(new Map<string, number>());
  const sourceSubtitleOptionsRef = useRef(
    new Map<string, PlaybackInfo["subtitle_tracks"][number]>()
  );
  const sourceSubtitleBlobUrlsRef = useRef(new Map<string, string>());
  const sourceSubtitleLoadsRef = useRef(new Map<string, Promise<string>>());
  const subtitleSelectionRequestRef = useRef(0);
  const subtitleSourceGenerationRef = useRef(0);
  const preferredSourceSubtitleTrackIdRef = useRef<string | null>(null);
  const closedSessionIdsRef = useRef(new Set<string>());

  const [negotiation, setNegotiation] = useState<NegotiationState>({ kind: "loading" });
  const [retryCount, setRetryCount] = useState(0);
  const [engineState, setEngineState] = useState<PlaybackEngineState>(IDLE_ENGINE_STATE);
  const [qualityOptions, setQualityOptions] = useState<PlaybackQualityOption[]>([]);
  const [activeQualityId, setActiveQualityId] = useState("original");
  const [qualitySwitching, setQualitySwitching] = useState(false);
  const [qualityError, setQualityError] = useState<string | undefined>();
  const [sourceAudioTracks, setSourceAudioTracks] = useState<PlaybackAudioTrack[]>([]);
  const [selectedSourceAudioTrackId, setSelectedSourceAudioTrackId] = useState<string | null>(
    null
  );
  const [sourceSubtitleTracks, setSourceSubtitleTracks] = useState<PlaybackSubtitleTrack[]>([]);
  const [subtitleSwitching, setSubtitleSwitching] = useState(false);
  const [subtitleError, setSubtitleError] = useState<string | undefined>();

  const clearSourceSubtitleBlobs = useCallback(() => {
    subtitleSelectionRequestRef.current += 1;
    subtitleSourceGenerationRef.current += 1;
    for (const url of sourceSubtitleBlobUrlsRef.current.values()) {
      URL.revokeObjectURL(url);
    }
    sourceSubtitleBlobUrlsRef.current.clear();
    sourceSubtitleLoadsRef.current.clear();
  }, []);

  const applySourceTracks = useCallback((info: PlaybackInfo) => {
    clearSourceSubtitleBlobs();
    sourceAudioStreamIndicesRef.current = new Map(
      info.audio_tracks.map((track) => [track.id, track.stream_index])
    );
    sourceSubtitleOptionsRef.current = new Map(
      info.subtitle_tracks.map((track) => [track.id, track])
    );
    if (
      preferredSourceSubtitleTrackIdRef.current === null &&
      info.selected_subtitle_track_id
    ) {
      preferredSourceSubtitleTrackIdRef.current = info.selected_subtitle_track_id;
    }
    setSourceAudioTracks(sourceAudioTracksFromInfo(info));
    setSelectedSourceAudioTrackId(info.selected_audio_track_id ?? null);
    setSourceSubtitleTracks(sourceSubtitleTracksFromInfo(info));
  }, [clearSourceSubtitleBlobs]);

  const loadSourceSubtitleTrack = useCallback(
    async (trackId: string, selectionRequestId: number): Promise<boolean> => {
      const sourceTrack = sourceSubtitleOptionsRef.current.get(trackId);
      if (!sourceTrack) return false;

      const sourceGeneration = subtitleSourceGenerationRef.current;
      let blobUrl = sourceSubtitleBlobUrlsRef.current.get(trackId);
      if (!blobUrl) {
        let pending = sourceSubtitleLoadsRef.current.get(trackId);
        if (!pending) {
          pending = (async () => {
            if (!mediaFileId) throw new Error("No media file is loaded");
            const subtitleBlob = await client.getMediaSubtitle(
              mediaFileId,
              sourceTrack.stream_index,
              Math.max(0, Math.round(sourceOffsetSecondsRef.current * 1000))
            );
            const objectUrl = URL.createObjectURL(
              new Blob([subtitleBlob], { type: "text/vtt" })
            );
            if (sourceGeneration !== subtitleSourceGenerationRef.current) {
              URL.revokeObjectURL(objectUrl);
              return "";
            }
            sourceSubtitleBlobUrlsRef.current.set(trackId, objectUrl);
            return objectUrl;
          })();
          sourceSubtitleLoadsRef.current.set(trackId, pending);
        }
        try {
          blobUrl = await pending;
        } finally {
          if (sourceSubtitleLoadsRef.current.get(trackId) === pending) {
            sourceSubtitleLoadsRef.current.delete(trackId);
          }
        }
      }

      if (
        !blobUrl ||
        selectionRequestId !== subtitleSelectionRequestRef.current ||
        sourceGeneration !== subtitleSourceGenerationRef.current
      ) {
        return false;
      }
      const engine = engineRef.current;
      if (!engine) return false;
      await engine.addExternalSubtitleTracks([
        {
          id: sourceTrack.id,
          url: blobUrl,
          label: sourceTrack.label,
          language: sourceTrack.language ?? undefined,
          forced: sourceTrack.forced,
        },
      ]);
      if (
        selectionRequestId !== subtitleSelectionRequestRef.current ||
        sourceGeneration !== subtitleSourceGenerationRef.current
      ) {
        return false;
      }
      await engine.selectSubtitleTrack(trackId);
      preferredSourceSubtitleTrackIdRef.current = trackId;
      return true;
    },
    [client, mediaFileId]
  );

  const recordTerminalEvent = useCallback(
    (sessionId: string, event: PlaybackEventKind): Promise<void> => {
      if (closedSessionIdsRef.current.has(sessionId)) return Promise.resolve();
      closedSessionIdsRef.current.add(sessionId);
      return client.recordPlaybackEvent(sessionId, event).catch(() => {
        // Teardown stays best-effort: navigation must not be blocked if
        // the backend has already restarted or the network has gone away.
      });
    },
    [client]
  );

  const stopActiveSession = useCallback(
    (reason: "completed" | "user_stopped" | "error" = "user_stopped"): Promise<void> => {
      const sessionId = activeSessionIdRef.current;
      if (!sessionId) return Promise.resolve();
      activeSessionIdRef.current = null;

      if (reason === "error") {
        return recordTerminalEvent(sessionId, {
          kind: "error",
          message: "Player entered a terminal error state",
        });
      }

      return recordTerminalEvent(sessionId, {
        kind: "stop",
        reason,
        position_ms: Math.max(0, latestPlaybackRef.current.positionMs),
      });
    },
    [recordTerminalEvent]
  );

  useEffect(() => {
    loadedForUrl.current = null;
    lastProgressWriteAtRef.current = 0;
    previousPlaybackStateRef.current = IDLE_ENGINE_STATE.state;
    qualitySwitchRequestRef.current += 1;
    sourceSwitchBarrierRef.current = Promise.resolve();
    latestUserSeekRef.current = null;
    pendingQualitySwitchRef.current = null;
    negotiationRequestRef.current = {
      ...WEB_PLAYBACK_CAPABILITIES,
      ...(initialSettings?.qualityId && initialSettings.qualityId !== "original"
        ? {
            profile: initialSettings.profile ?? initialSettings.qualityId,
            forceTranscode: initialSettings.forceTranscode,
          }
        : {}),
      ...(initialSettings?.audioStreamIndex !== null &&
      initialSettings?.audioStreamIndex !== undefined
        ? { audioStreamIndex: initialSettings.audioStreamIndex }
        : {}),
    };
    automaticRecoveryUrlRef.current = null;
    initialNegotiationRef.current = true;
    onDemandTranscodeRef.current = false;
    sourceOffsetSecondsRef.current = 0;
    sourceAudioStreamIndicesRef.current = new Map();
    sourceSubtitleOptionsRef.current = new Map();
    preferredSourceSubtitleTrackIdRef.current =
      initialSettings?.subtitleTrackId ?? null;
    setQualityOptions([]);
    setActiveQualityId(initialSettings?.qualityId ?? "original");
    setQualitySwitching(false);
    setQualityError(undefined);
    setSourceAudioTracks([]);
    setSelectedSourceAudioTrackId(null);
    setSourceSubtitleTracks([]);
    setSubtitleSwitching(false);
    setSubtitleError(undefined);
    clearSourceSubtitleBlobs();
    progressPromiseRef.current = mediaFileId
      ? client.getWatchProgress(mediaFileId).catch(() => undefined)
      : null;
  }, [
    clearSourceSubtitleBlobs,
    client,
    initialSettings?.audioStreamIndex,
    initialSettings?.forceTranscode,
    initialSettings?.profile,
    initialSettings?.qualityId,
    initialSettings?.subtitleTrackId,
    mediaFileId,
  ]);

  useEffect(
    () => () => {
      clearSourceSubtitleBlobs();
    },
    [clearSourceSubtitleBlobs]
  );

  // Negotiate playback. Re-runs whenever `mediaFileId` changes or
  // `retryNegotiation` is called.
  useEffect(() => {
    if (!mediaFileId) return;
    let cancelled = false;
    setNegotiation({ kind: "loading" });

    const isInitialNegotiation = initialNegotiationRef.current;
    initialNegotiationRef.current = false;

    const request = (async () => {
      let requestParams = negotiationRequestRef.current;
      if (isInitialNegotiation) {
        const explicitStart =
          startPositionSeconds !== undefined &&
          Number.isFinite(startPositionSeconds) &&
          startPositionSeconds >= 0
            ? startPositionSeconds
            : undefined;
        const progress = explicitStart === undefined ? await progressPromiseRef.current : undefined;
        const resumePositionSeconds =
          explicitStart ??
          (progress?.state === "part_watched" && progress.position_ms > 0
            ? progress.position_ms / 1000
            : 0);
        latestUserSeekRef.current = resumePositionSeconds > 0 ? resumePositionSeconds : null;
        requestParams = {
          ...requestParams,
          startPositionMs: Math.max(0, Math.round(resumePositionSeconds * 1000)),
        };
        negotiationRequestRef.current = requestParams;
        return getInitialPlaybackInfo(client, mediaFileId, requestParams);
      }
      return client.getPlaybackInfo(mediaFileId, requestParams);
    })();

    void request
      .then((info) => {
        // The initial request is deliberately shared across React
        // StrictMode's effect replay. Its first subscriber is cancelled
        // while the second consumes the same session, so cancellation
        // must not close the shared server session here.
        if (cancelled) return;
        const previousSessionId = activeSessionIdRef.current;
        activeSessionIdRef.current = info.session_id;
        onDemandTranscodeRef.current =
          info.mode === "hls" && isOnDemandHlsUrl(info.url);
        sourceOffsetSecondsRef.current = Math.max(0, info.source_offset_ms / 1000);
        if (previousSessionId && previousSessionId !== info.session_id) {
          void recordTerminalEvent(previousSessionId, {
            kind: "stop",
            reason: "user_stopped",
            position_ms: Math.max(0, latestPlaybackRef.current.positionMs),
          });
        }
        setQualityOptions(info.quality_options);
        setActiveQualityId(info.selected_quality_id);
        applySourceTracks(info);
        setNegotiation({
          kind: "ready",
          mode: info.mode,
          url: info.url,
          durationSeconds: Math.max(0, info.duration_ms / 1000),
          sourceOffsetSeconds: sourceOffsetSecondsRef.current,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setNegotiation({
          kind: "error",
          forbidden: err instanceof ApiError && err.status === 403,
          message: describeApiError(err),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [
    applySourceTracks,
    client,
    mediaFileId,
    recordTerminalEvent,
    retryCount,
    startPositionSeconds,
  ]);

  // A backend restart invalidates its in-memory on-demand HLS sessions while
  // the browser can still hold the old manifest URL. Once Shaka has exhausted
  // its own retries and reports that session URL as 404, negotiate one fresh
  // source and resume at the same playhead position. The URL guard prevents a
  // failed replacement session from creating an automatic recovery loop.
  useEffect(() => {
    if (qualitySwitching) return;
    if (!mediaFileId || !isExpiredHlsSessionError(negotiation, engineState)) return;
    if (automaticRecoveryUrlRef.current === negotiation.url) return;

    automaticRecoveryUrlRef.current = negotiation.url;
    const absolutePositionSeconds =
      engineState.currentTimeSeconds + negotiation.sourceOffsetSeconds;
    pendingQualitySwitchRef.current = {
      positionSeconds: absolutePositionSeconds,
      shouldPlay: true,
    };
    negotiationRequestRef.current = {
      ...negotiationRequestRef.current,
      startPositionMs: Math.max(0, Math.round(absolutePositionSeconds * 1000)),
    };
    loadedForUrl.current = null;
    void stopActiveSession("error").finally(() => {
      setRetryCount((count) => count + 1);
    });
  }, [
    engineState,
    mediaFileId,
    negotiation,
    qualitySwitching,
    stopActiveSession,
  ]);

  // Create the engine and attach it to the <video> element once negotiation
  // has actually succeeded -- `PlayerSurface` (which renders the `<video>`
  // this hook's `videoRef` points at) is only mounted by the caller once
  // `negotiation.kind === "ready"` (see `Player.tsx`), so `videoRef.current`
  // is null for the entire "loading"/"error" lifetime. An empty dependency
  // array here used to run this effect exactly once, immediately after
  // `usePlaybackEngine` itself first mounts -- always before negotiation
  // resolves, so `videoRef.current` was always null and the engine was
  // never created at all (the actual root cause of "can't load/play
  // anything": no negotiation error, no engine error, just an eternal
  // loading spinner with zero network activity). Depending on whether
  // negotiation is ready re-fires this effect on the exact render where
  // `PlayerSurface`/`<video>` mounts -- React commits child refs before
  // running a parent's effects in the same commit, so `videoRef.current`
  // is already populated by the time this callback runs. A retry that
  // sends negotiation back through "loading" unmounts `PlayerSurface`
  // (and the `<video>` with it), so re-attaching to the fresh element on
  // the next "ready" transition is correct, not wasted churn.
  useEffect(() => {
    if (!videoRef.current) return;

    const engine = new ShakaPlaybackEngine();
    try {
      engine.attach(videoRef.current);
    } catch (err) {
      // Browser lacks MSE/EME support -- surface it the same way an engine
      // playback error would be surfaced, since from the UI's perspective
      // it's the same "can't play this here" outcome.
      setEngineState({
        ...IDLE_ENGINE_STATE,
        state: "error",
        error: {
          code: "UNSUPPORTED_BROWSER",
          message: err instanceof Error ? err.message : String(err),
          fatal: true,
        },
      });
      return;
    }

    engine.setAuthHeaderProvider(() => new TokenStore().get()?.accessToken);
    engineRef.current = engine;
    setEngineState(engine.getState());
    const unsubscribe = engine.onStateChange(setEngineState);

    return () => {
      unsubscribe();
      void engine.destroy();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run only on the loading/error <-> ready transition (see comment above), not on every negotiation object identity change.
  }, [negotiation.kind === "ready"]);

  // Load whatever the negotiation resolved to, once there's both a ready
  // negotiation result and an attached engine. Guarded by `loadedForUrl` so
  // an unrelated re-render (e.g. a volume change ticking `engineState`)
  // doesn't reload the same source.
  useEffect(() => {
    if (negotiation.kind !== "ready" || !engineRef.current) return;

    const resolvedUrl = client.resolveUrl(negotiation.url);
    if (loadedForUrl.current === resolvedUrl) return;
    loadedForUrl.current = resolvedUrl;

    void engineRef.current
      .load({
        url: resolvedUrl,
        mimeType: negotiation.mode === "hls" ? "application/x-mpegURL" : "video/mp4",
      })
      .then(async () => {
        if (loadedForUrl.current !== resolvedUrl) return;
        const qualitySwitch = pendingQualitySwitchRef.current;
        if (qualitySwitch) {
          await engineRef.current?.seek(
            sourceTimeToEngineTime(qualitySwitch.positionSeconds, negotiation)
          );
          pendingQualitySwitchRef.current = null;
          const preferredSubtitleTrackId = preferredSourceSubtitleTrackIdRef.current;
          if (preferredSubtitleTrackId) {
            const subtitleRequestId = ++subtitleSelectionRequestRef.current;
            setSubtitleSwitching(true);
            setSubtitleError(undefined);
            await loadSourceSubtitleTrack(
              preferredSubtitleTrackId,
              subtitleRequestId
            )
              .then(() => {
                if (subtitleRequestId === subtitleSelectionRequestRef.current) {
                  setSubtitleSwitching(false);
                }
              })
              .catch((error) => {
                if (subtitleRequestId !== subtitleSelectionRequestRef.current) return;
                setSubtitleSwitching(false);
                setSubtitleError(describeApiError(error));
                console.warn("Could not restore subtitle track", error);
              });
          }
          if (qualitySwitch.shouldPlay) {
            await engineRef.current?.play();
          }
          setQualitySwitching(false);
          return;
        }

        if (latestUserSeekRef.current !== null) {
          await engineRef.current?.seek(
            sourceTimeToEngineTime(latestUserSeekRef.current, negotiation)
          );
        } else {
          const explicitStart =
            startPositionSeconds !== undefined &&
            Number.isFinite(startPositionSeconds) &&
            startPositionSeconds >= 0
              ? startPositionSeconds
              : undefined;
          if (explicitStart !== undefined) {
            await engineRef.current?.seek(sourceTimeToEngineTime(explicitStart, negotiation));
          } else {
            const progress = await progressPromiseRef.current;
            if (latestUserSeekRef.current !== null) {
              await engineRef.current?.seek(
                sourceTimeToEngineTime(latestUserSeekRef.current, negotiation)
              );
            } else if (progress?.state === "part_watched" && progress.position_ms > 0) {
              await engineRef.current?.seek(
                sourceTimeToEngineTime(progress.position_ms / 1000, negotiation)
              );
            }
          }
        }
        const preferredSubtitleTrackId = preferredSourceSubtitleTrackIdRef.current;
        if (preferredSubtitleTrackId) {
          const subtitleRequestId = ++subtitleSelectionRequestRef.current;
          setSubtitleSwitching(true);
          setSubtitleError(undefined);
          await loadSourceSubtitleTrack(
            preferredSubtitleTrackId,
            subtitleRequestId
          )
            .then(() => {
              if (subtitleRequestId === subtitleSelectionRequestRef.current) {
                setSubtitleSwitching(false);
              }
            })
            .catch((error) => {
              if (subtitleRequestId !== subtitleSelectionRequestRef.current) return;
              setSubtitleSwitching(false);
              setSubtitleError(describeApiError(error));
              console.warn("Could not restore subtitle track", error);
            });
        }
        await engineRef.current?.play();
      })
      .catch(() => {
        if (loadedForUrl.current !== resolvedUrl) return;
        pendingQualitySwitchRef.current = null;
        setQualitySwitching(false);
        // The engine's own onStateChange already reports state: "error"
        // with a real PlaybackError -- this catch exists only so a
        // rejected load()/play() doesn't become an unhandled rejection.
      });
  }, [negotiation, client, loadSourceSubtitleTrack, startPositionSeconds]);

  const persistProgress = useCallback(
    (completed: boolean) => {
      if (!mediaFileId) return;
      const { positionMs, durationMs } = latestPlaybackRef.current;
      if (positionMs <= 0 && !completed) return;
      lastProgressWriteAtRef.current = Date.now();
      void client
        .updateWatchProgress(mediaFileId, {
          positionMs,
          durationMs,
          completed,
        })
        .catch(() => {
          // Progress must never interrupt playback. The next heartbeat or
          // state transition retries with the latest position.
        });
    },
    [client, mediaFileId]
  );

  const fixedDurationSeconds =
    negotiation.kind === "ready" && negotiation.durationSeconds > 0
      ? negotiation.durationSeconds
      : engineState.durationSeconds;

  // Keep a lightweight heartbeat while playing, then flush immediately on
  // pause/end/error. Ten seconds is frequent enough for useful resume
  // behaviour without turning every video timeupdate into an API write.
  useEffect(() => {
    const positionMs = Math.max(
      0,
      Math.round(
        (engineState.currentTimeSeconds + sourceOffsetSecondsRef.current) * 1000
      )
    );
    const durationMs = Math.max(0, Math.round(fixedDurationSeconds * 1000));
    latestPlaybackRef.current = { positionMs, durationMs, state: engineState.state };

    const previousState = previousPlaybackStateRef.current;
    previousPlaybackStateRef.current = engineState.state;
    const stateChanged = previousState !== engineState.state;
    const completed =
      engineState.state === "ended" ||
      (durationMs > 0 && positionMs * 10 >= durationMs * 9);
    const shouldFlushTransition =
      stateChanged && ["paused", "ended", "error"].includes(engineState.state);
    const shouldHeartbeat =
      ["playing", "buffering"].includes(engineState.state) &&
      Date.now() - lastProgressWriteAtRef.current >= 10_000;

    if (shouldFlushTransition || shouldHeartbeat) {
      persistProgress(completed);
    }

    if (engineState.state === "ended") {
      void stopActiveSession("completed");
    } else if (engineState.state === "error") {
      void stopActiveSession("error");
    }
  }, [engineState, fixedDurationSeconds, persistProgress, stopActiveSession]);

  // Route changes/unmounts are a playback stop even when the engine never
  // emitted a pause event. Flush the last known position before teardown.
  useEffect(
    () => () => {
      const { positionMs, durationMs } = latestPlaybackRef.current;
      persistProgress(durationMs > 0 && positionMs * 10 >= durationMs * 9);
      void stopActiveSession("user_stopped");
    },
    [persistProgress, stopActiveSession]
  );

  const play = useCallback(() => {
    void engineRef.current?.play();
  }, []);
  const pause = useCallback(() => {
    void engineRef.current?.pause();
  }, []);
  const togglePlay = useCallback(() => {
    const current = engineRef.current?.getState().state;
    if (current === "playing" || current === "buffering") {
      void engineRef.current?.pause();
    } else {
      void engineRef.current?.play();
    }
  }, []);
  const seek = useCallback(
    (positionSeconds: number) => {
      const absolutePositionSeconds = Math.max(
        0,
        Math.min(fixedDurationSeconds || Number.POSITIVE_INFINITY, positionSeconds)
      );
      latestUserSeekRef.current = absolutePositionSeconds;
      latestPlaybackRef.current.positionMs = Math.round(absolutePositionSeconds * 1000);
      if (pendingQualitySwitchRef.current) {
        pendingQualitySwitchRef.current.positionSeconds = absolutePositionSeconds;
      }

      // A completed rendition and a direct source have a fully seekable
      // timeline. A live `/sessions/` playlist only contains what this
      // particular ffmpeg process has produced, so an absolute seek must
      // replace that process at the requested source timestamp.
      if (!mediaFileId || !onDemandTranscodeRef.current) {
        void engineRef.current?.seek(absolutePositionSeconds);
        return;
      }

      const current = engineRef.current?.getState() ?? engineState;
      const shouldPlay = current.state === "playing" || current.state === "buffering";
      const requestId = ++qualitySwitchRequestRef.current;
      pendingQualitySwitchRef.current = {
        positionSeconds: absolutePositionSeconds,
        shouldPlay,
      };
      negotiationRequestRef.current = {
        ...negotiationRequestRef.current,
        startPositionMs: Math.round(absolutePositionSeconds * 1000),
      };
      loadedForUrl.current = null;
      setQualitySwitching(true);
      setQualityError(undefined);
      setNegotiation({ kind: "loading" });
      if (shouldPlay) void engineRef.current?.pause();

      const closeCurrentSession = stopActiveSession("user_stopped");
      const previousSwitch = sourceSwitchBarrierRef.current;
      const switchOperation = previousSwitch
        .catch(() => undefined)
        .then(() => closeCurrentSession)
        .then(() => {
          if (qualitySwitchRequestRef.current !== requestId) return undefined;
          return client.getPlaybackInfo(mediaFileId, negotiationRequestRef.current);
        })
        .then((info) => {
          if (!info) return;
          if (qualitySwitchRequestRef.current !== requestId) {
            return recordTerminalEvent(info.session_id, {
              kind: "stop",
              reason: "user_stopped",
              position_ms: Math.round(absolutePositionSeconds * 1000),
            });
            return;
          }
          activeSessionIdRef.current = info.session_id;
          onDemandTranscodeRef.current =
            info.mode === "hls" && isOnDemandHlsUrl(info.url);
          sourceOffsetSecondsRef.current = Math.max(0, info.source_offset_ms / 1000);
          setQualityOptions(info.quality_options);
          setActiveQualityId(info.selected_quality_id);
          applySourceTracks(info);
          setNegotiation({
            kind: "ready",
            mode: info.mode,
            url: info.url,
            durationSeconds: Math.max(0, info.duration_ms / 1000),
            sourceOffsetSeconds: sourceOffsetSecondsRef.current,
          });
        })
        .catch((err: unknown) => {
          if (qualitySwitchRequestRef.current !== requestId) return;
          pendingQualitySwitchRef.current = null;
          setQualitySwitching(false);
          setNegotiation({
            kind: "error",
            forbidden: err instanceof ApiError && err.status === 403,
            message: describeApiError(err),
          });
        });
      sourceSwitchBarrierRef.current = switchOperation.then(
        () => undefined,
        () => undefined
      );
    },
    [
      client,
      engineState,
      fixedDurationSeconds,
      mediaFileId,
      applySourceTracks,
      recordTerminalEvent,
      stopActiveSession,
    ]
  );
  const setVolume = useCallback((volume: number) => {
    engineRef.current?.setVolume(volume);
  }, []);
  const setMuted = useCallback((muted: boolean) => {
    engineRef.current?.setMuted(muted);
  }, []);
  const selectAudioTrack = useCallback(
    (trackId: string) => {
      const audioStreamIndex = sourceAudioStreamIndicesRef.current.get(trackId);
      if (
        !mediaFileId ||
        audioStreamIndex === undefined ||
        trackId === selectedSourceAudioTrackId
      ) {
        void engineRef.current?.selectAudioTrack(trackId);
        return;
      }

      const current = engineRef.current?.getState() ?? engineState;
      const absolutePositionSeconds =
        current.currentTimeSeconds + sourceOffsetSecondsRef.current;
      const shouldPlay = current.state === "playing" || current.state === "buffering";
      const requestId = ++qualitySwitchRequestRef.current;
      pendingQualitySwitchRef.current = {
        positionSeconds: absolutePositionSeconds,
        shouldPlay,
      };
      const request = {
        ...negotiationRequestRef.current,
        startPositionMs: Math.max(0, Math.round(absolutePositionSeconds * 1000)),
        audioStreamIndex,
      };
      negotiationRequestRef.current = request;
      loadedForUrl.current = null;
      setQualitySwitching(true);
      setQualityError(undefined);
      setNegotiation({ kind: "loading" });
      if (shouldPlay) void engineRef.current?.pause();

      const closeCurrentSession = stopActiveSession("user_stopped");
      const previousSwitch = sourceSwitchBarrierRef.current;
      const switchOperation = previousSwitch
        .catch(() => undefined)
        .then(() => closeCurrentSession)
        .then(() => {
          if (qualitySwitchRequestRef.current !== requestId) return undefined;
          return client.getPlaybackInfo(mediaFileId, request);
        })
        .then((info) => {
          if (!info) return;
          if (qualitySwitchRequestRef.current !== requestId) {
            return recordTerminalEvent(info.session_id, {
              kind: "stop",
              reason: "user_stopped",
              position_ms: Math.max(0, Math.round(absolutePositionSeconds * 1000)),
            });
          }
          activeSessionIdRef.current = info.session_id;
          onDemandTranscodeRef.current =
            info.mode === "hls" && isOnDemandHlsUrl(info.url);
          sourceOffsetSecondsRef.current = Math.max(0, info.source_offset_ms / 1000);
          setQualityOptions(info.quality_options);
          setActiveQualityId(info.selected_quality_id);
          applySourceTracks(info);
          setNegotiation({
            kind: "ready",
            mode: info.mode,
            url: info.url,
            durationSeconds: Math.max(0, info.duration_ms / 1000),
            sourceOffsetSeconds: sourceOffsetSecondsRef.current,
          });
        })
        .catch((err: unknown) => {
          if (qualitySwitchRequestRef.current !== requestId) return;
          pendingQualitySwitchRef.current = null;
          setQualitySwitching(false);
          setQualityError(describeApiError(err));
          setNegotiation({
            kind: "error",
            forbidden: err instanceof ApiError && err.status === 403,
            message: describeApiError(err),
          });
        });
      sourceSwitchBarrierRef.current = switchOperation.then(
        () => undefined,
        () => undefined
      );
    },
    [
      applySourceTracks,
      client,
      engineState,
      mediaFileId,
      recordTerminalEvent,
      selectedSourceAudioTrackId,
      stopActiveSession,
    ]
  );
  const selectSubtitleTrack = useCallback(
    (trackId: string | null) => {
      const selectionRequestId = ++subtitleSelectionRequestRef.current;
      if (trackId === null) {
        preferredSourceSubtitleTrackIdRef.current = null;
        setSubtitleSwitching(false);
        setSubtitleError(undefined);
        void engineRef.current?.selectSubtitleTrack(null);
        return;
      }

      const sourceTrack = sourceSubtitleOptionsRef.current.get(trackId);
      if (!sourceTrack) {
        preferredSourceSubtitleTrackIdRef.current = null;
        setSubtitleSwitching(false);
        setSubtitleError(undefined);
        void engineRef.current?.selectSubtitleTrack(trackId);
        return;
      }

      setSubtitleSwitching(true);
      setSubtitleError(undefined);
      void loadSourceSubtitleTrack(trackId, selectionRequestId)
        .then(() => {
          if (selectionRequestId === subtitleSelectionRequestRef.current) {
            setSubtitleSwitching(false);
          }
        })
        .catch((error) => {
          if (selectionRequestId !== subtitleSelectionRequestRef.current) return;
          setSubtitleSwitching(false);
          setSubtitleError(describeApiError(error));
          console.warn("Could not load subtitle track", error);
        });
    },
    [loadSourceSubtitleTrack]
  );
  const selectQuality = useCallback(
    (qualityId: string) => {
      if (!mediaFileId || qualitySwitching || qualityId === activeQualityId) return;
      const option = qualityOptions.find((quality) => quality.id === qualityId);
      if (!option) return;

      const current = engineRef.current?.getState() ?? engineState;
      const absolutePositionSeconds =
        current.currentTimeSeconds + sourceOffsetSecondsRef.current;
      const shouldPlay = current.state === "playing" || current.state === "buffering";
      const previousQualityId = activeQualityId;
      const previousNegotiationRequest = negotiationRequestRef.current;
      const requestId = ++qualitySwitchRequestRef.current;
      pendingQualitySwitchRef.current = {
        positionSeconds: absolutePositionSeconds,
        shouldPlay,
      };
      setQualitySwitching(true);
      setQualityError(undefined);
      loadedForUrl.current = null;
      setNegotiation({ kind: "loading" });
      if (shouldPlay) void engineRef.current?.pause();

      const selectedAudioStreamIndex =
        selectedSourceAudioTrackId === null
          ? undefined
          : sourceAudioStreamIndicesRef.current.get(selectedSourceAudioTrackId);
      const request =
        option.id === "original"
          ? {
              ...WEB_PLAYBACK_CAPABILITIES,
              startPositionMs: Math.round(absolutePositionSeconds * 1000),
              audioStreamIndex: selectedAudioStreamIndex,
              ignoreSavedPreferences: true,
            }
          : {
              ...WEB_PLAYBACK_CAPABILITIES,
              profile: option.profile ?? option.id,
              forceTranscode: true,
              startPositionMs: Math.round(absolutePositionSeconds * 1000),
              audioStreamIndex: selectedAudioStreamIndex,
            };
      negotiationRequestRef.current = request;

      const closeCurrentSession = stopActiveSession("user_stopped");
      const previousSwitch = sourceSwitchBarrierRef.current;
      const switchOperation = previousSwitch
        .catch(() => undefined)
        .then(() => closeCurrentSession)
        .then(() => {
          if (qualitySwitchRequestRef.current !== requestId) return undefined;
          return client.getPlaybackInfo(mediaFileId, request);
        })
        .then((info) => {
          if (!info) return;
          if (qualitySwitchRequestRef.current !== requestId) {
            return recordTerminalEvent(info.session_id, {
              kind: "stop",
              reason: "user_stopped",
              position_ms: Math.max(0, Math.round(absolutePositionSeconds * 1000)),
            });
            return;
          }
          activeSessionIdRef.current = info.session_id;
          onDemandTranscodeRef.current =
            info.mode === "hls" && isOnDemandHlsUrl(info.url);
          sourceOffsetSecondsRef.current = Math.max(0, info.source_offset_ms / 1000);
          setQualityOptions(info.quality_options);
          setActiveQualityId(info.selected_quality_id);
          applySourceTracks(info);
          setNegotiation({
            kind: "ready",
            mode: info.mode,
            url: info.url,
            durationSeconds: Math.max(0, info.duration_ms / 1000),
            sourceOffsetSeconds: sourceOffsetSecondsRef.current,
          });
        })
        .catch((err: unknown) => {
          if (qualitySwitchRequestRef.current !== requestId) return;
          pendingQualitySwitchRef.current = null;
          negotiationRequestRef.current = previousNegotiationRequest;
          setActiveQualityId(previousQualityId);
          setQualitySwitching(false);
          setQualityError(describeApiError(err));
          setNegotiation({
            kind: "error",
            forbidden: err instanceof ApiError && err.status === 403,
            message: describeApiError(err),
          });
        });
      sourceSwitchBarrierRef.current = switchOperation.then(
        () => undefined,
        () => undefined
      );
    },
    [
      activeQualityId,
      applySourceTracks,
      client,
      engineState,
      mediaFileId,
      qualityOptions,
      qualitySwitching,
      recordTerminalEvent,
      selectedSourceAudioTrackId,
      stopActiveSession,
    ]
  );
  const retryNegotiation = useCallback(() => {
    loadedForUrl.current = null;
    automaticRecoveryUrlRef.current = null;
    void stopActiveSession("user_stopped").finally(() => {
      setRetryCount((n) => n + 1);
    });
  }, [stopActiveSession]);

  const exposedEngineState = useMemo(
    () => {
      const sourceOffsetSeconds = sourceOffsetSecondsRef.current;
      const currentTimeSeconds = Math.min(
        fixedDurationSeconds > 0 ? fixedDurationSeconds : Number.POSITIVE_INFINITY,
        engineState.currentTimeSeconds + sourceOffsetSeconds
      );
      const bufferedSeconds = Math.min(
        fixedDurationSeconds > 0 ? fixedDurationSeconds : Number.POSITIVE_INFINITY,
        engineState.bufferedSeconds + sourceOffsetSeconds
      );
      if (
        fixedDurationSeconds === engineState.durationSeconds &&
        currentTimeSeconds === engineState.currentTimeSeconds &&
        bufferedSeconds === engineState.bufferedSeconds
      ) {
        return engineState;
      }
      return {
        ...engineState,
        currentTimeSeconds,
        bufferedSeconds,
        durationSeconds: fixedDurationSeconds,
      };
    },
    [engineState, fixedDurationSeconds]
  );
  const exposeSourceAudioTracks =
    negotiation.kind === "ready" &&
    negotiation.mode === "hls" &&
    sourceAudioTracks.length > 0;
  const exposeSourceSubtitleTracks =
    negotiation.kind === "ready" &&
    sourceSubtitleTracks.length > 0;
  const exposedSubtitleTracks = exposeSourceSubtitleTracks
    ? sourceSubtitleTracks.map((track) => ({
        ...track,
        selected: track.id === exposedEngineState.selectedSubtitleTrackId,
      }))
    : exposedEngineState.subtitleTracks;

  return {
    videoRef,
    negotiation,
    engineState: exposedEngineState,
    play,
    pause,
    togglePlay,
    seek,
    setVolume,
    setMuted,
    audioTracks: exposeSourceAudioTracks ? sourceAudioTracks : exposedEngineState.audioTracks,
    subtitleTracks: exposedSubtitleTracks,
    selectedAudioTrackId: exposeSourceAudioTracks
      ? selectedSourceAudioTrackId
      : exposedEngineState.selectedAudioTrackId,
    selectedSubtitleTrackId: exposedEngineState.selectedSubtitleTrackId,
    selectAudioTrack,
    selectSubtitleTrack,
    subtitleSwitching,
    subtitleError,
    qualityOptions,
    activeQualityId,
    qualitySwitching,
    qualityError,
    selectQuality,
    retryNegotiation,
  };
}
