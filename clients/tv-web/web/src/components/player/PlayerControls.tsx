import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { PlaybackQualityOption } from "@playarr-tv/api-client";
import type { PlaybackEngineState } from "@playarr-tv/player-core";
import { QualityMatrix } from "../QualityMatrix";
import { useLanguage } from "../../lib/i18n/LanguageProvider";
import { qualityDefinitionForId } from "../../lib/qualityMatrix";
import {
  formatMbps,
  isOriginalQuality,
  qualityDisplayLabel,
} from "../../lib/playerQualityLabel";
import { audioTrackLabel, subtitleTrackLabel } from "../../lib/trackLabels";
import { CastButton } from "./CastButton";
import { isBackKey } from "../../lib/backKey";
import {
  AudioTrackIcon,
  FullscreenEnterIcon,
  FullscreenExitIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PlaylistIcon,
  HealthIcon,
  PreviousIcon,
  SubtitlesIcon,
  VolumeHighIcon,
  VolumeMutedIcon,
} from "./PlayerIcons";

export interface PlayerTrackOption {
  id: string;
  label: string;
  language?: string;
  codec?: string;
  channelsCount?: number;
  forced?: boolean;
}

const SEEK_COMMIT_DEBOUNCE_MS = 300;

export interface PlayerControlsProps {
  engineState: PlaybackEngineState;
  visible: boolean;
  contextTitle?: string;
  defaultFocusId?: string;
  seekFocusId?: string;
  onNavigateAbove?: () => void;
  onNavigateBelow?: () => void;
  isFullscreen: boolean;
  systemVolumeOnly?: boolean;
  onTogglePlay: () => void;
  onSeek: (positionSeconds: number) => void;
  onSetVolume: (volume: number) => void;
  onSetMuted: (muted: boolean) => void;
  onToggleFullscreen: () => void;
  /** Every buffered `[start, end]` pair in seconds, from the `<video>` element's own `buffered` TimeRanges. */
  bufferedRanges: Array<[number, number]>;
  qualityOptions: PlaybackQualityOption[];
  activeQualityId: string;
  qualitySwitching: boolean;
  qualityError?: string;
  onSelectQuality: (qualityId: string) => void;
  audioTracks: PlayerTrackOption[];
  selectedAudioTrackId?: string | null;
  onSelectAudioTrack: (trackId: string) => void;
  subtitleTracks: PlayerTrackOption[];
  selectedSubtitleTrackId?: string | null;
  subtitleSwitching: boolean;
  subtitleError?: string;
  onSelectSubtitleTrack: (trackId: string | null) => void;
  canPrevious: boolean;
  canNext: boolean;
  onPrevious?: () => void;
  onNext?: () => void;
  playlistCount: number;
  playlistOpen: boolean;
  onTogglePlaylist: () => void;
  onQualityMenuOpenChange: (open: boolean) => void;
  onActivity: () => void;
  /** Chromecast: hidden entirely (no `CastButton` rendered at all) unless this is true. */
  castAvailable?: boolean;
  castConnected?: boolean;
  castDeviceName?: string | null;
  onToggleCast?: () => Promise<void>;
  /** Opens the playback health panel; the button is hidden when omitted. */
  onOpenHealth?: () => void;
  /** Opens "Play on another device" (phone remote handoff); hidden when omitted. */
  onPlayOnDevice?: () => void;
}

function formatTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "0:00";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const paddedMinutes = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  const paddedSeconds = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${paddedMinutes}:${paddedSeconds}` : `${paddedMinutes}:${paddedSeconds}`;
}

/**
 * The real, custom control bar -- not `<video controls>`. Play/pause, a
 * scrubbable seek bar (current position + every buffered range), current
 * time / duration, volume + mute, and fullscreen. Auto-hide/show is owned
 * by the parent (`PlayerSurface`, which tracks mouse-move/pause) -- this
 * component just renders per the `visible` prop it's handed.
 */
export function PlayerControls({
  engineState,
  visible,
  contextTitle,
  defaultFocusId,
  seekFocusId,
  onNavigateAbove,
  onNavigateBelow,
  isFullscreen,
  systemVolumeOnly = false,
  onTogglePlay,
  onSeek,
  onSetVolume,
  onSetMuted,
  onToggleFullscreen,
  bufferedRanges,
  qualityOptions,
  activeQualityId,
  qualitySwitching,
  qualityError,
  onSelectQuality,
  audioTracks,
  selectedAudioTrackId,
  onSelectAudioTrack,
  subtitleTracks,
  selectedSubtitleTrackId,
  subtitleSwitching,
  subtitleError,
  onSelectSubtitleTrack,
  canPrevious,
  canNext,
  onPrevious,
  onNext,
  playlistCount,
  playlistOpen,
  onTogglePlaylist,
  onQualityMenuOpenChange,
  onActivity,
  castAvailable = false,
  castConnected = false,
  castDeviceName,
  onPlayOnDevice,
  onToggleCast,
  onOpenHealth,
}: PlayerControlsProps) {
  const { t, language } = useLanguage();
  const trackWords = useMemo(
    () => ({
      mono: t("components.player.controls.channelsMono"),
      stereo: t("components.player.controls.channelsStereo"),
      forced: t("components.player.controls.subtitleForced"),
    }),
    [t]
  );
  const audioLabel = (track: PlayerTrackOption) => audioTrackLabel(track, language, trackWords);
  const subtitleLabel = (track: PlayerTrackOption) =>
    subtitleTrackLabel(track, language, trackWords);
  const trackRef = useRef<HTMLDivElement>(null);
  const previousButtonRef = useRef<HTMLButtonElement>(null);
  const playButtonRef = useRef<HTMLButtonElement>(null);
  const nextButtonRef = useRef<HTMLButtonElement>(null);
  const muteButtonRef = useRef<HTMLButtonElement>(null);
  const audioButtonRef = useRef<HTMLButtonElement>(null);
  const subtitlesButtonRef = useRef<HTMLButtonElement>(null);
  const playlistButtonRef = useRef<HTMLButtonElement>(null);
  const qualityButtonRef = useRef<HTMLButtonElement>(null);
  const castButtonRef = useRef<HTMLButtonElement>(null);
  const healthButtonRef = useRef<HTMLButtonElement>(null);
  const playOnButtonRef = useRef<HTMLButtonElement>(null);
  const fullscreenButtonRef = useRef<HTMLButtonElement>(null);
  const qualityOptionRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const audioOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const subtitleOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeScrubRef = useRef<{
    pointerId: number;
    positionSeconds: number;
  } | null>(null);
  const seekCommitTimerRef = useRef<number | undefined>(undefined);
  const seekSequenceActiveRef = useRef(false);
  const seekWasPlayingRef = useRef(false);
  const [scrubPositionSeconds, setScrubPositionSeconds] = useState<number | null>(null);
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
  const [audioMenuOpen, setAudioMenuOpen] = useState(false);
  const [subtitleMenuOpen, setSubtitleMenuOpen] = useState(false);
  const [pendingSeek, setPendingSeek] = useState<{
    positionSeconds: number;
    requestedAt: number | null;
  } | null>(null);

  useEffect(() => {
    onQualityMenuOpenChange(
      qualityMenuOpen ||
        audioMenuOpen ||
        subtitleMenuOpen ||
        playlistOpen ||
        scrubPositionSeconds !== null ||
        pendingSeek !== null
    );
  }, [
    audioMenuOpen,
    onQualityMenuOpenChange,
    pendingSeek,
    playlistOpen,
    qualityMenuOpen,
    scrubPositionSeconds,
    subtitleMenuOpen,
  ]);

  useEffect(
    () => () => {
      onQualityMenuOpenChange(false);
    },
    [onQualityMenuOpenChange]
  );

  const duration = engineState.durationSeconds;
  const isPlaying =
    engineState.state === "playing" ||
    engineState.state === "buffering" ||
    (pendingSeek !== null && seekWasPlayingRef.current);
  const displayedPosition =
    scrubPositionSeconds ?? pendingSeek?.positionSeconds ?? engineState.currentTimeSeconds;
  const playedPct = duration > 0 ? Math.min(100, (displayedPosition / duration) * 100) : 0;

  useEffect(() => {
    if (
      !pendingSeek ||
      pendingSeek.requestedAt === null ||
      engineState.state === "buffering" ||
      engineState.state === "loading"
    ) {
      return;
    }
    if (Math.abs(engineState.currentTimeSeconds - pendingSeek.positionSeconds) > 1.5) return;

    const elapsed = performance.now() - pendingSeek.requestedAt;
    const timer = window.setTimeout(
      () => setPendingSeek((current) => (current === pendingSeek ? null : current)),
      Math.max(0, 300 - elapsed)
    );
    return () => window.clearTimeout(timer);
  }, [engineState.currentTimeSeconds, engineState.state, pendingSeek]);

  useEffect(() => {
    if (pendingSeek !== null) return;
    seekSequenceActiveRef.current = false;
    seekWasPlayingRef.current = false;
  }, [pendingSeek]);

  useEffect(
    () => () => window.clearTimeout(seekCommitTimerRef.current),
    []
  );

  const queueSeek = useCallback(
    (positionSeconds: number) => {
      const nextPosition = Math.min(duration, Math.max(0, positionSeconds));
      if (!seekSequenceActiveRef.current) {
        seekSequenceActiveRef.current = true;
        seekWasPlayingRef.current =
          engineState.state === "playing" || engineState.state === "buffering";
      }
      setPendingSeek({
        positionSeconds: nextPosition,
        requestedAt: null,
      });
      window.clearTimeout(seekCommitTimerRef.current);
      seekCommitTimerRef.current = window.setTimeout(() => {
        seekCommitTimerRef.current = undefined;
        const requestedAt = performance.now();
        setPendingSeek((current) =>
          current?.positionSeconds === nextPosition
            ? { ...current, requestedAt }
            : current
        );
        onSeek(nextPosition);
      }, SEEK_COMMIT_DEBOUNCE_MS);
    },
    [duration, engineState.state, onSeek]
  );

  const positionFromPointer = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): number => {
      const track = trackRef.current;
      if (!track || duration <= 0) return 0;
      const rect = track.getBoundingClientRect();
      const ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
      return Math.min(duration, Math.max(0, ratio * duration));
    },
    [duration]
  );

  const handleSeekPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (duration <= 0 || (event.pointerType === "mouse" && event.button !== 0)) return;
      event.preventDefault();
      const positionSeconds = positionFromPointer(event);
      activeScrubRef.current = {
        pointerId: event.pointerId,
        positionSeconds,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      setScrubPositionSeconds(positionSeconds);
    },
    [duration, positionFromPointer]
  );

  const handleSeekPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const activeScrub = activeScrubRef.current;
      if (!activeScrub || activeScrub.pointerId !== event.pointerId) return;
      event.preventDefault();
      const positionSeconds = positionFromPointer(event);
      activeScrub.positionSeconds = positionSeconds;
      setScrubPositionSeconds(positionSeconds);
    },
    [positionFromPointer]
  );

  const handleSeekPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const activeScrub = activeScrubRef.current;
      if (!activeScrub || activeScrub.pointerId !== event.pointerId) return;
      event.preventDefault();
      const finalPosition = positionFromPointer(event);
      activeScrubRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      queueSeek(finalPosition);
      setScrubPositionSeconds(null);
    },
    [positionFromPointer, queueSeek]
  );

  const handleSeekPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const activeScrub = activeScrubRef.current;
      if (!activeScrub || activeScrub.pointerId !== event.pointerId) return;
      activeScrubRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setScrubPositionSeconds(null);
    },
    []
  );

  const volumePct = engineState.muted ? 0 : Math.round(engineState.volume * 100);
  const activeQuality =
    qualityOptions.find((quality) => quality.id === activeQualityId) ?? qualityOptions[0];
  const activeQualityBadge =
    activeQuality?.height === 2160
      ? t("quality.tier.uhd")
      : activeQuality?.height === 1080
        ? t("quality.tier.fhd")
        : activeQuality?.height === 720
          ? t("quality.tier.hd")
          : activeQuality?.height === 480
            ? t("quality.tier.sd")
            : t("components.player.controls.hdBadge");
  const availableQualityIds = useMemo(
    () => new Set(qualityOptions.map((quality) => quality.id)),
    [qualityOptions]
  );
  const standaloneQualityChoices = useMemo(
    () =>
      qualityOptions
        .filter((quality) => qualityDefinitionForId(quality.id) === undefined)
        .map((quality) => {
          const mbps = formatMbps(quality.video_bitrate_bps);
          return {
            id: quality.id,
            label: qualityDisplayLabel(quality, t),
            // Original already carries its bitrate in the label.
            detail:
              mbps && !isOriginalQuality(quality)
                ? t("components.player.controls.bitrateMbps", { bitrate: mbps })
                : t("components.player.controls.sourceQuality"),
          };
        }),
    [qualityOptions, t]
  );
  const activeAudio =
    audioTracks.find((track) => track.id === selectedAudioTrackId) ?? audioTracks[0];
  const activeSubtitle = subtitleTracks.find(
    (track) => track.id === selectedSubtitleTrackId
  );
  const volumeTrackStyle = useMemo(
    () => ({
      background: `linear-gradient(to right, var(--player-accent) ${volumePct}%, rgba(255,255,255,0.25) ${volumePct}%)`,
    }),
    [volumePct]
  );

  const openQualityMenu = useCallback(() => {
    if (qualitySwitching || qualityOptions.length === 0) return;
    setAudioMenuOpen(false);
    setSubtitleMenuOpen(false);
    setQualityMenuOpen(true);
    window.requestAnimationFrame(() => {
      const activeOption = qualityOptionRefs.current.get(activeQualityId);
      const firstOption = qualityOptionRefs.current.values().next().value;
      (activeOption ?? firstOption)?.focus();
    });
  }, [activeQualityId, qualityOptions, qualitySwitching]);

  const closeQualityMenu = useCallback(() => {
    setQualityMenuOpen(false);
    window.requestAnimationFrame(() => qualityButtonRef.current?.focus());
  }, []);

  const openAudioMenu = useCallback(() => {
    if (audioTracks.length === 0) return;
    setQualityMenuOpen(false);
    setSubtitleMenuOpen(false);
    setAudioMenuOpen(true);
    window.requestAnimationFrame(() => {
      const activeIndex = Math.max(
        0,
        audioTracks.findIndex((track) => track.id === selectedAudioTrackId)
      );
      audioOptionRefs.current[activeIndex]?.focus();
    });
  }, [audioTracks, selectedAudioTrackId]);

  const closeAudioMenu = useCallback(() => {
    setAudioMenuOpen(false);
    window.requestAnimationFrame(() => audioButtonRef.current?.focus());
  }, []);

  const openSubtitleMenu = useCallback(() => {
    setQualityMenuOpen(false);
    setAudioMenuOpen(false);
    setSubtitleMenuOpen(true);
    window.requestAnimationFrame(() => {
      const activeIndex =
        selectedSubtitleTrackId == null
          ? 0
          : Math.max(
              1,
              subtitleTracks.findIndex((track) => track.id === selectedSubtitleTrackId) + 1
            );
      subtitleOptionRefs.current[activeIndex]?.focus();
    });
  }, [selectedSubtitleTrackId, subtitleTracks]);

  const closeSubtitleMenu = useCallback(() => {
    setSubtitleMenuOpen(false);
    window.requestAnimationFrame(() => subtitlesButtonRef.current?.focus());
  }, []);

  const rowControls = useCallback(
    () =>
      [
        previousButtonRef.current,
        playButtonRef.current,
        nextButtonRef.current,
        audioButtonRef.current,
        subtitlesButtonRef.current,
        playlistButtonRef.current,
        qualityButtonRef.current,
        castButtonRef.current,
        healthButtonRef.current,
        playOnButtonRef.current,
        fullscreenButtonRef.current,
      ].filter(
        (control): control is HTMLButtonElement =>
          control !== null && !control.disabled && control.getClientRects().length > 0
      ),
    []
  );

  const commitSeek = useCallback(
    (positionSeconds: number) => {
      queueSeek(positionSeconds);
    },
    [queueSeek]
  );

  const handleQualityMenuKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!qualityMenuOpen) return;
      const options = Array.from(
        event.currentTarget.querySelectorAll<HTMLButtonElement>(
          "[data-quality-id]:not(:disabled)"
        )
      );
      const focused = options.find((option) => option === document.activeElement);
      const row = Number(focused?.dataset.qualityRow ?? options[0]?.dataset.qualityRow ?? 0);
      const column = Number(
        focused?.dataset.qualityColumn ?? options[0]?.dataset.qualityColumn ?? 0
      );
      let nextOption: HTMLButtonElement | undefined;
      switch (event.key) {
        case "ArrowLeft":
        case "ArrowRight": {
          const direction = event.key === "ArrowLeft" ? -1 : 1;
          nextOption = options
            .filter((option) => Number(option.dataset.qualityRow) === row)
            .sort(
              (left, right) =>
                direction *
                (Number(left.dataset.qualityColumn) -
                  Number(right.dataset.qualityColumn))
            )
            .find(
              (option) =>
                direction * (Number(option.dataset.qualityColumn) - column) > 0
            );
          break;
        }
        case "ArrowUp":
        case "ArrowDown": {
          const direction = event.key === "ArrowUp" ? -1 : 1;
          const rows = [
            ...new Set(options.map((option) => Number(option.dataset.qualityRow))),
          ].sort((left, right) => left - right);
          const rowIndex = rows.indexOf(row);
          const targetRow = rows[rowIndex + direction];
          if (targetRow === undefined && direction > 0) {
            event.preventDefault();
            event.stopPropagation();
            closeQualityMenu();
            return;
          }
          nextOption = options
            .filter((option) => Number(option.dataset.qualityRow) === targetRow)
            .sort(
              (left, right) =>
                Math.abs(Number(left.dataset.qualityColumn) - column) -
                Math.abs(Number(right.dataset.qualityColumn) - column)
            )[0];
          break;
        }
        case "Home":
          nextOption = options[0];
          break;
        case "End":
          nextOption = options[options.length - 1];
          break;
        default:
          if (isBackKey(event)) {
            event.preventDefault();
            event.stopPropagation();
            closeQualityMenu();
          }
          return;
      }
      event.preventDefault();
      event.stopPropagation();
      nextOption?.focus();
    },
    [closeQualityMenu, qualityMenuOpen]
  );

  const handleTrackMenuKeyDown = useCallback(
    (
      event: ReactKeyboardEvent<HTMLDivElement>,
      optionRefs: Array<HTMLButtonElement | null>,
      optionCount: number,
      closeMenu: () => void,
      leftTarget?: HTMLButtonElement | null
    ) => {
      const focusedIndex = optionRefs.findIndex((element) => element === document.activeElement);
      let nextIndex: number | undefined;
      switch (event.key) {
        case "ArrowUp":
          nextIndex = Math.max(0, focusedIndex - 1);
          break;
        case "ArrowDown":
          if (focusedIndex >= optionCount - 1) {
            event.preventDefault();
            event.stopPropagation();
            closeMenu();
            return;
          }
          nextIndex = focusedIndex < 0 ? 0 : focusedIndex + 1;
          break;
        case "Home":
          nextIndex = 0;
          break;
        case "End":
          nextIndex = optionCount - 1;
          break;
        case "ArrowLeft":
          event.preventDefault();
          event.stopPropagation();
          closeMenu();
          if (leftTarget) {
            window.requestAnimationFrame(() => leftTarget.focus());
          }
          return;
        default:
          if (isBackKey(event)) {
            event.preventDefault();
            event.stopPropagation();
            closeMenu();
          }
          return;
      }
      event.preventDefault();
      event.stopPropagation();
      optionRefs[nextIndex]?.focus();
    },
    []
  );

  const handleControlsKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (
        [...qualityOptionRefs.current.values()].some((option) => option === target) ||
        audioOptionRefs.current.some((option) => option === target) ||
        subtitleOptionRefs.current.some((option) => option === target)
      ) {
        return;
      }

      if (target === trackRef.current) {
        switch (event.key) {
          case "ArrowLeft":
            event.preventDefault();
            event.stopPropagation();
            commitSeek(displayedPosition - 10);
            return;
          case "ArrowRight":
            event.preventDefault();
            event.stopPropagation();
            commitSeek(displayedPosition + 10);
            return;
          case "Home":
            event.preventDefault();
            event.stopPropagation();
            commitSeek(0);
            return;
          case "End":
            event.preventDefault();
            event.stopPropagation();
            commitSeek(duration);
            return;
          case "ArrowUp":
            event.preventDefault();
            event.stopPropagation();
            if (onNavigateAbove) onNavigateAbove();
            else document.querySelector<HTMLButtonElement>(".player-close")?.focus();
            return;
          case "ArrowDown":
            event.preventDefault();
            event.stopPropagation();
            playButtonRef.current?.focus();
            return;
          case "Enter":
            // SELECT on the scrubber toggles play/pause only: no scrub commit.
            event.preventDefault();
            event.stopPropagation();
            onTogglePlay();
            return;
          default:
            return;
        }
      }

      const controls = rowControls();
      const focusedIndex = controls.findIndex((control) => control === target);
      if (focusedIndex < 0) return;

      switch (event.key) {
        case "ArrowLeft":
          event.preventDefault();
          event.stopPropagation();
          controls[Math.max(0, focusedIndex - 1)]?.focus();
          return;
        case "ArrowRight":
          event.preventDefault();
          event.stopPropagation();
          controls[Math.min(controls.length - 1, focusedIndex + 1)]?.focus();
          return;
        case "ArrowUp":
          event.preventDefault();
          event.stopPropagation();
          if (target === qualityButtonRef.current) {
            openQualityMenu();
          } else if (target === audioButtonRef.current) {
            openAudioMenu();
          } else if (target === subtitlesButtonRef.current) {
            openSubtitleMenu();
          } else if (target === playlistButtonRef.current) {
            onTogglePlaylist();
          } else {
            trackRef.current?.focus();
          }
          return;
        case "ArrowDown":
          event.preventDefault();
          event.stopPropagation();
          onNavigateBelow?.();
          return;
        default:
          return;
      }
    },
    [
      commitSeek,
      displayedPosition,
      duration,
      onNavigateAbove,
      onNavigateBelow,
      onTogglePlay,
      onTogglePlaylist,
      openAudioMenu,
      openQualityMenu,
      openSubtitleMenu,
      rowControls,
    ]
  );

  return (
    <div
      className={`player-controls${visible ? "" : " is-hidden"}`}
      onKeyDown={handleControlsKeyDown}
      onPointerMove={onActivity}
      onFocusCapture={onActivity}
    >
      {contextTitle ? (
        <strong className="player-controls-context-title">{contextTitle}</strong>
      ) : null}
      <div
        ref={trackRef}
        id={seekFocusId}
        className={`player-seek-track${scrubPositionSeconds !== null ? " is-scrubbing" : ""}`}
        onPointerDown={handleSeekPointerDown}
        onPointerMove={handleSeekPointerMove}
        onPointerUp={handleSeekPointerUp}
        onPointerCancel={handleSeekPointerCancel}
        role="slider"
        tabIndex={0}
        aria-label={t("components.player.controls.seek")}
        aria-valuemin={0}
        aria-valuemax={Math.max(duration, 0)}
        aria-valuenow={displayedPosition}
        aria-valuetext={t("components.player.controls.seekValueText", {
          position: formatTime(displayedPosition),
          duration: formatTime(duration),
        })}
      >
        {bufferedRanges.map(([start, end]) => (
          <div
            key={`${start}-${end}`}
            className="player-seek-buffered"
            style={{
              left: duration > 0 ? `${(start / duration) * 100}%` : 0,
              width: duration > 0 ? `${((end - start) / duration) * 100}%` : 0,
            }}
          />
        ))}
        <div className="player-seek-progress" style={{ width: `${playedPct}%` }} />
        <div className="player-seek-thumb" style={{ left: `${playedPct}%` }} />
      </div>

      <div className="player-controls-row">
        <button
          ref={previousButtonRef}
          type="button"
          className="player-btn"
          onClick={onPrevious}
          disabled={!canPrevious || !onPrevious}
          aria-label={t("components.player.controls.previousEpisode")}
        >
          <PreviousIcon />
        </button>

        <button
          ref={playButtonRef}
          id={defaultFocusId}
          type="button"
          className="player-btn player-btn-primary"
          data-player-default-focus
          onClick={onTogglePlay}
          aria-label={
            isPlaying
              ? t("components.player.controls.pause")
              : t("components.player.controls.play")
          }
        >
          {isPlaying ? <PauseIcon /> : <PlayIcon />}
        </button>

        <button
          ref={nextButtonRef}
          type="button"
          className="player-btn"
          onClick={onNext}
          disabled={!canNext || !onNext}
          aria-label={t("components.player.controls.nextEpisode")}
        >
          <NextIcon />
        </button>

        <div className="player-time">
          <span>{formatTime(displayedPosition)}</span>
          <span className="player-time-sep">/</span>
          <span>{formatTime(duration)}</span>
        </div>

        {!systemVolumeOnly && (
          <div className="player-volume">
            <button
              ref={muteButtonRef}
              type="button"
              className="player-btn"
              onClick={() => onSetMuted(!engineState.muted)}
              aria-label={
                engineState.muted
                  ? t("components.player.controls.unmute")
                  : t("components.player.controls.mute")
              }
            >
              {engineState.muted || engineState.volume === 0 ? (
                <VolumeMutedIcon />
              ) : (
                <VolumeHighIcon />
              )}
            </button>
            <input
              type="range"
              className="player-volume-range"
              min={0}
              max={100}
              value={volumePct}
              tabIndex={-1}
              style={volumeTrackStyle}
              onChange={(event) => {
                const next = Number(event.target.value) / 100;
                if (engineState.muted && next > 0) onSetMuted(false);
                onSetVolume(next);
              }}
              aria-label={t("components.player.controls.volume")}
            />
          </div>
        )}

        <div className="player-controls-spacer" />

        <div
          className="player-quality player-track-selector"
          onKeyDown={(event) =>
            handleTrackMenuKeyDown(
              event,
              audioOptionRefs.current,
              audioTracks.length,
              closeAudioMenu
            )
          }
          onBlur={(event) => {
            if (
              audioMenuOpen &&
              !event.currentTarget.contains(event.relatedTarget as Node | null)
            ) {
              setAudioMenuOpen(false);
            }
          }}
        >
          {audioMenuOpen && (
            <div
              className="player-quality-menu"
              role="menu"
              aria-label={t("components.player.controls.audioTrackMenuLabel")}
            >
              <p className="player-quality-heading">
                {t("components.player.controls.audioHeading")}
              </p>
              {audioTracks.map((track, index) => {
                const selected = track.id === (selectedAudioTrackId ?? activeAudio?.id);
                return (
                  <button
                    key={track.id}
                    ref={(element) => {
                      audioOptionRefs.current[index] = element;
                    }}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    className={`player-quality-option${selected ? " is-selected" : ""}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setAudioMenuOpen(false);
                      onSelectAudioTrack(track.id);
                      window.requestAnimationFrame(() => audioButtonRef.current?.focus());
                    }}
                  >
                    <span>
                      <strong>{audioLabel(track)}</strong>
                    </span>
                    <span className="player-quality-check" aria-hidden="true">
                      {selected ? "✓" : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          <button
            ref={audioButtonRef}
            type="button"
            className="player-btn player-tool-button"
            aria-label={t("components.player.controls.audioButtonLabel", {
              label: (activeAudio ? audioLabel(activeAudio) : undefined) ?? t("components.player.controls.unavailable"),
            })}
            aria-haspopup="menu"
            aria-expanded={audioMenuOpen}
            disabled={audioTracks.length === 0}
            onClick={(event) => {
              event.stopPropagation();
              if (audioMenuOpen) closeAudioMenu();
              else openAudioMenu();
            }}
          >
            <AudioTrackIcon />
          </button>
        </div>

        <div
          className="player-quality player-track-selector"
          onKeyDown={(event) =>
            handleTrackMenuKeyDown(
              event,
              subtitleOptionRefs.current,
              subtitleTracks.length + 1,
              closeSubtitleMenu,
              audioButtonRef.current
            )
          }
          onBlur={(event) => {
            if (
              subtitleMenuOpen &&
              !event.currentTarget.contains(event.relatedTarget as Node | null)
            ) {
              setSubtitleMenuOpen(false);
            }
          }}
        >
          {subtitleMenuOpen && (
            <div
              className="player-quality-menu"
              role="menu"
              aria-label={t("components.player.controls.subtitleTrackMenuLabel")}
            >
              <p className="player-quality-heading">
                {t("components.player.controls.subtitlesHeading")}
              </p>
              {subtitleSwitching ? (
                <p className="player-track-status" role="status">
                  {t("components.player.controls.preparingSubtitles")}
                </p>
              ) : subtitleError ? (
                <p className="player-track-status is-error" role="alert">
                  {subtitleError}
                </p>
              ) : null}
              <button
                ref={(element) => {
                  subtitleOptionRefs.current[0] = element;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={selectedSubtitleTrackId == null}
                className={`player-quality-option${
                  selectedSubtitleTrackId == null ? " is-selected" : ""
                }`}
                onClick={(event) => {
                  event.stopPropagation();
                  setSubtitleMenuOpen(false);
                  onSelectSubtitleTrack(null);
                  window.requestAnimationFrame(() => subtitlesButtonRef.current?.focus());
                }}
              >
                <span>
                  <strong>{t("components.player.controls.off")}</strong>
                  <small>{t("components.player.controls.noSubtitles")}</small>
                </span>
                <span className="player-quality-check" aria-hidden="true">
                  {selectedSubtitleTrackId == null ? "✓" : ""}
                </span>
              </button>
              {subtitleTracks.map((track, index) => {
                const selected = track.id === selectedSubtitleTrackId;
                return (
                  <button
                    key={track.id}
                    ref={(element) => {
                      subtitleOptionRefs.current[index + 1] = element;
                    }}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    className={`player-quality-option${selected ? " is-selected" : ""}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setSubtitleMenuOpen(false);
                      onSelectSubtitleTrack(track.id);
                      window.requestAnimationFrame(() => subtitlesButtonRef.current?.focus());
                    }}
                  >
                    <span>
                      <strong>{subtitleLabel(track)}</strong>
                    </span>
                    <span className="player-quality-check" aria-hidden="true">
                      {selected ? "✓" : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          <button
            ref={subtitlesButtonRef}
            type="button"
            className={`player-btn player-tool-button${
              subtitleSwitching ? " is-busy" : subtitleError ? " is-error" : ""
            }`}
            aria-label={
              subtitleSwitching
                ? t("components.player.controls.subtitlesButtonPreparing")
                : subtitleError
                  ? t("components.player.controls.subtitlesError", { error: subtitleError })
                  : t("components.player.controls.subtitlesButtonLabel", {
                      label: (activeSubtitle ? subtitleLabel(activeSubtitle) : undefined) ?? t("components.player.controls.off"),
                    })
            }
            aria-haspopup="menu"
            aria-expanded={subtitleMenuOpen}
            onClick={(event) => {
              event.stopPropagation();
              if (subtitleMenuOpen) closeSubtitleMenu();
              else openSubtitleMenu();
            }}
          >
            <SubtitlesIcon />
            {subtitleSwitching ? (
              <span className="player-tool-pending" aria-hidden="true" />
            ) : null}
          </button>
        </div>

        <button
          ref={playlistButtonRef}
          type="button"
          className="player-btn player-tool-button"
          data-player-playlist-button
          aria-label={
            playlistCount === 1
              ? t("components.player.controls.playlistLabelSingular", { count: playlistCount })
              : t("components.player.controls.playlistLabelPlural", { count: playlistCount })
          }
          aria-haspopup="dialog"
          aria-expanded={playlistOpen}
          disabled={playlistCount === 0}
          onClick={(event) => {
            event.stopPropagation();
            setQualityMenuOpen(false);
            setAudioMenuOpen(false);
            setSubtitleMenuOpen(false);
            onTogglePlaylist();
          }}
        >
          <PlaylistIcon />
        </button>

        <div
          className="player-quality"
          onKeyDown={handleQualityMenuKeyDown}
          onBlur={(event) => {
            if (
              qualityMenuOpen &&
              !event.currentTarget.contains(event.relatedTarget as Node | null)
            ) {
              setQualityMenuOpen(false);
            }
          }}
        >
          {qualityError && !qualityMenuOpen && (
            <p className="player-quality-error" role="status">
              {t("components.player.controls.qualityChangeError")}
            </p>
          )}
          {qualityMenuOpen && (
            <div
              className="player-quality-menu player-quality-matrix-menu"
              role="menu"
              aria-label={t("components.player.controls.qualityMenuLabel")}
            >
              <p className="player-quality-heading">
                {t("components.player.controls.qualityHeading")}
              </p>
              <QualityMatrix
                variant="player"
                role="menuitemradio"
                availableIds={availableQualityIds}
                selectedId={activeQualityId}
                standaloneChoices={standaloneQualityChoices}
                disabled={qualitySwitching}
                buttonRef={(id, element) => {
                  if (element) {
                    qualityOptionRefs.current.set(id, element);
                  } else {
                    qualityOptionRefs.current.delete(id);
                  }
                }}
                onSelect={(qualityId) => {
                  setQualityMenuOpen(false);
                  onSelectQuality(qualityId);
                  window.requestAnimationFrame(() => qualityButtonRef.current?.focus());
                }}
              />
            </div>
          )}
          <button
            ref={qualityButtonRef}
            type="button"
            className="player-quality-button"
            aria-label={t("components.player.controls.qualityButtonLabel", {
              label: qualityDisplayLabel(activeQuality, t),
            })}
            aria-haspopup="menu"
            aria-expanded={qualityMenuOpen}
            disabled={qualitySwitching || qualityOptions.length === 0}
            title={qualityError}
            onClick={(event) => {
              event.stopPropagation();
              if (qualityMenuOpen) {
                closeQualityMenu();
              } else {
                openQualityMenu();
              }
            }}
            onKeyDown={(event) => {
              if (
                !qualityMenuOpen &&
                (event.key === "ArrowUp" || event.key === "ArrowDown")
              ) {
                event.preventDefault();
                event.stopPropagation();
                openQualityMenu();
              }
            }}
          >
            <span className="player-quality-glyph" aria-hidden="true">
              {activeQualityBadge}
            </span>
            <span>
              {qualitySwitching
                ? t("components.player.controls.changingQuality")
                : qualityDisplayLabel(activeQuality, t)}
            </span>
          </button>
        </div>

        {castAvailable && onToggleCast && (
          <CastButton
            ref={castButtonRef}
            available={castAvailable}
            connected={castConnected}
            deviceName={castDeviceName}
            onToggleCast={onToggleCast}
          />
        )}

        {onOpenHealth && (
          <button
            ref={healthButtonRef}
            type="button"
            className="player-btn player-tool-button"
            data-player-health-button
            aria-label={t("components.playbackHealth.open")}
            aria-haspopup="dialog"
            onClick={(event) => {
              event.stopPropagation();
              setQualityMenuOpen(false);
              setAudioMenuOpen(false);
              setSubtitleMenuOpen(false);
              onOpenHealth();
            }}
          >
            <HealthIcon />
          </button>
        )}

        {onPlayOnDevice && (
          <button
            ref={playOnButtonRef}
            type="button"
            className="player-btn"
            onClick={onPlayOnDevice}
            aria-label={t("remote.playOn.button")}
            title={t("remote.playOn.button")}
          >
            <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="2.5" y="5" width="13" height="9" rx="1.2" />
              <path d="M6 18h6M9 14v4" />
              <rect x="17" y="9" width="5" height="10" rx="1.2" />
            </svg>
          </button>
        )}

        {!systemVolumeOnly && (
          <button
            ref={fullscreenButtonRef}
            type="button"
            className="player-btn"
            onClick={onToggleFullscreen}
            aria-label={
              isFullscreen
                ? t("components.player.controls.exitFullscreen")
                : t("components.player.controls.enterFullscreen")
            }
          >
            {isFullscreen ? <FullscreenExitIcon /> : <FullscreenEnterIcon />}
          </button>
        )}
      </div>
    </div>
  );
}
