import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import type { PlayarrCastCredentials, PlayarrCastStateMessage } from "@playarr-tv/cast-protocol";
import { PLAYARR_CAST_PROTOCOL_VERSION } from "@playarr-tv/cast-protocol";
import {
  usePlaybackEngine,
  type PlaybackLaunchSettings,
} from "../lib/usePlaybackEngine";
import { useServerAccessToken, useServerClient } from "../lib/ApiClientProvider";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import { useLanguage } from "../lib/i18n/LanguageProvider";
import { watchInlineMusicHost } from "../lib/inlineMusicHost";
import {
  navigationOriginFromState,
  type NavigationOrigin,
} from "../lib/navigationLayer";
import {
  pickSuggestions,
  resolveEndScreenKind,
  workIdFromDetailRoute,
} from "../lib/endScreen";
import { EndScreen } from "../components/player/EndScreen";
import type { Work } from "@playarr-tv/api-client";
import { advanceMusicPlaybackLifecycle } from "../lib/musicPlaybackLifecycle";
import { CastProvider, useCast } from "../lib/cast/CastProvider";
import { CastUnavailableError } from "../lib/cast/castSdk";
import { ensureDelegatedCastCredentials, persistRotatedDelegatedCastCredentials } from "../lib/cast/delegatedDeviceAuth";
import { setRemotePlayer } from "../lib/remote/playerBridge";
import { PlayOnDeviceDialog } from "../components/remote/PlayOnDeviceDialog";
import { buildPlayarrCastLoadRequest, requestPlayarrCastLoad } from "../lib/cast/castLoad";
import {
  sendPlayarrCastMessage,
  subscribeToPlayarrCastMessages,
  waitForFirstPlayarrCastMessage,
} from "../lib/cast/castMessages";
import {
  InlineMusicMiniPlayer,
  PlayerCloseButton,
  PlayerSurface,
  type PlayerMusicContext,
  type PlayerPlaylistItem,
} from "../components/player/PlayerSurface";
import {
  ErrorIcon,
  LockIcon,
  MaximiseIcon,
  SpinnerIcon,
} from "../components/player/PlayerIcons";
import { Button } from "../components/ui";

export interface PlayerLocationState {
  /** Server that owns the selected media file; omitted for the primary server. */
  serverUrl?: string;
  /** Set by `WorkDetailPage`'s Play link so the tab shows the real title instead of a generic one. */
  title?: string;
  /** Exact app detail route that launched playback. */
  backTo?: string;
  /** The detail page's own parent, restored when playback returns to it. */
  detailParentBackTo?: string;
  /** Optional explicit chapter offset; takes precedence over saved resume progress. */
  startPositionSeconds?: number;
  /** Episode selection restored when playback returns to series details. */
  episodeId?: string;
  /** Exact playable leaf restored when playback returns to series details. */
  mediaFileId?: string;
  /** Ordered playback context used by the player's playlist and previous/next controls. */
  playlistItems?: PlayerPlaylistItem[];
  /** Immediate history layer that launched this player route. */
  navigationOrigin?: NavigationOrigin;
  /** The detail route's own Home/Library origin, used only by fallback navigation. */
  detailNavigationOrigin?: NavigationOrigin | null;
  /** Movie-specific quality/track choices resolved before playback starts. */
  playbackSettings?: PlaybackLaunchSettings | null;
}

const MOBILE_MUSIC_LAYOUT_QUERY =
  "(max-width: 760px), (max-width: 920px) and (max-height: 500px) and (pointer: coarse)";

function isDetailRoute(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (/^\/(?:movies|series|sites|music)\/[^/?]+$/.test(value) ||
      /^\/search\/[^/?]+(?:\?.*)?$/.test(value) ||
      /^\/folders(?:\?.*)?$/.test(value))
  );
}

function isDetailParentRoute(value: unknown): value is string {
  return (
    value === "/" ||
    value === "/movies" ||
    value === "/series" ||
    value === "/sites" ||
    value === "/music" ||
    (typeof value === "string" && /^\/search(?:\?.*)?$/.test(value))
  );
}

