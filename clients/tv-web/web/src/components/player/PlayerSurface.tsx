import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { Work } from "@streamarr-tv/api-client";
import type { PlaybackEngineController } from "../../lib/usePlaybackEngine";
import { MediaThumbnailArtwork } from "../MediaThumbnailArtwork";
import { useMediaContextMenu } from "../MediaContextMenu";
import { CachedArtworkImage } from "../../lib/artwork";
import { PlayerControls } from "./PlayerControls";
import {
  BackIcon,
  ErrorIcon,
  MaximiseIcon,
  MinimiseIcon,
  SpinnerIcon,
} from "./PlayerIcons";

const SEEK_STEP_SECONDS = 5;
const VOLUME_STEP = 0.05;
const AUTO_HIDE_MS = 3000;

interface WebKitFullscreenDocument extends Document {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
}

interface WebKitFullscreenElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}

interface WebKitFullscreenVideo extends HTMLVideoElement {
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
  webkitDisplayingFullscreen?: boolean;
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

function isPlayerControlTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        ".player-controls, .player-back, .player-minimise, .mini-player-hit-target, .player-overlay-status, .player-playlist-panel, .media-context-drawer"
      )
    )
  );
}

/**
 * The actual playback surface: the `<video>` element, the custom control
 * bar (`PlayerControls`), a gradient scrim, loading/buffering and fatal
 * playback-error overlays, mouse-driven auto-hide, fullscreen, and keyboard
 * shortcuts. Mounted only once negotiation has succeeded -- `Player.tsx`
 * owns the negotiation loading/error states, since those happen before
 * there's any source to attach a video surface to.
 */
export function PlayerBackButton({
  onBack,
  onNavigateToControls,
  onNavigateRight,
  onFocus,
  onBlur,
}: {
  onBack: () => void;
  onNavigateToControls?: () => void;
  onNavigateRight?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
}) {
  return (
    <button
      type="button"
      className="player-back"
      onClick={onBack}
      onFocus={onFocus}
      onBlur={onBlur}
      onKeyDown={(event) => {
        if (onNavigateRight && event.key === "ArrowRight") {
          event.preventDefault();
          event.stopPropagation();
          onNavigateRight();
          return;
        }
        if (onNavigateToControls && event.key === "ArrowDown") {
          event.preventDefault();
          event.stopPropagation();
          onNavigateToControls();
        }
      }}
      aria-label="Back to details"
    >
      <BackIcon />
      <span>Back</span>
    </button>
  );
}

function PlayerMinimiseButton({
  onMinimise,
  onNavigateToBack,
  onNavigateToControls,
  onFocus,
  onBlur,
}: {
  onMinimise: () => void;
  onNavigateToBack: () => void;
  onNavigateToControls: () => void;
  onFocus: () => void;
  onBlur: () => void;
}) {
  return (
    <button
      type="button"
      className="player-minimise"
      onClick={onMinimise}
      onFocus={onFocus}
      onBlur={onBlur}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          event.stopPropagation();
          onNavigateToBack();
        } else if (event.key === "ArrowDown" || event.key === "ArrowRight") {
          event.preventDefault();
          event.stopPropagation();
          onNavigateToControls();
        }
      }}
      aria-label="Minimise player"
    >
      <MinimiseIcon />
      <span>Minimise</span>
    </button>
  );
}

export interface PlayerPlaylistItem {
  mediaFileId: string;
  title: string;
  subtitle?: string;
  episodeId?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  music?: PlayerMusicContext;
}

export interface PlayerMusicContext {
  artistName: string;
  albumTitle: string;
  artworkWork: Pick<Work, "id" | "images">;
}

const MUSIC_VISUALISER_BARS = Array.from({ length: 36 }, (_, index) => {
  const distanceFromCentre = Math.abs(index - 17.5) / 17.5;
  const centreLift = 1 - distanceFromCentre * 0.54;
  return {
    delay: -((index * 83) % 740),
    peak: Math.max(0.34, centreLift * (0.68 + ((index * 17) % 29) / 100)),
    rest: 0.1 + ((index * 7) % 10) / 100,
    speed: 760 + ((index * 97) % 520),
  };
});

