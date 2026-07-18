import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import type { Work } from "@streamarr-tv/api-client";
import type { PlaybackEngineController } from "../../lib/usePlaybackEngine";
import { CachedArtworkImage } from "../../lib/artwork";
import { useLanguage } from "../../lib/i18n/LanguageProvider";
import type { TranslationKey } from "../../lib/i18n/translations";
import {
  shouldAutoHidePlayerControls,
  shouldRenderPlayerControls,
} from "../../lib/playerControlVisibility";
import { MediaThumbnailArtwork } from "../MediaThumbnailArtwork";
import { useMediaContextMenu } from "../MediaContextMenu";
import { PlayerControls } from "./PlayerControls";
import {
  BackIcon,
  ErrorIcon,
  MaximiseIcon,
  MinimiseIcon,
  SpinnerIcon,
} from "./PlayerIcons";

const SEEK_STEP_SECONDS = 5;
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
  const { t } = useLanguage();
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
      aria-label={t("components.player.surface.backButtonAriaLabel")}
    >
      <BackIcon />
      <span>{t("components.player.surface.backButtonLabel")}</span>
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
  onBlur?: () => void;
}) {
  const { t } = useLanguage();
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
      aria-label={t("components.player.surface.minimiseButtonAriaLabel")}
    >
      <MinimiseIcon />
      <span>{t("components.player.surface.minimiseButtonLabel")}</span>
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

const MUSIC_VISUALISER_BAR_COUNT = 36;

interface MusicAudioGraph {
  context: AudioContext;
  analyser: AnalyserNode;
  frequencyData: Uint8Array<ArrayBuffer>;
}

interface WebKitAudioWindow extends Window {
  webkitAudioContext?: typeof AudioContext;
}

const musicAudioGraphs = new WeakMap<HTMLMediaElement, MusicAudioGraph>();

function useMusicAudioVisualiser(
  mediaRef: RefObject<HTMLVideoElement>,
  active: boolean,
  playing: boolean,
  reducedMotion: boolean
) {
  const graphRef = useRef<MusicAudioGraph | null>(null);
  const [ready, setReady] = useState(false);

  const activate = useCallback(async () => {
    if (!active || !mediaRef.current) return;
    const mediaElement = mediaRef.current;
    let graph = musicAudioGraphs.get(mediaElement);

    if (!graph) {
      const AudioContextConstructor =
        window.AudioContext ?? (window as WebKitAudioWindow).webkitAudioContext;
      if (!AudioContextConstructor) return;

      const context = new AudioContextConstructor();
      try {
        await context.resume();
        if (context.state !== "running") {
          await context.close();
          return;
        }
        const analyser = context.createAnalyser();
        analyser.fftSize = 128;
        analyser.smoothingTimeConstant = 0.78;
        const source = context.createMediaElementSource(mediaElement);
        source.connect(analyser);
        analyser.connect(context.destination);
        graph = {
          context,
          analyser,
          frequencyData: new Uint8Array(analyser.frequencyBinCount),
        };
        musicAudioGraphs.set(mediaElement, graph);
      } catch {
        // If a TV browser blocks Web Audio, leave native playback untouched.
        // Bars remain at rest rather than pretending to react.
        if (context.state !== "closed") void context.close();
        return;
      }
    } else if (graph.context.state === "suspended") {
      await graph.context.resume().catch(() => undefined);
    }

    graphRef.current = graph;
    setReady(true);
  }, [active, mediaRef]);

  useEffect(() => {
    const visualisers = () =>
      document.querySelectorAll<HTMLElement>(
        "[data-player-music-visualiser]"
      );

    if (!active || !playing) {
      for (const visualiser of visualisers()) {
        for (const bar of visualiser.querySelectorAll<HTMLElement>("i")) {
          bar.style.transform = "scaleY(0.08)";
          bar.style.opacity = "0.58";
        }
      }
      return;
    }

    let animationFrame = 0;
    let cancelled = false;
    let lastRenderAt = 0;
    const render = (now = 0) => {
      const graph = graphRef.current;
      if (!graph || cancelled) return;

      if (reducedMotion && now - lastRenderAt < 50) {
        animationFrame = window.requestAnimationFrame(render);
        return;
      }
      lastRenderAt = now;

      graph.analyser.getByteFrequencyData(graph.frequencyData);
      for (const visualiser of visualisers()) {
        const bars = visualiser.querySelectorAll<HTMLElement>("i");
        const finalBin = Math.max(1, graph.frequencyData.length - 1);
        bars.forEach((bar, index) => {
          const position = index / Math.max(1, bars.length - 1);
          const bin = Math.min(
            finalBin,
            Math.max(1, Math.round(Math.pow(position, 1.55) * finalBin))
          );
          const neighbouringBin = Math.min(finalBin, bin + 1);
          const level =
            ((graph.frequencyData[bin] ?? 0) * 0.72 +
              (graph.frequencyData[neighbouringBin] ?? 0) * 0.28) /
            255;
          const scale = Math.min(1, 0.07 + Math.pow(level, 0.78) * 0.93);
          bar.style.transform = `scaleY(${scale.toFixed(3)})`;
          bar.style.opacity = `${Math.min(1, 0.55 + level * 0.45).toFixed(3)}`;
        });
      }
      animationFrame = window.requestAnimationFrame(render);
    };

    void activate().then(() => {
      if (!cancelled && graphRef.current) render();
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(animationFrame);
    };
  }, [activate, active, playing, ready, reducedMotion]);

  return activate;
}

function MusicPlayerVisual({
  context,
  title,
  inlineVisualiserHost,
}: {
  context: PlayerMusicContext;
  title: string;
  inlineVisualiserHost: HTMLElement | null;
}) {
  const barCount =
    document.documentElement.dataset.platform === "android-tv" ? 18 : MUSIC_VISUALISER_BAR_COUNT;
  const visualiser = (
    <div
      className="player-music-visualiser"
      data-player-music-visualiser
    >
      {Array.from({ length: barCount }, (_, index) => (
        <i key={index} />
      ))}
    </div>
  );

  if (inlineVisualiserHost) {
    return createPortal(visualiser, inlineVisualiserHost);
  }

  return (
    <div className="player-music-visual" aria-hidden="true">
      <div className="player-music-backdrop">
        <span className="player-music-backdrop-media">
          <CachedArtworkImage
            work={context.artworkWork}
            kinds={["backdrop", "poster"]}
            alt=""
          />
          <span />
        </span>
      </div>
      <div className="player-music-colour-wash" />
      <div className="player-music-stage">
        <div className="player-music-cover">
          <span className="player-music-cover-media">
            <CachedArtworkImage
              work={context.artworkWork}
              kinds={["poster", "backdrop"]}
              alt=""
            />
            <span className="player-music-cover-fallback">
              {context.albumTitle.slice(0, 1)}
            </span>
            {visualiser}
          </span>
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

export function InlineMusicMiniPlayer({
  context,
  title,
  positionSeconds,
  durationSeconds,
  progressPercentage,
  onMaximise,
}: {
  context?: PlayerMusicContext;
  title: string;
  positionSeconds: number;
  durationSeconds: number;
  progressPercentage: number;
  onMaximise: () => void;
}) {
  const { t } = useLanguage();
  return createPortal(
    <div className="player-page is-minimised player-inline-music-mini">
      <div className="player-shell player-shell-minimised player-shell-music">
        {context ? (
          <MusicPlayerVisual
            context={context}
            title={title}
            inlineVisualiserHost={null}
          />
        ) : (
          <span className="player-inline-music-art-fallback" aria-hidden="true">
            {title.slice(0, 1)}
          </span>
        )}
        <button
          type="button"
          className="mini-player-hit-target"
          data-navigation-focus-key="shell:mini-player"
          onClick={onMaximise}
          aria-label={t("components.player.surface.openCoverFlowAriaLabel", { title })}
        />
        <div className="mini-player-details" aria-hidden="true">
          <span className="mini-player-title">{title}</span>
          <span className="mini-player-time">
            {formatPlayerTime(positionSeconds)} /{" "}
            {formatPlayerTime(durationSeconds)}
          </span>
          <span className="mini-player-track">
            <span style={{ width: `${progressPercentage}%` }} />
          </span>
        </div>
        <span className="mini-player-maximise" aria-hidden="true">
          <MaximiseIcon />
        </span>
      </div>
    </div>,
    document.body
  );
}

export function PlayerSurface({
  player,
  title,
  minimised = false,
  inlineMusic = false,
  stopPlaybackOnPause = false,
  onBack,
  onStop,
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
  inlineMusic?: boolean;
  stopPlaybackOnPause?: boolean;
  onBack: () => void;
  onStop: () => void;
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
  const { t } = useLanguage();
  const systemVolumeOnly =
    typeof navigator !== "undefined" &&
    navigator.userAgent.includes("PlayarrAndroidTV/");

  const shellRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<number | undefined>(undefined);
  const initialFocusPendingRef = useRef(true);
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsPinned, setControlsPinned] = useState(false);
  const [playlistOpen, setPlaylistOpen] = useState(false);
  const [inlineVisualiserHost, setInlineVisualiserHost] =
    useState<HTMLElement | null>(null);
  const activePlaylistItem = playlistItems[activePlaylistIndex];
  const musicContext = activePlaylistItem?.music;
  const activateMusicVisualiser = useMusicAudioVisualiser(
    videoRef,
    Boolean(musicContext),
    engineState.state === "playing",
    systemVolumeOnly
  );
  const playlistContext = useMediaContextMenu();
  const interactionPinned =
    controlsPinned ||
    playlistOpen ||
    playlistContext.isOpen ||
    qualitySwitching ||
    subtitleSwitching;

  useEffect(() => {
    if (!systemVolumeOnly) return;
    const media = videoRef.current;
    const forceMaximumPlayerVolume = () => {
      if (media) {
        media.volume = 1;
        media.muted = false;
      }
      setVolume(1);
      setMuted(false);
    };
    forceMaximumPlayerVolume();
    media?.addEventListener("loadedmetadata", forceMaximumPlayerVolume);
    return () =>
      media?.removeEventListener("loadedmetadata", forceMaximumPlayerVolume);
  }, [
    negotiation.kind,
    setMuted,
    setVolume,
    systemVolumeOnly,
    videoRef,
  ]);

  useEffect(() => {
    if (!inlineMusic) {
      setInlineVisualiserHost(null);
      return;
    }

    const syncHost = () => {
      const nextHost = document.querySelector<HTMLElement>(
        "[data-music-visualiser-host]"
      );
      setInlineVisualiserHost((current) =>
        current === nextHost ? current : nextHost
      );
    };
    syncHost();

    const observer = new MutationObserver(syncHost);
    const coverFlow =
      document.querySelector(".tv-music-album-cover-flow") ?? document.body;
    observer.observe(coverFlow, {
      childList: true,
      subtree: true,
    });
    return () => observer.disconnect();
  }, [inlineMusic]);

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
    hideTimerRef.current = window.setTimeout(() => {
      setShowControls(false);
      const activeElement = document.activeElement;
      if (
        activeElement instanceof HTMLElement &&
        activeElement.closest(".player-controls, .player-back, .player-minimise")
      ) {
        videoRef.current?.focus({ preventScroll: true });
      }
    }, AUTO_HIDE_MS);
  }, [videoRef]);

  const handleActivity = useCallback(() => {
    setShowControls(true);
    if (
      shouldAutoHidePlayerControls({
        inlineMusic,
        minimised,
        playbackState: engineState.state,
        interactionPinned,
      })
    ) {
      scheduleHide();
    }
  }, [engineState.state, inlineMusic, interactionPinned, minimised, scheduleHide]);

  // Auto-hide only while actively playing -- paused/buffering/error states
  // always keep the control bar visible, matching the standard pattern
  // (nothing to "hide from" when nothing is moving).
  useEffect(() => {
    if (inlineMusic) {
      window.clearTimeout(hideTimerRef.current);
      setShowControls(true);
      setPlaylistOpen(false);
      return;
    }
    if (minimised) {
      window.clearTimeout(hideTimerRef.current);
      setShowControls(false);
      setPlaylistOpen(false);
      return;
    }
    if (
      shouldAutoHidePlayerControls({
        inlineMusic,
        minimised,
        playbackState: engineState.state,
        interactionPinned,
      })
    ) {
      scheduleHide();
    } else {
      window.clearTimeout(hideTimerRef.current);
      setShowControls(true);
    }
    return () => window.clearTimeout(hideTimerRef.current);
  }, [engineState.state, inlineMusic, interactionPinned, minimised, scheduleHide]);

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
    if (minimised || !initialFocusPendingRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      shellRef.current
        ?.querySelector<HTMLButtonElement>("[data-player-default-focus]")
        ?.focus({
          preventScroll: true,
        });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [engineState.state, minimised, videoRef]);

  // The Play button is the correct initial TV focus target. Once playback is
  // active, hand focus to the video surface so inactivity can hide the overlay.
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
  const togglePlayback = useCallback(() => {
    const currentState = engineStateRef.current.state;
    if (
      stopPlaybackOnPause &&
      (currentState === "playing" || currentState === "buffering")
    ) {
      onStop();
      return;
    }
    void activateMusicVisualiser();
    togglePlay();
  }, [activateMusicVisualiser, onStop, stopPlaybackOnPause, togglePlay]);

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
      if (
        event.key === "Enter" ||
        event.key === " " ||
        event.key.startsWith("Arrow")
      ) {
        document.body.dataset.inputMode = "remote";
        void activateMusicVisualiser();
      }

      switch (event.key) {
        case " ":
        case "k":
        case "Enter":
          event.preventDefault();
          togglePlayback();
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
          shellRef.current
            ?.querySelector<HTMLButtonElement>(".player-back")
            ?.focus({ preventScroll: true });
          break;
        case "ArrowDown":
          event.preventDefault();
          focusSeekControl();
          break;
        case "m":
          if (!systemVolumeOnly) setMuted(!current.muted);
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
    togglePlayback,
    seek,
    setVolume,
    setMuted,
    toggleFullscreen,
    handleActivity,
    minimised,
    activateMusicVisualiser,
    focusSeekControl,
    systemVolumeOnly,
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
      }${musicContext ? " player-shell-music" : ""}${
        inlineMusic ? " player-shell-inline-music" : ""
      }`}
      onMouseEnter={minimised ? undefined : handleActivity}
      onMouseMove={minimised ? undefined : handleActivity}
      onPointerDownCapture={
        minimised && !inlineMusic
          ? undefined
          : () => {
              handleActivity();
              void activateMusicVisualiser();
            }
      }
      onKeyDownCapture={
        minimised && !inlineMusic
          ? undefined
          : (event) => {
              handleActivity();
              const target = event.target;
              if (
                inlineMusic &&
                target instanceof HTMLElement &&
                target.closest(".player-controls") &&
                (event.key === "ArrowUp" || event.key === "ArrowDown")
              ) {
                event.preventDefault();
                event.stopPropagation();
                const selector =
                  event.key === "ArrowUp"
                    ? ".tv-music-album-card.is-selected"
                    : ".tv-music-track-row.is-selected";
                document
                  .querySelector<HTMLElement>(selector)
                  ?.focus({ preventScroll: true });
                return;
              }
              if (
                event.key === "Enter" ||
                event.key === " " ||
                event.key.startsWith("Arrow")
              ) {
                document.body.dataset.inputMode = "remote";
                void activateMusicVisualiser();
              }
            }
      }
      onClick={(event) => {
        if (minimised) return;
        handleActivity();
        // Clicking anywhere on the video surface itself (not the control
        // bar, which stops propagation on its own interactive elements)
        // toggles play/pause -- the standard click-to-toggle pattern.
        if (event.target === event.currentTarget || (event.target as HTMLElement).tagName === "VIDEO") {
          togglePlayback();
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
            onFocus={handleActivity}
          />
          <PlayerMinimiseButton
            onMinimise={() => void minimisePlayer()}
            onNavigateToBack={() =>
              shellRef.current?.querySelector<HTMLButtonElement>(".player-back")?.focus()
            }
            onNavigateToControls={focusSeekControl}
            onFocus={handleActivity}
          />
        </>
      )}

      {musicContext && activePlaylistItem ? (
        inlineMusic && !inlineVisualiserHost ? null : (
          <MusicPlayerVisual
            context={musicContext}
            title={title}
            inlineVisualiserHost={
              inlineMusic ? inlineVisualiserHost : null
            }
          />
        )
      ) : null}

      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- captions not modeled by the backend yet */}
      <video
        ref={videoRef}
        className="player-video"
        crossOrigin="anonymous"
        playsInline
        tabIndex={minimised ? -1 : 0}
        aria-hidden={minimised}
        aria-label={
          minimised
            ? undefined
            : musicContext
              ? t("components.player.surface.audioSurfaceAriaLabel")
              : t("components.player.surface.videoSurfaceAriaLabel")
        }
        onFocus={minimised ? undefined : handleActivity}
      />

      {minimised && !inlineMusic && (
        <>
          <button
            type="button"
            className="mini-player-hit-target"
            data-navigation-focus-key="shell:mini-player"
            onClick={onMaximise}
            aria-label={t("components.player.surface.maximiseAriaLabel", { title })}
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
            <p className="player-status-kicker">{t("components.player.surface.playbackInterruptedKicker")}</p>
            <p className="player-error-title">{t("components.player.surface.playbackErrorTitle")}</p>
            <p className="player-error-message">{playbackErrorMessage(engineState.error?.message, t)}</p>
            <p className="player-error-code">
              {engineState.error?.code
                ? t("components.player.surface.errorCode", { code: engineState.error.code })
                : t("components.player.surface.genericPlayerError")}
            </p>
            <button type="button" className="btn btn-primary player-retry-btn" onClick={retryNegotiation}>
              {t("components.player.surface.restartPlaybackButton")}
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
          aria-label={t("components.player.surface.playlistAriaLabel")}
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
              <p>{t("components.player.surface.upNext")}</p>
              <span>
                {playlistItems.length}{" "}
                {musicContext
                  ? playlistItems.length === 1
                    ? t("components.player.surface.unitTrack")
                    : t("components.player.surface.unitTracks")
                  : playlistItems.length === 1
                    ? t("components.player.surface.unitItem")
                    : t("components.player.surface.unitEpisodes")}
              </span>
            </div>
            <button
              type="button"
              onClick={() => closePlaylist()}
              aria-label={t("components.player.surface.closePlaylistAriaLabel")}
            >
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
                      {t("components.player.surface.seasonHeading", {
                        number: item.seasonNumber ?? 0,
                      })}
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
                          ? t("components.player.surface.seasonEpisodeLabel", {
                              season: String(item.seasonNumber).padStart(2, "0"),
                              episode: String(item.episodeNumber).padStart(2, "0"),
                            })
                          : active
                            ? t("components.player.surface.nowPlaying")
                            : musicContext
                              ? t("components.player.surface.trackLabel")
                              : t("components.player.surface.movieLabel")}
                      </small>
                      <strong>{item.title}</strong>
                      {item.subtitle ? <span>{item.subtitle}</span> : null}
                    </span>
                    {active ? (
                      <i aria-label={t("components.player.surface.nowPlaying")} />
                    ) : null}
                  </button>
                </Fragment>
              );
            })}
          </div>
        </aside>
      )}
      {!minimised && playlistContext.contextMenu}

      {shouldRenderPlayerControls({
        inlineMusic,
        minimised,
        playbackBusy: isBusy,
      }) && (
        <PlayerControls
          engineState={engineState}
          visible={showControls}
          contextTitle={inlineMusic ? title : undefined}
          defaultFocusId={inlineMusic ? "inline-music-playback-control" : undefined}
          isFullscreen={isFullscreen}
          systemVolumeOnly={systemVolumeOnly}
          onTogglePlay={togglePlayback}
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

function playbackErrorMessage(
  message: string | undefined,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
): string {
  if (!message) return t("components.player.surface.errorGeneric");
  const normalised = message.toLowerCase();
  if (normalised.includes("network") || normalised.includes("http") || normalised.includes("timeout")) {
    return t("components.player.surface.errorNetwork");
  }
  if (normalised.includes("codec") || normalised.includes("media") || normalised.includes("support")) {
    return t("components.player.surface.errorCodec");
  }
  return message;
}