function isPlayerPlaylistItem(value: unknown): value is PlayerPlaylistItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.mediaFileId === "string" &&
    item.mediaFileId.length > 0 &&
    typeof item.title === "string" &&
    item.title.length > 0 &&
    (item.subtitle === undefined || typeof item.subtitle === "string") &&
    (item.episodeId === undefined || typeof item.episodeId === "string") &&
    (item.seasonNumber === undefined ||
      (typeof item.seasonNumber === "number" && Number.isFinite(item.seasonNumber))) &&
    (item.episodeNumber === undefined ||
      (typeof item.episodeNumber === "number" && Number.isFinite(item.episodeNumber))) &&
    (item.music === undefined || isPlayerMusicContext(item.music))
  );
}

function isPlayerMusicContext(value: unknown): value is PlayerMusicContext {
  if (!value || typeof value !== "object") return false;
  const context = value as Record<string, unknown>;
  const artworkWork = context.artworkWork;
  return (
    typeof context.artistName === "string" &&
    typeof context.albumTitle === "string" &&
    Boolean(artworkWork) &&
    typeof artworkWork === "object" &&
    typeof (artworkWork as Record<string, unknown>).id === "string" &&
    Array.isArray((artworkWork as Record<string, unknown>).images)
  );
}

function isPlaybackLaunchSettings(value: unknown): value is PlaybackLaunchSettings {
  if (!value || typeof value !== "object") return false;
  const settings = value as Record<string, unknown>;
  return (
    typeof settings.qualityId === "string" &&
    (settings.profile === null || typeof settings.profile === "string") &&
    typeof settings.forceTranscode === "boolean" &&
    (settings.audioTrackId === null || typeof settings.audioTrackId === "string") &&
    (settings.audioStreamIndex === null ||
      (typeof settings.audioStreamIndex === "number" &&
        Number.isInteger(settings.audioStreamIndex))) &&
    (settings.subtitleTrackId === null ||
      typeof settings.subtitleTrackId === "string")
  );
}

/**
 * Standalone-web playback surface. Calls the real
 * `GET /api/v1/playback/{media_file_id}` negotiation endpoint via
 * `usePlaybackEngine`, then either renders a real, specific error state (a
 * failed negotiation never reaches a `<video>` element at all) or the real
 * custom player (`PlayerSurface`) once a source is ready.
 *
 * `usePlaybackEngine` attaches `@playarr-tv/player-shaka`'s
 * `ShakaPlaybackEngine` -- the same adapter the webOS/VIDAA TV shells use,
 * via the shared `PlaybackEngine` interface from `@playarr-tv/player-core`
 * -- rather than a second, web-only playback pipeline, so Playarr Web stays
 * on the same tested engine as the rest of the Playarr client family.
 *
 * `mediaFileId` is the real, resolved `MediaFile` id from
 * `WorkDetailSchema.media_file_id` -- see `WorkDetail.tsx`, which only
 * links here once that field is non-null.
 *
 * Wrapped in `<CastProvider>` here (not at the app shell) -- casting is
 * only ever relevant while a player is mounted, and this is the one
 * component that needs `useCast()`.
 */
export function PlayerPage(props: PlayerPageProps) {
  return (
    <CastProvider>
      <PlayerPageInner {...props} />
    </CastProvider>
  );
}

interface PlayerPageProps {
  mediaFileId: string;
  locationState: PlayerLocationState | null;
  minimised: boolean;
  inlineMusic?: boolean;
  onClose: () => void;
  onMaximise: () => void;
  onSessionChange: (
    mediaFileId: string,
    locationState: PlayerLocationState
  ) => void;
}

