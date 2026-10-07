import { shouldKeepEngineAttached } from "./playerMounting";
import { sourceAudioTracksFromInfo } from "./sourceAudioTracks";
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
} from "@playarr-tv/api-client";
import { ShakaPlaybackEngine } from "@playarr-tv/player-shaka";
import { TizenAvplayEngine } from "@playarr-tv/player-avplay";
import type {
  PlaybackAudioTrack,
  PlaybackEngine,
  PlaybackEngineState,
  PlaybackSubtitleTrack,
} from "@playarr-tv/player-core";
import { useServerAccessToken, useServerClient } from "./ApiClientProvider";
import { replayNegotiationParams } from "./endScreen";
import { WEB_PLAYBACK_CAPABILITIES } from "./playbackCapabilities";
import {
  readPlayerDefaults,
  selectDefaultSubtitleTrackId,
} from "./playerDefaults";
import { useDownloads, type LocalPlaybackSource } from "./DownloadsProvider";
import { useOnlineStatus } from "./useOnlineStatus";
import { IS_TIZEN } from "./clientPlatform";
import { DOWNLOADED_QUALITY_ID } from "./qualityIds";
import {
  canReconnect,
  humanNegotiationMessage,
  isTransientNegotiationError,
  MAX_NEGOTIATION_AUTO_RETRIES,
  isRecoverableConnectionError,
  isUnhandledEngineError,
  sessionCloseForEngineState,
  reconnectDelayMs,
} from "./playbackReconnect";

/** Selector id for the synthetic "Downloaded" quality option a completed local copy adds to `qualityOptions` -- never a real server rendition profile. */
export { DOWNLOADED_QUALITY_ID } from "./qualityIds";

const initialNegotiations = new WeakMap<
  ApiClient,
  Map<string, Promise<PlaybackInfo>>
>();

type ManagedPlaybackEngine = PlaybackEngine & {
  getBytesReceived?: () => number;
  resetBytesReceived?: () => void;
  setPlaybackSessionId?: (sessionId: string | null) => void;
};

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
 * `usePlaybackInfo` in `@playarr-tv/api-client/react` covers this same
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
      mimeType: string;
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
  /** True while the stream is being re-established after a backend restart or dropped connection. */
  reconnecting: boolean;
  qualityError?: string;
  selectQuality: (qualityId: string) => void;
  /** Re-runs the negotiation call (e.g. a "Try again" button on the error state). */
  retryNegotiation: () => void;
  /** Starts a fresh playback session from 0 (end-of-playback Replay). */
  restart: () => void;
  /** The active server playback session id, or null before negotiation / offline. */
  getSessionId: () => string | null;
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
 * selects the platform playback adapter and loads whatever the negotiation
 * returned: Shaka attaches to the `<video>` element on Web/webOS/VIDAA,
 * while Samsung packages use native `webapis.avplay` behind the same control
 * surface. Both accept direct media or HLS through `PlaybackEngine`.
 *
 * Wires `ShakaPlaybackEngine.setAuthHeaderProvider` to the current access
 * token selected by `ApiClientProvider` for this media's server so every
 * manifest/segment/license request Shaka's `NetworkingEngine` makes carries
 * `Authorization: Bearer <token>` -- see that method's doc comment in
 * `player-shaka` for why this is necessary (those requests are made by
 * Shaka directly, not through `ApiClient`, so `ApiClient`'s own auth
 * middleware never sees them).
 */
