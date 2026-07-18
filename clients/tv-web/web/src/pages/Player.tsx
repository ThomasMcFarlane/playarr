import { useCallback, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  usePlaybackEngine,
  type PlaybackLaunchSettings,
} from "../lib/usePlaybackEngine";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import { useLanguage } from "../lib/i18n/LanguageProvider";
import {
  navigationOriginFromState,
  type NavigationOrigin,
} from "../lib/navigationLayer";
import { advanceMusicPlaybackLifecycle } from "../lib/musicPlaybackLifecycle";
import {
  InlineMusicMiniPlayer,
  PlayerBackButton,
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

function isDetailRoute(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (/^\/(?:movies|series|sites|music)\/[^/?]+$/.test(value) ||
      /^\/search\/[^/?]+(?:\?.*)?$/.test(value))
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
 * `usePlaybackEngine` attaches `@streamarr-tv/player-shaka`'s
 * `ShakaPlaybackEngine` -- the same adapter the webOS/VIDAA TV shells use,
 * via the shared `PlaybackEngine` interface from `@streamarr-tv/player-core`
 * -- rather than a second, web-only playback pipeline, so Playarr Web stays
 * on the same tested engine as the rest of the Playarr client family.
 *
 * `mediaFileId` is the real, resolved `MediaFile` id from
 * `WorkDetailSchema.media_file_id` -- see `WorkDetail.tsx`, which only
 * links here once that field is non-null.
 */
export function PlayerPage({
  mediaFileId,
  locationState,
  minimised,
  inlineMusic = false,
  onClose,
  onMaximise,
  onSessionChange,
}: {
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
}) {
  const navigate = useNavigate();
  const { t } = useLanguage();
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

  if (negotiation.kind === "loading") {
    if (minimised) {
      if (inlineMiniPlayer) return inlineMiniPlayer;
      return (
        <MinimisedPlayerStatus
          title={title ?? activePlaylistItem?.title ?? t("pages.player.nowPlaying")}
          status={t("pages.player.preparingPlayback")}
          onMaximise={onMaximise}
        />
      );
    }
    return (
      <div className="player-page">
        <div className="player-shell player-shell-placeholder">
          <PlayerBackButton onBack={handleBack} />
          <div className="player-overlay player-overlay-status">
            <div className="player-status-card" role="status">
              <SpinnerIcon className="player-spinner" />
              <p className="player-status-kicker">{t("pages.player.oneMoment")}</p>
              <p className="player-error-title">{t("pages.player.preparingPlayback")}</p>
              <p className="player-error-message">
                {t("pages.player.preparingMessage")}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

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
          <PlayerBackButton onBack={handleBack} />
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
                  <button type="button" className="btn btn-primary" onClick={retryNegotiation}>
                    {t("pages.player.tryAgain")}
                  </button>
                )}
                <button type="button" className="btn btn-player-secondary" onClick={handleBack}>
                  {t("pages.player.backToDetails")}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
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
        />
      </div>
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