function PlayerPageInner({
  mediaFileId,
  locationState,
  minimised,
  inlineMusic = false,
  onClose,
  onMaximise,
  onSessionChange,
}: PlayerPageProps) {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [inlineMusicHost, setInlineMusicHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!inlineMusic) {
      setInlineMusicHost(null);
      return;
    }

    const media = window.matchMedia(MOBILE_MUSIC_LAYOUT_QUERY);
    return watchInlineMusicHost(media, (nextHost) => {
      setInlineMusicHost((currentHost) =>
        currentHost === nextHost ? currentHost : nextHost
      );
    });
  }, [inlineMusic]);
  const navigationOrigin = navigationOriginFromState(locationState);
  const title = locationState?.title;
  const backTo = isDetailRoute(locationState?.backTo) ? locationState.backTo : "/";
  const detailParentBackTo = isDetailParentRoute(locationState?.detailParentBackTo)
    ? locationState.detailParentBackTo
    : undefined;
  const startPositionSeconds =
    typeof locationState?.startPositionSeconds === "number" &&
    Number.isFinite(locationState.startPositionSeconds) &&
    locationState.startPositionSeconds >= 0
      ? locationState.startPositionSeconds
      : undefined;
  const playbackSettings = isPlaybackLaunchSettings(locationState?.playbackSettings)
    ? locationState.playbackSettings
    : null;
  const playlistItems = useMemo<PlayerPlaylistItem[]>(() => {
    const items = Array.isArray(locationState?.playlistItems)
      ? locationState.playlistItems.filter(isPlayerPlaylistItem)
      : [];
    if (items.some((item) => item.mediaFileId === mediaFileId)) return items;
    return mediaFileId
      ? [
          {
            mediaFileId,
            title: title ?? t("pages.player.nowPlaying"),
            episodeId: locationState?.episodeId,
          },
        ]
      : [];
  }, [locationState?.episodeId, locationState?.playlistItems, mediaFileId, title]);
  const activePlaylistIndex = Math.max(
    0,
    playlistItems.findIndex((item) => item.mediaFileId === mediaFileId)
  );
  const activePlaylistItem = playlistItems[activePlaylistIndex];
  const isMusicPlayback =
    Boolean(activePlaylistItem?.music) ||
    /^\/music\/[^/?]+$/.test(locationState?.backTo ?? "");
  const shouldStopPlaybackOnPause = isMusicPlayback && !inlineMusic;
  useDocumentTitle(title ?? t("pages.player.nowPlaying"), !minimised);
  const player = usePlaybackEngine(
    mediaFileId,
    startPositionSeconds,
    playbackSettings,
    locationState?.serverUrl
  );
  const playerTitle = title ?? activePlaylistItem?.title ?? t("pages.player.nowPlaying");
  const miniPlayerMusicContext =
    activePlaylistItem?.music ?? playlistItems.find((item) => item.music)?.music;
  const durationSeconds = player.engineState.durationSeconds;
  const positionSeconds = player.engineState.currentTimeSeconds;
  const progressPercentage =
    durationSeconds > 0
      ? Math.min(100, Math.max(0, (positionSeconds / durationSeconds) * 100))
      : 0;
  const inlineMiniPlayer = inlineMusic ? (
      <InlineMusicMiniPlayer
        context={miniPlayerMusicContext}
        title={playerTitle}
        positionSeconds={positionSeconds}
        durationSeconds={durationSeconds}
        progressPercentage={progressPercentage}
        onMaximise={onMaximise}
      />
    ) : null;
  const musicPlaybackStateRef = useRef({
    mediaFileId,
    hasPlayed: false,
  });
  const { negotiation, retryNegotiation } = player;
  const handleBack = useCallback(() => {
    onClose();
    if (navigationOrigin) {
      navigate(-1);
      return;
    }
    navigate(backTo, {
      replace: true,
      state: detailParentBackTo
        ? {
            backTo: detailParentBackTo,
            episodeId: activePlaylistItem?.episodeId ?? locationState?.episodeId,
            mediaFileId: activePlaylistItem?.mediaFileId ?? locationState?.mediaFileId,
            navigationOrigin: locationState?.detailNavigationOrigin ?? undefined,
          }
        : undefined,
    });
  }, [
    activePlaylistItem?.episodeId,
    activePlaylistItem?.mediaFileId,
    backTo,
    detailParentBackTo,
    locationState?.episodeId,
    locationState?.detailNavigationOrigin,
    locationState?.mediaFileId,
    navigate,
    navigationOrigin,
    onClose,
  ]);
  const handleMinimise = useCallback(() => {
    navigate(backTo, {
      replace: true,
      state: detailParentBackTo
        ? {
            backTo: detailParentBackTo,
            episodeId: activePlaylistItem?.episodeId ?? locationState?.episodeId,
            mediaFileId: activePlaylistItem?.mediaFileId ?? locationState?.mediaFileId,
            navigationOrigin: locationState?.detailNavigationOrigin ?? undefined,
          }
        : undefined,
    });
  }, [
    activePlaylistItem?.episodeId,
    activePlaylistItem?.mediaFileId,
    backTo,
    detailParentBackTo,
    locationState?.detailNavigationOrigin,
    locationState?.episodeId,
    locationState?.mediaFileId,
    navigate,
  ]);
  const navigateToPlaylistItem = useCallback(
    (item: PlayerPlaylistItem) => {
      const nextLocationState = {
        serverUrl: locationState?.serverUrl,
        title: item.subtitle ? `${item.subtitle} · ${item.title}` : item.title,
        backTo,
        detailParentBackTo,
        episodeId: item.episodeId,
        mediaFileId: item.mediaFileId,
        playlistItems,
        navigationOrigin: navigationOrigin ?? undefined,
        detailNavigationOrigin: locationState?.detailNavigationOrigin,
        playbackSettings,
      } satisfies PlayerLocationState;
      if (minimised) {
        onSessionChange(item.mediaFileId, nextLocationState);
        return;
      }
      navigate(`/player/${item.mediaFileId}`, {
        replace: true,
        state: nextLocationState,
      });
    },
    [
      backTo,
      detailParentBackTo,
      locationState?.detailNavigationOrigin,
      locationState?.serverUrl,
      minimised,
      navigate,
      navigationOrigin,
      onSessionChange,
      playbackSettings,
      playlistItems,
    ]
  );
  const handleSelectPlaylistItem = useCallback(
    (index: number) => {
      const item = playlistItems[index];
      if (item) navigateToPlaylistItem(item);
    },
    [navigateToPlaylistItem, playlistItems]
  );
  const handlePrevious = useCallback(() => {
    const previous = playlistItems[activePlaylistIndex - 1];
    if (previous) navigateToPlaylistItem(previous);
  }, [activePlaylistIndex, navigateToPlaylistItem, playlistItems]);
  const handleNext = useCallback(() => {
    const next = playlistItems[activePlaylistIndex + 1];
    if (next) navigateToPlaylistItem(next);
  }, [activePlaylistIndex, navigateToPlaylistItem, playlistItems]);

  // Phone remote and handoff (docs/architecture/remote-control.md): expose this
  // player to the remote host so commands can drive it and its position can be
  // reported/handed off. Only the home server's playback is controllable.
  const playerRef = useRef(player);
  playerRef.current = player;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const nextRef = useRef(handleNext);
  nextRef.current = handleNext;
  const previousRef = useRef(handlePrevious);
  previousRef.current = handlePrevious;
  const hasNextRef = useRef(activePlaylistIndex < playlistItems.length - 1);
  hasNextRef.current = activePlaylistIndex < playlistItems.length - 1;
  const hasPreviousRef = useRef(activePlaylistIndex > 0);
  hasPreviousRef.current = activePlaylistIndex > 0;
  const remoteServerUrl = locationState?.serverUrl;
  useEffect(() => {
    if (!mediaFileId || remoteServerUrl) return;
    const engine = () => playerRef.current.engineState;
    const pickTrack = <T extends { id: string; language?: string }>(
      tracks: T[],
      language: string
    ) =>
      tracks.find((track) => track.language?.toLowerCase().startsWith(language.toLowerCase()));
    setRemotePlayer({
      mediaFileId,
      snapshot: () => ({
        positionMs: Math.round(engine().currentTimeSeconds * 1000),
        durationMs: Math.round(engine().durationSeconds * 1000),
        paused: engine().state !== "playing" && engine().state !== "buffering",
      }),
      isReady: () =>
        engine().durationSeconds > 0 &&
        ["ready", "playing", "paused", "buffering"].includes(engine().state),
      hasStarted: () => ["playing", "paused"].includes(engine().state) && engine().durationSeconds > 0,
      play: () => playerRef.current.play(),
      pause: () => playerRef.current.pause(),
      seekToMs: (ms) => playerRef.current.seek(ms / 1000),
      setVolume: (volume) => playerRef.current.setVolume(volume),
      stop: () => closeRef.current(),
      next: () => {
        if (hasNextRef.current) nextRef.current();
      },
      previous: () => {
        if (hasPreviousRef.current) previousRef.current();
      },
      setAudioLanguage: (language) => {
        const track = pickTrack(playerRef.current.audioTracks, language);
        if (!track) return false;
        playerRef.current.selectAudioTrack(track.id);
        return true;
      },
      setSubtitleLanguage: (language) => {
        if (language === null) {
          playerRef.current.selectSubtitleTrack(null);
          return true;
        }
        const track = pickTrack(playerRef.current.subtitleTracks, language);
        if (!track) return false;
        playerRef.current.selectSubtitleTrack(track.id);
        return true;
      },
    });
    return () => setRemotePlayer(null);
  }, [mediaFileId, remoteServerUrl]);
  const [playOnOpen, setPlayOnOpen] = useState(false);

  useEffect(() => {
    const nextPlaybackState = advanceMusicPlaybackLifecycle(
      musicPlaybackStateRef.current,
      mediaFileId,
      player.engineState.state,
      shouldStopPlaybackOnPause
    );
    musicPlaybackStateRef.current = nextPlaybackState.lifecycle;
    if (nextPlaybackState.shouldStop) {
      onClose();
      return;
    }
    if (
      player.engineState.state !== "ended" ||
      !isMusicPlayback
    ) {
      return;
    }
    const next = playlistItems[activePlaylistIndex + 1];
    if (!next) return;

    const frame = window.requestAnimationFrame(() => navigateToPlaylistItem(next));
    return () => window.cancelAnimationFrame(frame);
  }, [
    activePlaylistIndex,
    isMusicPlayback,
    mediaFileId,
    navigateToPlaylistItem,
    onClose,
    player.engineState.state,
    playlistItems,
    shouldStopPlaybackOnPause,
  ]);

  // --- End-of-playback card (docs/architecture/end-of-playback.md) ---------
  const nextPlaylistItem = playlistItems[activePlaylistIndex + 1];
  const endScreenKind = resolveEndScreenKind({
    engineState: player.engineState.state,
    minimised,
    inlineMusic,
    isMusic: isMusicPlayback,
    hasNext: Boolean(nextPlaylistItem),
  });
  const finishedWorkId = workIdFromDetailRoute(locationState?.backTo);
  const serverClient = useServerClient(locationState?.serverUrl);
  const [suggestions, setSuggestions] = useState<Work[]>([]);
  const suggestionsLoadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!endScreenKind || !finishedWorkId) return;
    if (suggestionsLoadedFor.current === finishedWorkId) return;
    suggestionsLoadedFor.current = finishedWorkId;
    let cancelled = false;
    void serverClient.getSimilarWorks(finishedWorkId, 12).then(
      (works) => {
        if (!cancelled) setSuggestions(pickSuggestions(works, finishedWorkId));
      },
      // 404 (no embedding yet) or any failure: the row is simply hidden.
      () => {
        if (!cancelled) setSuggestions([]);
      }
    );
    return () => {
      cancelled = true;
      suggestionsLoadedFor.current = null;
    };
  }, [endScreenKind, finishedWorkId, serverClient]);
  // New playback session from 0: the ended one is already closed as completed.
  const handleEndReplay = useCallback(() => player.restart(), [player]);
  const handleEndSuggestion = useCallback(
    (route: string) => {
      onClose();
      navigate(route);
    },
    [navigate, onClose]
  );

  useEffect(() => {
    if (minimised) return;
    const handleBackKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const isBack =
        event.key === "Escape" ||
        event.key === "BrowserBack" ||
        event.key === "GoBack" ||
        event.keyCode === 10009 ||
        event.keyCode === 461;
      if (!isBack) return;
      const webkitDocument = document as Document & {
        webkitFullscreenElement?: Element | null;
        webkitExitFullscreen?: () => Promise<void> | void;
      };
      const fullscreenElement =
        document.fullscreenElement ?? webkitDocument.webkitFullscreenElement;
      const video = document.querySelector<HTMLVideoElement>(".player-video") as
        | (HTMLVideoElement & {
            webkitDisplayingFullscreen?: boolean;
            webkitExitFullscreen?: () => void;
          })
        | null;
      if (fullscreenElement || video?.webkitDisplayingFullscreen) {
        event.preventDefault();
        event.stopPropagation();
        if (document.fullscreenElement && document.exitFullscreen) {
          void document.exitFullscreen();
        } else if (webkitDocument.webkitFullscreenElement) {
          void webkitDocument.webkitExitFullscreen?.();
        } else {
          video?.webkitExitFullscreen?.();
        }
        return;
      }
      event.preventDefault();
      handleBack();
    };
    window.addEventListener("keydown", handleBackKey);
    return () => window.removeEventListener("keydown", handleBackKey);
  }, [handleBack, minimised]);

  // --- Chromecast ---------------------------------------------------------
  const { available: castAvailable, session: castSession, requestSession, endSession } = useCast();
  const castClient = useServerClient(locationState?.serverUrl);
  const getCastSenderAccessToken = useServerAccessToken(locationState?.serverUrl);
  const castServerBaseUrl = useMemo(() => castClient.resolveUrl("/"), [castClient]);
  const [castState, setCastState] = useState<PlayarrCastStateMessage | null>(null);
  const [castCredentials, setCastCredentials] = useState<PlayarrCastCredentials | null>(null);
  const lastCastPositionSecondsRef = useRef<number | null>(null);
  const previousCastSessionRef = useRef<typeof castSession>(null);
  const castConnected = castSession !== null;
  const castDeviceName = castSession?.getCastDevice().friendlyName ?? null;

  // Subscribes to the custom channel for the lifetime of a connected
  // session -- an external system to synchronize with, not derivable state.
  useEffect(() => {
    if (!castSession) return;
    return subscribeToPlayarrCastMessages(castSession, (message) => {
      if (message.type === "state") {
        setCastState(message);
        lastCastPositionSecondsRef.current = message.positionMs / 1000;
      } else if (message.type === "auth.rotated") {
        persistRotatedDelegatedCastCredentials(castServerBaseUrl, message.credentials);
        setCastCredentials(message.credentials);
      }
    });
  }, [castSession, castServerBaseUrl]);

  // On cast end (however it happened -- the viewer's own disconnect, the
  // receiver going away, an error): resume locally at the receiver's last
  // reported position rather than wherever the local engine was left
  // sitting since it was paused for the handoff.
  useEffect(() => {
    const previousSession = previousCastSessionRef.current;
    previousCastSessionRef.current = castSession;
    if (previousSession && !castSession) {
      const resumeAtSeconds = lastCastPositionSecondsRef.current;
      if (resumeAtSeconds !== null) player.seek(resumeAtSeconds);
      player.play();
      lastCastPositionSecondsRef.current = null;
      setCastState(null);
      setCastCredentials(null);
    }
  }, [castSession, player]);

  // Access tokens live 15 minutes; this keeps the receiver's copy fresh on
  // its own timer, independent of any single request, rather than waiting
  // for it to expire and rely on the receiver's own reactive refresh.
  useEffect(() => {
    if (!castSession || !castCredentials) return;
    const msUntilRefresh = Math.max(
      5_000,
      castCredentials.accessTokenExpiresAt - Date.now() - 2 * 60_000
    );
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const refreshed = await ensureDelegatedCastCredentials({
            apiBaseUrl: castServerBaseUrl,
            fetchImpl: (input) => fetch(input),
            getSenderAccessToken: getCastSenderAccessToken,
          });
          setCastCredentials(refreshed);
          await sendPlayarrCastMessage(castSession, {
            protocolVersion: PLAYARR_CAST_PROTOCOL_VERSION,
            type: "auth.update",
            credentials: refreshed,
          });
        } catch {
          // Best-effort -- the receiver's own reactive refresh-on-401
          // (mirroring `ensureAccessToken`) is the backstop if this
          // proactive push is ever missed.
        }
      })();
    }, msUntilRefresh);
    return () => window.clearTimeout(timer);
  }, [castSession, castCredentials, castServerBaseUrl, getCastSenderAccessToken]);

  const handleToggleCast = useCallback(async (): Promise<void> => {
    if (castSession) {
      // A click while connected means "stop casting." Tell the receiver
      // why first (so it closes its own playback session with the right
      // reason) before tearing down the native session underneath it.
      void sendPlayarrCastMessage(castSession, {
        protocolVersion: PLAYARR_CAST_PROTOCOL_VERSION,
        type: "session.end",
        reason: "user_stopped",
      }).catch(() => undefined);
      endSession();
      return;
    }

    const newSession = await requestSession();
    if (!newSession) return; // the viewer dismissed the device picker -- not an error

    if (!activePlaylistItem) {
      throw new Error("No media item is loaded to cast.");
    }

    // Stop the LOCAL playback session first: once a cast session exists the
    // receiver becomes the sole writer of watch-progress for this media
    // file, so the local engine must not keep sending its own background
    // heartbeats. `pause()` halts local decode immediately and, via
    // `usePlaybackEngine`'s own pause-triggered flush, persists one last
    // accurate position -- see this component's build report for why this
    // is the closest available substitute for a dedicated "close this
    // session" call, which `usePlaybackEngine` does not expose publicly.
    player.pause();

    const credentials = await ensureDelegatedCastCredentials({
      apiBaseUrl: castServerBaseUrl,
      fetchImpl: (input) => fetch(input),
      getSenderAccessToken: getCastSenderAccessToken,
    });
    setCastCredentials(credentials);

    const request = buildPlayarrCastLoadRequest({
      serverBaseUrl: castServerBaseUrl,
      credentials,
      item: activePlaylistItem,
      startPositionSeconds: player.engineState.currentTimeSeconds,
      durationSeconds: player.engineState.durationSeconds,
      autoplay: true,
      selectedAudioTrackId: player.selectedAudioTrackId,
      selectedSubtitleTrackId: player.selectedSubtitleTrackId,
      audioTracks: player.audioTracks,
      subtitleTracks: player.subtitleTracks,
      activeQualityId: player.activeQualityId,
      qualityOptions: player.qualityOptions,
      queue: playlistItems.slice(activePlaylistIndex + 1),
      senderLanguage: typeof navigator === "undefined" ? "en" : navigator.language,
    });

    await requestPlayarrCastLoad(newSession, request);

    // Give a fast-failing receiver (e.g. `insecure_server`, discovered as
    // soon as it tries to negotiate against `castServerBaseUrl`) a short
    // window to surface through this SAME attempt, rather than only ever
    // showing up later, disconnected from the click that triggered it.
    const earlyOutcome = await waitForFirstPlayarrCastMessage(
      newSession,
      (message) => message.type === "error",
      { timeoutMs: 4000 }
    );
    if (earlyOutcome?.type === "error") {
      if (earlyOutcome.code === "insecure_server") {
        throw new CastUnavailableError("insecure-server", earlyOutcome.message);
      }
      throw new Error(earlyOutcome.message || `Cast error: ${earlyOutcome.code}`);
    }

    void sendPlayarrCastMessage(newSession, {
      protocolVersion: PLAYARR_CAST_PROTOCOL_VERSION,
      type: "state.request",
    }).catch(() => undefined);
  }, [
    activePlaylistIndex,
    activePlaylistItem,
    castServerBaseUrl,
    castSession,
    endSession,
    getCastSenderAccessToken,
    player,
    playlistItems,
    requestSession,
  ]);
  // --- /Chromecast ---------------------------------------------------------

  if (negotiation.kind === "error") {
    if (minimised) {
      return (
        <MinimisedPlayerStatus
          title={title ?? activePlaylistItem?.title ?? t("pages.player.nowPlaying")}
          status={t("pages.player.playbackUnavailable")}
          onMaximise={onMaximise}
        />
      );
    }
    return (
      <div className="player-page">
        <div className="player-shell player-shell-placeholder">
          <PlayerCloseButton onClose={handleBack} />
          <div className="player-overlay player-overlay-status" role="alert" aria-live="assertive">
            <div className="player-status-card player-status-card-error">
              {negotiation.forbidden ? (
                <LockIcon className="player-error-icon" />
              ) : (
                <ErrorIcon className="player-error-icon" />
              )}
              <p className="player-status-kicker">
                {negotiation.forbidden
                  ? t("pages.player.accessRestricted")
                  : t("pages.player.playbackUnavailable")}
              </p>
              <p className="player-error-title">
                {negotiation.forbidden
                  ? t("pages.player.noStreamingAccess")
                  : t("pages.player.couldNotStart")}
              </p>
              <p className="player-error-message">{negotiation.message}</p>
              <div className="player-error-actions">
                {!negotiation.forbidden && (
                  <Button type="button" variant="primary" onClick={retryNegotiation}>
                    {t("pages.player.tryAgain")}
                  </Button>
                )}
                <Button type="button" className="on-player" onClick={handleBack}>
                  {t("pages.player.close")}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const playerSurface = (
    <div
      className={`player-page${minimised ? " is-minimised" : ""}${
        inlineMusic ? " is-inline-music" : ""
      }`}
    >
      <PlayerSurface
        player={player}
        title={playerTitle}
        minimised={minimised}
        inlineMusic={inlineMusic}
        playbackStarted={musicPlaybackStateRef.current.hasPlayed}
        stopPlaybackOnPause={shouldStopPlaybackOnPause}
        onBack={handleBack}
        onStop={onClose}
        onMinimise={handleMinimise}
        onMaximise={onMaximise}
        playlistItems={playlistItems}
        activePlaylistIndex={activePlaylistIndex}
        onSelectPlaylistItem={handleSelectPlaylistItem}
        onPrevious={activePlaylistIndex > 0 ? handlePrevious : undefined}
        onNext={activePlaylistIndex < playlistItems.length - 1 ? handleNext : undefined}
        detailRoute={backTo}
        detailParentRoute={detailParentBackTo ?? "/"}
        castAvailable={castAvailable}
        castConnected={castConnected}
        castDeviceName={castDeviceName}
        castState={castState}
        onToggleCast={handleToggleCast}
        onPlayOnDevice={minimised || remoteServerUrl ? undefined : () => setPlayOnOpen(true)}
      />
      {playOnOpen && <PlayOnDeviceDialog onClose={() => setPlayOnOpen(false)} />}
      {endScreenKind && (
        <EndScreen
          kind={endScreenKind}
          title={activePlaylistItem?.title ?? playerTitle}
          subtitle={activePlaylistItem?.subtitle}
          next={nextPlaylistItem}
          suggestions={suggestions}
          onReplay={handleEndReplay}
          onExit={handleBack}
          onPlayNow={handleNext}
          onSelectSuggestion={handleEndSuggestion}
        />
      )}
    </div>
  );

  return (
    <>
      {inlineMusicHost ? createPortal(playerSurface, inlineMusicHost) : playerSurface}
      {inlineMiniPlayer}
    </>
  );
}

function MinimisedPlayerStatus({
  title,
  status,
  onMaximise,
}: {
  title: string;
  status: string;
  onMaximise: () => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="player-page is-minimised">
      <div className="player-shell player-shell-placeholder player-shell-minimised">
        <button
          type="button"
          className="mini-player-hit-target"
          data-navigation-focus-key="shell:mini-player"
          onClick={onMaximise}
          aria-label={t("pages.player.maximiseTitle", { title })}
        />
        <div className="mini-player-details" aria-hidden="true">
          <span className="mini-player-title">{title}</span>
          <span className="mini-player-time">{status}</span>
          <span className="mini-player-track">
            <span style={{ width: 0 }} />
          </span>
        </div>
        <span className="mini-player-maximise" aria-hidden="true">
          <MaximiseIcon />
        </span>
      </div>
    </div>
  );
}