export function usePlaybackEngine(
  mediaFileId: string | undefined,
  startPositionSeconds?: number,
  initialSettings?: PlaybackLaunchSettings | null,
  serverUrl?: string
): PlaybackEngineController {
  const client = useServerClient(serverUrl);
  const getAccessToken = useServerAccessToken(serverUrl);
  // The token provider's identity changes whenever the API client context is
  // rebuilt (profile session persistence, server list refresh). The engine
  // must not be torn down for that: a recreated engine has no source loaded,
  // and `loadedForUrl` stops the load effect from loading it again, which
  // left the player on an endless spinner after the manifest and first
  // segment had been fetched (TASKS 456). Always read the latest provider.
  const getAccessTokenRef = useRef(getAccessToken);
  getAccessTokenRef.current = getAccessToken;
  const downloads = useDownloads();
  const online = useOnlineStatus();
  const [localSource, setLocalSource] = useState<LocalPlaybackSource | null>(null);
  const playerDefaults = useMemo(() => readPlayerDefaults(), [mediaFileId]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const engineRef = useRef<ManagedPlaybackEngine | null>(null);
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
  // Set once the user deliberately picks a quality via `selectQuality`
  // (including picking "Downloaded" themselves). Once set, the automatic
  // "default to the completed download" effect backs off for the rest of
  // this viewing session instead of overriding a deliberate choice.
  const userSelectedQualityRef = useRef(false);
  const negotiationRequestRef = useRef<PlaybackInfoParams>(WEB_PLAYBACK_CAPABILITIES);
  const automaticRecoveryUrlRef = useRef<string | null>(null);
  // The engine error a reconnect was already started for (see `isUnhandledEngineError`).
  const recoveredEngineErrorRef = useRef<PlaybackEngineState["error"]>(undefined);
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
  const [reconnecting, setReconnecting] = useState(false);
  const reconnectingRef = useRef(false);
  const reconnectAttemptRef = useRef(0);
  // Silent re-tries of a failed first negotiation; reset on success and on every manual retry.
  const negotiationAutoRetryRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [qualityError, setQualityError] = useState<string | undefined>();
  const [sourceAudioTracks, setSourceAudioTracks] = useState<PlaybackAudioTrack[]>([]);
  const [selectedSourceAudioTrackId, setSelectedSourceAudioTrackId] = useState<string | null>(
    null
  );
  const [sourceSubtitleTracks, setSourceSubtitleTracks] = useState<PlaybackSubtitleTrack[]>([]);
  const [subtitleSwitching, setSubtitleSwitching] = useState(false);
  const [subtitleError, setSubtitleError] = useState<string | undefined>();

  // Resolves (or clears) this media file's completed local download, if
  // any. Mirrored into `localSourceRef` so the offline branch of the
  // negotiation effect below can read the latest value without depending
  // on `localSource` itself -- resolving a local copy *while already
  // playing online* must not tear down and restart the live session just
  // to add a quality option (the separate effect further down handles
  // that merge without touching negotiation at all).
  const localSourceRef = useRef<LocalPlaybackSource | null>(null);
  // Tracks whether the "auto-default to the completed download" effect
  // further below has already fired for the current `mediaFileId` -- a
  // local copy should become the active quality automatically exactly
  // once per viewing session, never re-applied on every subsequent
  // re-render once it has resolved.
  const autoAppliedDownloadedQualityRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    localSourceRef.current = null;
    autoAppliedDownloadedQualityRef.current = false;
    setLocalSource(null);
    if (!mediaFileId) return;
    void downloads.getLocalPlaybackSource(mediaFileId).then((source) => {
      if (cancelled) return;
      localSourceRef.current = source;
      setLocalSource(source);
    });
    return () => {
      cancelled = true;
    };
  }, [downloads, mediaFileId]);

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
    if (preferredSourceSubtitleTrackIdRef.current === null) {
      preferredSourceSubtitleTrackIdRef.current =
        info.selected_subtitle_track_id ??
        selectDefaultSubtitleTrackId(info.subtitle_tracks, playerDefaults);
    }
    setSourceAudioTracks(sourceAudioTracksFromInfo(info));
    setSelectedSourceAudioTrackId(info.selected_audio_track_id ?? null);
    setSourceSubtitleTracks(sourceSubtitleTracksFromInfo(info));
  }, [clearSourceSubtitleBlobs, playerDefaults]);

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

  const recordHeartbeat = useCallback(
    (sessionId: string): Promise<void> =>
      client
        .recordPlaybackEvent(sessionId, {
          kind: "heartbeat",
          position_ms: Math.max(0, latestPlaybackRef.current.positionMs),
          bytes_streamed_total: engineRef.current?.getBytesReceived?.() ?? 0,
        })
        .catch(() => {
          // Analytics must never interrupt playback. A later heartbeat or
          // terminal flush retries with the latest cumulative counters.
        }),
    [client]
  );

  const closeSession = useCallback(
    (sessionId: string, event: PlaybackEventKind): Promise<void> => {
      if (closedSessionIdsRef.current.has(sessionId)) return Promise.resolve();
      return recordHeartbeat(sessionId).then(() => recordTerminalEvent(sessionId, event));
    },
    [recordHeartbeat, recordTerminalEvent]
  );

  const stopActiveSession = useCallback(
    (reason: "completed" | "user_stopped" | "error" = "user_stopped"): Promise<void> => {
      const sessionId = activeSessionIdRef.current;
      if (!sessionId) return Promise.resolve();
      activeSessionIdRef.current = null;

      if (reason === "error") {
        return closeSession(sessionId, {
          kind: "error",
          message: "Player entered a terminal error state",
        });
      }

      return closeSession(sessionId, {
        kind: "stop",
        reason,
        position_ms: Math.max(0, latestPlaybackRef.current.positionMs),
      });
    },
    [closeSession]
  );

  // Switches playback straight to the completed local download's `blob:`
  // URL -- the exact same position/play-state-preserving, session-
  // stopping sequence `selectQuality`'s manual "Downloaded" pick uses,
  // shared here so the automatic default-to-downloaded effect below can
  // never drift out of sync with the manual path.
  const switchToDownloadedQuality = useCallback(() => {
    if (!localSource) return;
    const current = engineRef.current?.getState() ?? engineState;
    const absolutePositionSeconds =
      current.currentTimeSeconds + sourceOffsetSecondsRef.current;
    const shouldPlay = current.state === "playing" || current.state === "buffering";
    pendingQualitySwitchRef.current = {
      positionSeconds: absolutePositionSeconds,
      shouldPlay,
    };
    qualitySwitchRequestRef.current += 1;
    setQualitySwitching(true);
    setQualityError(undefined);
    loadedForUrl.current = null;
    setActiveQualityId(DOWNLOADED_QUALITY_ID);
    sourceOffsetSecondsRef.current = 0;
    onDemandTranscodeRef.current = false;
    void stopActiveSession("user_stopped");
    setNegotiation({
      kind: "ready",
      mode: "direct",
      url: localSource.blobUrl,
      mimeType: localSource.mimeType,
      durationSeconds: localSource.durationSeconds,
      sourceOffsetSeconds: 0,
    });
  }, [engineState, localSource, stopActiveSession]);

  // Appends the synthetic "Downloaded" quality option once a local copy
  // resolves for an already-negotiated (online) source, without
  // restarting negotiation -- see the `localSourceRef` comment above.
  // Once the option is present, immediately switches playback to it too:
  // a completed local copy is preferred over any network stream, even one
  // the server itself negotiated as direct-play. This only ever
  // auto-applies once per `mediaFileId` (`autoAppliedDownloadedQualityRef`,
  // reset alongside `localSourceRef` above) and never overrides a quality
  // the user already picked deliberately this session
  // (`userSelectedQualityRef`) -- mirroring how `info.selected_quality_id`
  // from the negotiation response only ever sets the *initial*
  // `activeQualityId`, never an ongoing override. Gating on
  // `readyNegotiationMode !== undefined` (i.e. `negotiation.kind ===
  // "ready"`) ensures this always runs after the initial negotiation
  // effect below has populated `activeSessionIdRef`, so
  // `switchToDownloadedQuality`'s `stopActiveSession` call has a real
  // session to close instead of racing ahead of negotiation.
  const readyNegotiationMode = negotiation.kind === "ready" ? negotiation.mode : undefined;
  useEffect(() => {
    if (!localSource || readyNegotiationMode === undefined) return;
    setQualityOptions((current) =>
      current.some((option) => option.id === DOWNLOADED_QUALITY_ID)
        ? current
        : [
            ...current,
            {
              id: DOWNLOADED_QUALITY_ID,
              label: "Downloaded",
              profile: null,
              height: null,
              video_bitrate_bps: null,
            },
          ]
    );
    if (autoAppliedDownloadedQualityRef.current || userSelectedQualityRef.current) {
      return;
    }
    autoAppliedDownloadedQualityRef.current = true;
    switchToDownloadedQuality();
  }, [localSource, readyNegotiationMode, switchToDownloadedQuality]);

  useEffect(() => {
    const preferredQualityId = initialSettings?.qualityId ?? playerDefaults.qualityId;
    loadedForUrl.current = null;
    lastProgressWriteAtRef.current = 0;
    previousPlaybackStateRef.current = IDLE_ENGINE_STATE.state;
    qualitySwitchRequestRef.current += 1;
    sourceSwitchBarrierRef.current = Promise.resolve();
    latestUserSeekRef.current = null;
    pendingQualitySwitchRef.current = null;
    negotiationRequestRef.current = {
      ...WEB_PLAYBACK_CAPABILITIES,
      ...(preferredQualityId !== "original"
        ? {
            profile: initialSettings?.profile ?? preferredQualityId,
            forceTranscode: initialSettings?.forceTranscode ?? true,
          }
        : {}),
      ...(initialSettings?.audioStreamIndex !== null &&
      initialSettings?.audioStreamIndex !== undefined
        ? { audioStreamIndex: initialSettings.audioStreamIndex }
        : {}),
    };
    automaticRecoveryUrlRef.current = null;
    reconnectingRef.current = false;
    reconnectAttemptRef.current = 0;
    setReconnecting(false);
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    initialNegotiationRef.current = true;
    negotiationAutoRetryRef.current = 0;
    userSelectedQualityRef.current = false;
    onDemandTranscodeRef.current = false;
    sourceOffsetSecondsRef.current = 0;
    sourceAudioStreamIndicesRef.current = new Map();
    sourceSubtitleOptionsRef.current = new Map();
    preferredSourceSubtitleTrackIdRef.current =
      initialSettings?.subtitleTrackId ?? null;
    setQualityOptions([]);
    setActiveQualityId(preferredQualityId);
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
    playerDefaults.qualityId,
  ]);

  useEffect(
    () => () => {
      clearSourceSubtitleBlobs();
    },
    [clearSourceSubtitleBlobs]
  );

  // Negotiate playback. Re-runs whenever `mediaFileId` changes or
  // `retryNegotiation` is called.
  //
  // Offline + a completed local copy: skip network negotiation entirely
  // and build a "direct" `NegotiationState` straight from the downloaded
  // file's `blob:` URL -- `ShakaPlaybackEngine`'s direct mode is literally
  // `mediaElement.src = url; mediaElement.load()`, so this needs no
  // player-engine changes at all. Offline with no local copy fails fast
  // with a clear message instead of waiting out a network timeout.
  useEffect(() => {
    if (!mediaFileId) return;
    if (!online) {
      const source = localSourceRef.current;
      if (source) {
        setQualityOptions([
          {
            id: DOWNLOADED_QUALITY_ID,
            label: "Downloaded",
            profile: null,
            height: null,
            video_bitrate_bps: null,
          },
        ]);
        setActiveQualityId(DOWNLOADED_QUALITY_ID);
        setNegotiation({
          kind: "ready",
          mode: "direct",
          url: source.blobUrl,
          mimeType: source.mimeType,
          durationSeconds: source.durationSeconds,
          sourceOffsetSeconds: 0,
        });
      } else {
        setNegotiation({
          kind: "error",
          forbidden: false,
          message: "You're offline and this title hasn't been downloaded.",
        });
      }
      return;
    }
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
          void closeSession(previousSessionId, {
            kind: "stop",
            reason: "user_stopped",
            position_ms: Math.max(0, latestPlaybackRef.current.positionMs),
          });
        }
        engineRef.current?.resetBytesReceived?.();
        // A completed local copy (if any) is merged into `qualityOptions`
        // by the dedicated effect above instead of here -- that keeps
        // resolving it (an async OPFS/IndexedDB read) from ever forcing
        // this whole negotiation to re-run.
        negotiationAutoRetryRef.current = 0;
        setQualityOptions(info.quality_options);
        setActiveQualityId(info.selected_quality_id);
        applySourceTracks(info);
        setNegotiation({
          kind: "ready",
          mode: info.mode,
          url: info.url,
          mimeType: info.mime_type,
          durationSeconds: Math.max(0, info.duration_ms / 1000),
          sourceOffsetSeconds: sourceOffsetSecondsRef.current,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const forbidden = err instanceof ApiError && err.status === 403;
        if (reconnectingRef.current && !forbidden && canReconnect(reconnectAttemptRef.current)) {
          // The backend is still away: stay mounted and try again shortly.
          const delay = reconnectDelayMs(reconnectAttemptRef.current);
          reconnectAttemptRef.current += 1;
          reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = null;
            setRetryCount((count) => count + 1);
          }, delay);
          return;
        }
        if (
          !forbidden &&
          !reconnectingRef.current &&
          isTransientNegotiationError(err) &&
          negotiationAutoRetryRef.current < MAX_NEGOTIATION_AUTO_RETRIES
        ) {
          // Stay on the player (spinner) and try again with back-off; the
          // stored request parameters resume at the same position.
          const delay = reconnectDelayMs(negotiationAutoRetryRef.current);
          negotiationAutoRetryRef.current += 1;
          reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = null;
            setRetryCount((count) => count + 1);
          }, delay);
          return;
        }
        reconnectingRef.current = false;
        setReconnecting(false);
        pendingQualitySwitchRef.current = null;
        setNegotiation({
          kind: "error",
          forbidden,
          message: humanNegotiationMessage(err, describeApiError(err)),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [
    applySourceTracks,
    client,
    closeSession,
    mediaFileId,
    online,
    retryCount,
    startPositionSeconds,
  ]);

  // A backend restart invalidates its in-memory on-demand HLS sessions while
  // the browser can still hold the old manifest URL (404), and a dropped
  // connection surfaces as a network error on those same URLs. Once Shaka has
  // exhausted its own retries, keep the player mounted in an inline
  // "reconnecting" state, negotiate a fresh source with back-off and resume at
  // the same playhead position. The URL guard stops a replacement session that
  // fails immediately from looping; the attempt budget bounds the whole thing.
  useEffect(() => {
    if (qualitySwitching) return;
    if (negotiation.kind !== "ready" || negotiation.mode !== "hls") return;
    if (engineState.state !== "error") return;
    if (
      !mediaFileId ||
      !isRecoverableConnectionError(engineState.error, {
        onDemandSession: isOnDemandHlsUrl(negotiation.url),
      })
    ) {
      return;
    }
    if (automaticRecoveryUrlRef.current === negotiation.url) return;
    // The replacement negotiation becomes "ready" while `engineState` still
    // holds the error that caused this reconnect. Treating that stale error as
    // a failure of the new session renegotiated a second time, which closed
    // the session the player had just been handed (TASKS 456).
    if (!isUnhandledEngineError(engineState.error, recoveredEngineErrorRef.current)) return;
    if (!canReconnect(reconnectAttemptRef.current)) {
      reconnectingRef.current = false;
      setReconnecting(false);
      return;
    }

    automaticRecoveryUrlRef.current = negotiation.url;
    recoveredEngineErrorRef.current = engineState.error;
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
    reconnectingRef.current = true;
    setReconnecting(true);
    const delay = reconnectDelayMs(reconnectAttemptRef.current);
    reconnectAttemptRef.current += 1;
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      // The old session may be unreachable; closing it is best effort.
      void stopActiveSession("error")
        .catch(() => undefined)
        .finally(() => {
          setRetryCount((count) => count + 1);
        });
    }, delay);
  }, [
    engineState,
    mediaFileId,
    negotiation,
    qualitySwitching,
    stopActiveSession,
  ]);

  // Playback is confirmed healthy again: forget the reconnect budget.
  useEffect(() => {
    if (!reconnectingRef.current) return;
    if (engineState.state === "playing" && negotiation.kind === "ready") {
      reconnectingRef.current = false;
      reconnectAttemptRef.current = 0;
      setReconnecting(false);
    }
  }, [engineState.state, negotiation.kind]);

  useEffect(
    () => () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    },
    []
  );

  // Create the platform engine as soon as `PlayerSurface` (which renders the
  // `<video>` this hook's `videoRef` points at) mounts. `Player.tsx` mounts the
  // surface for the "loading" state too, so Play opens the player directly and
  // the engine is attached while the stream is still being negotiated; the
  // source is loaded by the effect below once negotiation is ready. React
  // commits child refs before a parent's effects, so `videoRef.current` is
  // populated when this runs. Only an error unmounts the surface (and the
  // `<video>`), so a retry re-attaches to the fresh element on the next
  // loading transition. Seeks that restart a transcode, quality and audio
  // switches keep the surface, `<video>` and engine alive.
  useEffect(() => {
    if (!videoRef.current) return;

    let engine: ManagedPlaybackEngine;
    try {
      if (IS_TIZEN) {
        engine = new TizenAvplayEngine();
      } else {
        const shaka = new ShakaPlaybackEngine();
        shaka.attach(videoRef.current);
        shaka.setAuthHeaderProvider((request) => getAccessTokenRef.current(request));
        engine = shaka;
      }
    } catch (err) {
      // Browser lacks MSE/EME support -- surface it the same way an engine
      // playback error would be surfaced, since from the UI's perspective
      // it's the same "can't play this here" outcome.
      setEngineState({
        ...IDLE_ENGINE_STATE,
        state: "error",
        error: {
          code: IS_TIZEN ? "AVPLAY_UNAVAILABLE" : "UNSUPPORTED_BROWSER",
          message: err instanceof Error ? err.message : String(err),
          fatal: true,
        },
      });
      return;
    }

    engineRef.current = engine;
    setEngineState(engine.getState());
    const unsubscribe = engine.onStateChange(setEngineState);

    return () => {
      unsubscribe();
      void engine.destroy();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run only on the loading/error <-> ready transition (see comment above), not on every negotiation object identity change.
  }, [shouldKeepEngineAttached(negotiation.kind)]);

  // Load whatever the negotiation resolved to, once there's both a ready
  // negotiation result and an attached engine. Guarded by `loadedForUrl` so
  // an unrelated re-render (e.g. a volume change ticking `engineState`)
  // doesn't reload the same source.
  useEffect(() => {
    if (negotiation.kind !== "ready" || !engineRef.current) return;

    const resolvedUrl = client.resolveUrl(negotiation.url);
    if (loadedForUrl.current === resolvedUrl) return;
    loadedForUrl.current = resolvedUrl;
    engineRef.current.setPlaybackSessionId?.(activeSessionIdRef.current);

    void engineRef.current
      .load({
        url: resolvedUrl,
        mimeType: negotiation.mimeType,
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
      // Offline (a downloaded item keeps playing): buffer this update in
      // IndexedDB instead of a doomed network call -- `DownloadsProvider`'s
      // flush loop replays it once back online, timestamped via
      // `occurred_at` for when it actually happened.
      if (!online) {
        void downloads
          .queueWatchMutation({ mediaFileId, positionMs, durationMs, completed })
          .catch(() => {
            // Best-effort -- a lost buffered update is no worse than the
            // pre-offline-support behaviour of not persisting it at all.
          });
        return;
      }
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
    [client, downloads, mediaFileId, online]
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
      const sessionId = activeSessionIdRef.current;
      if (sessionId) void recordHeartbeat(sessionId);
    }

    // Only on the transition: this effect also re-runs for unrelated changes
    // (a re-negotiated source sets `fixedDurationSeconds`) while the engine
    // still reports the previous session's terminal state. Closing "the active
    // session" then closed the replacement session a reconnect had just
    // negotiated, so its playlist 404ed forever (TASKS 456).
    const closeReason = sessionCloseForEngineState(previousState, engineState.state);
    if (closeReason) void stopActiveSession(closeReason);
  }, [
    engineState,
    fixedDurationSeconds,
    persistProgress,
    recordHeartbeat,
    stopActiveSession,
  ]);

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
          engineRef.current?.resetBytesReceived?.();
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
            mimeType: info.mime_type,
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
          engineRef.current?.resetBytesReceived?.();
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
            mimeType: info.mime_type,
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
      userSelectedQualityRef.current = true;

      if (qualityId === DOWNLOADED_QUALITY_ID && localSource) {
        // The local copy needs no network negotiation at all -- switch
        // straight to it via the same helper the automatic
        // default-to-downloaded effect uses, so both paths stay identical.
        switchToDownloadedQuality();
        return;
      }

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
          engineRef.current?.resetBytesReceived?.();
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
            mimeType: info.mime_type,
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
      localSource,
      recordTerminalEvent,
      selectedSourceAudioTrackId,
      stopActiveSession,
      switchToDownloadedQuality,
    ]
  );
  // Replay after the end card. The server session was already closed as
  // "completed" when playback ended, so a raw seek(0) would play on with no
  // heartbeats or progress. Renegotiate a fresh playback session from 0 through
  // the normal playback-info call instead.
  const restart = useCallback(() => {
    loadedForUrl.current = null;
    automaticRecoveryUrlRef.current = null;
    reconnectingRef.current = false;
    reconnectAttemptRef.current = 0;
    setReconnecting(false);
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    pendingQualitySwitchRef.current = null;
    latestUserSeekRef.current = 0;
    latestPlaybackRef.current.positionMs = 0;
    negotiationRequestRef.current = replayNegotiationParams(negotiationRequestRef.current);
    void stopActiveSession("user_stopped").finally(() => {
      setRetryCount((n) => n + 1);
    });
  }, [stopActiveSession]);
  const retryNegotiation = useCallback(() => {
    negotiationAutoRetryRef.current = 0;
    loadedForUrl.current = null;
    automaticRecoveryUrlRef.current = null;
    reconnectingRef.current = false;
    reconnectAttemptRef.current = 0;
    setReconnecting(false);
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
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
    reconnecting,
    qualityError,
    selectQuality,
    retryNegotiation,
    restart,
    getSessionId: () => activeSessionIdRef.current,
  };
}