function MusicPlayerVisual({
  context,
  mediaFileId,
  title,
  playing,
}: {
  context: PlayerMusicContext;
  mediaFileId: string;
  title: string;
  playing: boolean;
}) {
  return (
    <div
      className={`player-music-visual${playing ? " is-playing" : " is-settled"}`}
      aria-hidden="true"
    >
      <div className="player-music-backdrop">
        <CachedArtworkImage
          work={context.artworkWork}
          kinds={["backdrop", "poster"]}
          alt=""
          fallback={<span />}
        />
      </div>
      <div className="player-music-colour-wash" />
      <div className="player-music-stage">
        <div className="player-music-cover">
          <MediaThumbnailArtwork
            mediaFileId={mediaFileId}
            positionMs={0}
            fallback={null}
            className="player-music-cover-media"
          >
            <CachedArtworkImage
              work={context.artworkWork}
              kinds={["poster", "backdrop"]}
              alt=""
              fallback={
                <span className="player-music-cover-fallback">
                  {context.albumTitle.slice(0, 1)}
                </span>
              }
            />
            <div className="player-music-visualiser">
              {MUSIC_VISUALISER_BARS.map((bar, index) => (
                <i
                  key={index}
                  style={
                    {
                      "--music-bar-delay": `${bar.delay}ms`,
                      "--music-bar-peak": bar.peak,
                      "--music-bar-rest": bar.rest,
                      "--music-bar-speed": `${bar.speed}ms`,
                    } as CSSProperties
                  }
                />
              ))}
            </div>
          </MediaThumbnailArtwork>
          <div className="player-music-cover-glass" />
        </div>
        <div className="player-music-copy">
          <span>{context.albumTitle}</span>
          <strong>{title}</strong>
          <small>{context.artistName}</small>
        </div>
      </div>
    </div>
  );
}

export function PlayerSurface({
  player,
  title,
  minimised = false,
  onBack,
  onMinimise,
  onMaximise,
  playlistItems = [],
  activePlaylistIndex = 0,
  onSelectPlaylistItem,
  onPrevious,
  onNext,
  detailRoute = "/",
  detailParentRoute = "/",
}: {
  player: PlaybackEngineController;
  title: string;
  minimised?: boolean;
  onBack: () => void;
  onMinimise: () => void;
  onMaximise: () => void;
  playlistItems?: PlayerPlaylistItem[];
  activePlaylistIndex?: number;
  onSelectPlaylistItem?: (index: number) => void;
  onPrevious?: () => void;
  onNext?: () => void;
  detailRoute?: string;
  detailParentRoute?: string;
}) {
  const {
    videoRef,
    negotiation,
    engineState,
    togglePlay,
    seek,
    setVolume,
    setMuted,
    retryNegotiation,
    qualityOptions,
    activeQualityId,
    qualitySwitching,
    qualityError,
    selectQuality,
    subtitleSwitching,
    subtitleError,
  } = player;

  const shellRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<number | undefined>(undefined);
  const initialFocusPendingRef = useRef(true);
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsPinned, setControlsPinned] = useState(false);
  const [backButtonFocused, setBackButtonFocused] = useState(false);
  const [minimiseButtonFocused, setMinimiseButtonFocused] = useState(false);
  const [playlistOpen, setPlaylistOpen] = useState(false);
  const activePlaylistItem = playlistItems[activePlaylistIndex];
  const musicContext = activePlaylistItem?.music;
  const playlistContext = useMediaContextMenu();
  const interactionPinned =
    controlsPinned ||
    backButtonFocused ||
    minimiseButtonFocused ||
    playlistOpen ||
    playlistContext.isOpen ||
    qualitySwitching ||
    subtitleSwitching;

  const closePlaylist = useCallback((restoreTriggerFocus = true) => {
    setPlaylistOpen(false);
    if (!restoreTriggerFocus) {
      window.requestAnimationFrame(() => videoRef.current?.focus({ preventScroll: true }));
      return;
    }
    window.requestAnimationFrame(() => {
      shellRef.current
        ?.querySelector<HTMLButtonElement>("[data-player-playlist-button]")
        ?.focus({ preventScroll: true });
    });
  }, []);

  const openPlaylist = useCallback(() => {
    if (playlistItems.length === 0) return;
    setShowControls(true);
    setPlaylistOpen(true);
  }, [playlistItems.length]);

  useEffect(() => {
    if (!playlistOpen) return;
    const frame = window.requestAnimationFrame(() => {
      const panel = shellRef.current?.querySelector<HTMLElement>(".player-playlist-panel");
      const active =
        panel?.querySelector<HTMLButtonElement>('[aria-current="true"]') ??
        panel?.querySelector<HTMLButtonElement>(".player-playlist-item");
      active?.focus({ preventScroll: true });
      active?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activePlaylistIndex, playlistOpen]);

  const focusSeekControl = useCallback(() => {
    setShowControls(true);
    window.requestAnimationFrame(() => {
      shellRef.current?.querySelector<HTMLElement>(".player-seek-track")?.focus();
    });
  }, []);

  const scheduleHide = useCallback(() => {
    window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => setShowControls(false), AUTO_HIDE_MS);
  }, []);

  const handleActivity = useCallback(() => {
    setShowControls(true);
    if (engineState.state === "playing" && !interactionPinned) scheduleHide();
  }, [engineState.state, interactionPinned, scheduleHide]);

  // Auto-hide only while actively playing -- paused/buffering/error states
  // always keep the control bar visible, matching the standard pattern
  // (nothing to "hide from" when nothing is moving).
  useEffect(() => {
    if (minimised) {
      window.clearTimeout(hideTimerRef.current);
      setShowControls(false);
      setPlaylistOpen(false);
      return;
    }
    if (engineState.state === "playing" && !interactionPinned) {
      scheduleHide();
    } else {
      window.clearTimeout(hideTimerRef.current);
      setShowControls(true);
    }
    return () => window.clearTimeout(hideTimerRef.current);
  }, [engineState.state, interactionPinned, minimised, scheduleHide]);

  useEffect(() => {
    const handleChange = () => {
      const webkitDocument = document as WebKitFullscreenDocument;
      const video = videoRef.current as WebKitFullscreenVideo | null;
      setIsFullscreen(
        document.fullscreenElement === shellRef.current ||
          webkitDocument.webkitFullscreenElement === shellRef.current ||
          video?.webkitDisplayingFullscreen === true
      );
    };
    document.addEventListener("fullscreenchange", handleChange);
    document.addEventListener("webkitfullscreenchange", handleChange);
    const video = videoRef.current;
    video?.addEventListener("webkitbeginfullscreen", handleChange);
    video?.addEventListener("webkitendfullscreen", handleChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleChange);
      document.removeEventListener("webkitfullscreenchange", handleChange);
      video?.removeEventListener("webkitbeginfullscreen", handleChange);
      video?.removeEventListener("webkitendfullscreen", handleChange);
    };
  }, []);

  useEffect(() => {
    if (minimised) return;
    const frame = window.requestAnimationFrame(() => {
      if (engineState.state === "playing" || engineState.state === "buffering") {
        videoRef.current?.focus({ preventScroll: true });
      } else {
        shellRef.current
          ?.querySelector<HTMLButtonElement>("[data-player-default-focus]")
          ?.focus({
            preventScroll: true,
          });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [engineState.state, minimised, videoRef]);

  // The Play button is the correct initial TV focus target, but retaining
  // focus there after playback starts would pin the controls forever. Once
  // playback is active, hand focus to the video surface so inactivity can
  // hide the overlay. Explicitly focused controls remain pinned.
  useEffect(() => {
    if (engineState.state !== "playing") return;
    const activeElement = document.activeElement;
    if (
      initialFocusPendingRef.current &&
      activeElement instanceof HTMLElement &&
      activeElement.matches("[data-player-default-focus]")
    ) {
      initialFocusPendingRef.current = false;
      videoRef.current?.focus({ preventScroll: true });
    }
  }, [controlsPinned, engineState.state, videoRef]);

  const toggleFullscreen = useCallback(async () => {
    const shell = shellRef.current as WebKitFullscreenElement | null;
    const webkitDocument = document as WebKitFullscreenDocument;
    const video = videoRef.current as WebKitFullscreenVideo | null;
    const activeFullscreenElement =
      document.fullscreenElement ?? webkitDocument.webkitFullscreenElement;

    if (activeFullscreenElement) {
      if (document.exitFullscreen) {
        await document.exitFullscreen();
      } else {
        await webkitDocument.webkitExitFullscreen?.();
      }
      setIsFullscreen(false);
      return;
    }

    if (video?.webkitDisplayingFullscreen) {
      video.webkitExitFullscreen?.();
      setIsFullscreen(false);
      return;
    }

    try {
      if (shell?.requestFullscreen) {
        await shell.requestFullscreen({ navigationUI: "hide" });
      } else if (shell?.webkitRequestFullscreen) {
        await shell.webkitRequestFullscreen();
      } else if (video?.webkitEnterFullscreen) {
        video.webkitEnterFullscreen();
      }
      setIsFullscreen(
        document.fullscreenElement === shell ||
          webkitDocument.webkitFullscreenElement === shell ||
          video?.webkitDisplayingFullscreen === true
      );
    } catch {
      // Safari/iOS may reject element fullscreen while still allowing its
      // native video fullscreen surface.
      video?.webkitEnterFullscreen?.();
      setIsFullscreen(video?.webkitDisplayingFullscreen === true);
    }
  }, []);

  // Kept fresh every render (a plain assignment, not an effect) so the
  // keydown listener below can read current playback numbers without
  // needing `engineState` in its own dependency array -- `engineState`
  // changes on every `timeupdate` tick (several times a second while
  // playing), which would otherwise tear down and re-add a
  // `window`-level listener that often.
  const engineStateRef = useRef(engineState);
  engineStateRef.current = engineState;

  // Keyboard shortcuts remain available on the video surface: space/k/Enter
  // play-pause, arrows seek/volume, m mute, and f fullscreen. Player controls
  // own their D-pad events, so these shortcuts cannot steal directional focus.
  useEffect(() => {
    if (minimised) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        isTypingTarget(event.target) ||
        isPlayerControlTarget(event.target) ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        return;
      }
      const current = engineStateRef.current;

      switch (event.key) {
        case " ":
        case "k":
        case "Enter":
          event.preventDefault();
          togglePlay();
          break;
        case "ArrowLeft":
          event.preventDefault();
          seek(Math.max(0, current.currentTimeSeconds - SEEK_STEP_SECONDS));
          break;
        case "ArrowRight":
          event.preventDefault();
          seek(Math.min(current.durationSeconds, current.currentTimeSeconds + SEEK_STEP_SECONDS));
          break;
        case "ArrowUp":
          event.preventDefault();
          setMuted(false);
          setVolume(Math.min(1, current.volume + VOLUME_STEP));
          break;
        case "ArrowDown":
          event.preventDefault();
          setVolume(Math.max(0, current.volume - VOLUME_STEP));
          break;
        case "m":
          setMuted(!current.muted);
          break;
        case "f":
          toggleFullscreen();
          break;
        default:
          return;
      }
      handleActivity();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    togglePlay,
    seek,
    setVolume,
    setMuted,
    toggleFullscreen,
    handleActivity,
    minimised,
  ]);

  // Read directly from the <video> element's own `buffered` TimeRanges
  // rather than tracking a second copy of this in the engine -- recomputed
  // whenever the engine reports fresh time/buffer info.
  const bufferedRanges = useMemo<Array<[number, number]>>(() => {
    const video = videoRef.current;
    if (!video) return [];
    const sourceOffsetSeconds =
      negotiation.kind === "ready" ? negotiation.sourceOffsetSeconds : 0;
    const ranges: Array<[number, number]> = [];
    for (let i = 0; i < video.buffered.length; i++) {
      ranges.push([
        video.buffered.start(i) + sourceOffsetSeconds,
        video.buffered.end(i) + sourceOffsetSeconds,
      ]);
    }
    return ranges;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-read `buffered` whenever the engine ticks time/buffer forward.
  }, [engineState.bufferedSeconds, engineState.currentTimeSeconds, negotiation]);

  const isBusy =
    qualitySwitching ||
    engineState.state === "idle" ||
    engineState.state === "loading" ||
    engineState.state === "buffering";
  const isFatalError = engineState.state === "error";
  const durationSeconds = engineState.durationSeconds;
  const positionSeconds = engineState.currentTimeSeconds;
  const progressPercentage =
    durationSeconds > 0
      ? Math.min(100, Math.max(0, (positionSeconds / durationSeconds) * 100))
      : 0;
  const minimisePlayer = useCallback(async () => {
    if (isFullscreen) await toggleFullscreen();
    onMinimise();
  }, [isFullscreen, onMinimise, toggleFullscreen]);

  return (
    <div
      ref={shellRef}
      className={`player-shell${showControls ? "" : " player-shell-idle"}${
        minimised ? " player-shell-minimised" : ""
      }${musicContext ? " player-shell-music" : ""}`}
      onMouseEnter={minimised ? undefined : handleActivity}
      onMouseMove={minimised ? undefined : handleActivity}
      onPointerDownCapture={minimised ? undefined : handleActivity}
      onKeyDownCapture={minimised ? undefined : handleActivity}
      onClick={(event) => {
        if (minimised) return;
        handleActivity();
        // Clicking anywhere on the video surface itself (not the control
        // bar, which stops propagation on its own interactive elements)
        // toggles play/pause -- the standard click-to-toggle pattern.
        if (event.target === event.currentTarget || (event.target as HTMLElement).tagName === "VIDEO") {
          togglePlay();
        }
      }}
    >
      {!minimised && (
        <>
          <PlayerBackButton
            onBack={onBack}
            onNavigateToControls={focusSeekControl}
            onNavigateRight={() =>
              shellRef.current
                ?.querySelector<HTMLButtonElement>(".player-minimise")
                ?.focus()
            }
            onFocus={() => {
              setBackButtonFocused(true);
              handleActivity();
            }}
            onBlur={() => setBackButtonFocused(false)}
          />
          <PlayerMinimiseButton
            onMinimise={() => void minimisePlayer()}
            onNavigateToBack={() =>
              shellRef.current?.querySelector<HTMLButtonElement>(".player-back")?.focus()
            }
            onNavigateToControls={focusSeekControl}
            onFocus={() => {
              setMinimiseButtonFocused(true);
              handleActivity();
            }}
            onBlur={() => setMinimiseButtonFocused(false)}
          />
        </>
      )}

      {!minimised && musicContext && activePlaylistItem ? (
        <MusicPlayerVisual
          context={musicContext}
          mediaFileId={activePlaylistItem.mediaFileId}
          title={title}
          playing={engineState.state === "playing"}
        />
      ) : null}

      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- captions not modeled by the backend yet */}
      <video
        ref={videoRef}
        className="player-video"
        playsInline
        tabIndex={minimised ? -1 : 0}
        aria-hidden={minimised}
        aria-label={
          minimised
            ? undefined
            : musicContext
              ? "Audio playback surface"
              : "Video playback surface"
        }
        onFocus={minimised ? undefined : handleActivity}
      />

      {minimised && (
        <>
          <button
            type="button"
            className="mini-player-hit-target"
            data-navigation-focus-key="shell:mini-player"
            onClick={onMaximise}
            aria-label={`Maximise ${title}`}
          />
          <div className="mini-player-details" aria-hidden="true">
            <span className="mini-player-title">{title}</span>
            <span className="mini-player-time">
              {formatPlayerTime(positionSeconds)} / {formatPlayerTime(durationSeconds)}
            </span>
            <span className="mini-player-track">
              <span style={{ width: `${progressPercentage}%` }} />
            </span>
          </div>
          <span className="mini-player-maximise" aria-hidden="true">
            <MaximiseIcon />
          </span>
        </>
      )}

      {isBusy && !isFatalError && !minimised && (
        <div className="player-overlay player-overlay-loading">
          <SpinnerIcon className="player-spinner" />
        </div>
      )}

      {isFatalError && !minimised && (
        <div className="player-overlay player-overlay-status" role="alert" aria-live="assertive">
          <div className="player-status-card player-status-card-error">
            <ErrorIcon className="player-error-icon" />
            <p className="player-status-kicker">Playback interrupted</p>
            <p className="player-error-title">This title stopped playing</p>
            <p className="player-error-message">{playbackErrorMessage(engineState.error?.message)}</p>
            <p className="player-error-code">
              {engineState.error?.code ? `Error ${engineState.error.code}` : "Player error"}
            </p>
            <button type="button" className="btn btn-primary player-retry-btn" onClick={retryNegotiation}>
              Restart playback
            </button>
          </div>
        </div>
      )}

      {/* Gradient scrim behind the control bar, independent of the bar's own
          visibility transition so it fades together with it. */}
      {!minimised && (
        <div className={`player-scrim${showControls ? "" : " is-hidden"}`} />
      )}

      {!minimised && playlistOpen && (
        <aside
          className="player-playlist-panel"
          aria-label="Playback playlist"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            const target = event.target;
            if (!(target instanceof HTMLButtonElement)) return;
            const items = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>(".player-playlist-item")
            );
            const index = items.indexOf(target);
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault();
              event.stopPropagation();
              const delta = event.key === "ArrowUp" ? -1 : 1;
              const next = items[Math.min(items.length - 1, Math.max(0, index + delta))];
              next?.focus({ preventScroll: true });
              next?.scrollIntoView({ block: "nearest", behavior: "smooth" });
              return;
            }
            if (
              event.key === "ArrowLeft" ||
              event.key === "Escape" ||
              event.key === "BrowserBack" ||
              event.key === "GoBack" ||
              event.keyCode === 10009 ||
              event.keyCode === 461
            ) {
              event.preventDefault();
              event.stopPropagation();
              closePlaylist();
              return;
            }
            if (event.key === "ArrowRight") {
              event.preventDefault();
              event.stopPropagation();
            }
          }}
        >
          <header>
            <div>
              <p>Up next</p>
              <span>
                {playlistItems.length}{" "}
                {musicContext
                  ? playlistItems.length === 1
                    ? "track"
                    : "tracks"
                  : playlistItems.length === 1
                    ? "item"
                    : "episodes"}
              </span>
            </div>
            <button type="button" onClick={() => closePlaylist()} aria-label="Close playlist">
              ×
            </button>
          </header>
          <div className="player-playlist-scroll" data-tv-scroll-container data-tv-scroll-axis="vertical">
            {playlistItems.map((item, index) => {
              const active = index === activePlaylistIndex;
              const previousItem = playlistItems[index - 1];
              const beginsSeason =
                item.seasonNumber !== undefined &&
                item.seasonNumber !== previousItem?.seasonNumber;
              return (
                <Fragment key={`${item.mediaFileId}-${item.episodeId ?? index}`}>
                  {beginsSeason ? (
                    <h2 className="player-playlist-season">
                      Season {item.seasonNumber}
                    </h2>
                  ) : null}
                  <button
                    type="button"
                    className={`player-playlist-item${active ? " is-active" : ""}`}
                    aria-current={active ? "true" : undefined}
                    onClick={() => {
                      if (active) player.play();
                      else onSelectPlaylistItem?.(index);
                      closePlaylist(false);
                    }}
                    {...playlistContext.itemProps({
                      workId: /^\/(?:movies|series)\/([^/]+)$/.exec(detailRoute)?.[1],
                      title: item.title,
                      detailRoute,
                      parentRoute: detailParentRoute,
                      preferredMediaFileId: item.mediaFileId,
                      preferredEpisodeId: item.episodeId,
                      leaves: [
                        {
                          mediaFileId: item.mediaFileId,
                          runtimeMs: 0,
                          episodeId: item.episodeId,
                          title: item.title,
                        },
                      ],
                      onPlay: () => {
                        if (active) player.play();
                        else onSelectPlaylistItem?.(index);
                        closePlaylist(false);
                      },
                    })}
                  >
                    <MediaThumbnailArtwork
                      mediaFileId={item.mediaFileId}
                      fallback={null}
                      className="player-playlist-art"
                      intersectionRootSelector=".player-playlist-scroll"
                    >
                      <span>{String(index + 1).padStart(2, "0")}</span>
                    </MediaThumbnailArtwork>
                    <span className="player-playlist-copy">
                      <small>
                        {item.seasonNumber !== undefined && item.episodeNumber !== undefined
                          ? `S${String(item.seasonNumber).padStart(2, "0")} · E${String(
                              item.episodeNumber
                            ).padStart(2, "0")}`
                          : active
                            ? "Now playing"
                            : musicContext
                              ? "Track"
                              : "Movie"}
                      </small>
                      <strong>{item.title}</strong>
                      {item.subtitle ? <span>{item.subtitle}</span> : null}
                    </span>
                    {active ? <i aria-label="Now playing" /> : null}
                  </button>
                </Fragment>
              );
            })}
          </div>
        </aside>
      )}
      {!minimised && playlistContext.contextMenu}

      {!minimised && (
        <PlayerControls
          engineState={engineState}
          visible={showControls}
          isFullscreen={isFullscreen}
          onTogglePlay={togglePlay}
          onSeek={seek}
          onSetVolume={setVolume}
          onSetMuted={setMuted}
          onToggleFullscreen={toggleFullscreen}
          bufferedRanges={bufferedRanges}
          qualityOptions={qualityOptions}
          activeQualityId={activeQualityId}
          qualitySwitching={qualitySwitching}
          qualityError={qualityError}
          onSelectQuality={selectQuality}
          audioTracks={player.audioTracks}
          selectedAudioTrackId={player.selectedAudioTrackId}
          onSelectAudioTrack={player.selectAudioTrack}
          subtitleTracks={player.subtitleTracks}
          selectedSubtitleTrackId={player.selectedSubtitleTrackId}
          subtitleSwitching={subtitleSwitching}
          subtitleError={subtitleError}
          onSelectSubtitleTrack={player.selectSubtitleTrack}
          canPrevious={activePlaylistIndex > 0}
          canNext={
            activePlaylistIndex >= 0 &&
            activePlaylistIndex < playlistItems.length - 1
          }
          onPrevious={onPrevious}
          onNext={onNext}
          playlistCount={playlistItems.length}
          playlistOpen={playlistOpen}
          onTogglePlaylist={() => {
            if (playlistOpen) closePlaylist();
            else openPlaylist();
          }}
          onQualityMenuOpenChange={setControlsPinned}
          onActivity={handleActivity}
        />
      )}
    </div>
  );
}

function formatPlayerTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "0:00";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const paddedMinutes = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  const paddedSeconds = String(seconds).padStart(2, "0");
  return hours > 0
    ? `${hours}:${paddedMinutes}:${paddedSeconds}`
    : `${paddedMinutes}:${paddedSeconds}`;
}

function playbackErrorMessage(message: string | undefined): string {
  if (!message) return "The player stopped unexpectedly. Check your connection and try again.";
  const normalised = message.toLowerCase();
  if (normalised.includes("network") || normalised.includes("http") || normalised.includes("timeout")) {
    return "The connection to the stream was lost. Check your network and restart playback.";
  }
  if (normalised.includes("codec") || normalised.includes("media") || normalised.includes("support")) {
    return "This browser could not decode the stream it received. Restart playback to request a fresh stream.";
  }
  return message;
}
