import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { PlaybackQualityOption } from "@streamarr-tv/api-client";
import type { PlaybackEngineState } from "@streamarr-tv/player-core";
import {
  AudioTrackIcon,
  FullscreenEnterIcon,
  FullscreenExitIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PlaylistIcon,
  PreviousIcon,
  SubtitlesIcon,
  VolumeHighIcon,
  VolumeMutedIcon,
} from "./PlayerIcons";

export interface PlayerTrackOption {
  id: string;
  label: string;
  language?: string;
}

export interface PlayerControlsProps {
  engineState: PlaybackEngineState;
  visible: boolean;
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
}: PlayerControlsProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const previousButtonRef = useRef<HTMLButtonElement>(null);
  const playButtonRef = useRef<HTMLButtonElement>(null);
  const nextButtonRef = useRef<HTMLButtonElement>(null);
  const muteButtonRef = useRef<HTMLButtonElement>(null);
  const audioButtonRef = useRef<HTMLButtonElement>(null);
  const subtitlesButtonRef = useRef<HTMLButtonElement>(null);
  const playlistButtonRef = useRef<HTMLButtonElement>(null);
  const qualityButtonRef = useRef<HTMLButtonElement>(null);
  const fullscreenButtonRef = useRef<HTMLButtonElement>(null);
  const qualityOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const audioOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const subtitleOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeScrubRef = useRef<{
    pointerId: number;
    positionSeconds: number;
  } | null>(null);
  const [scrubPositionSeconds, setScrubPositionSeconds] = useState<number | null>(null);
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
  const [audioMenuOpen, setAudioMenuOpen] = useState(false);
  const [subtitleMenuOpen, setSubtitleMenuOpen] = useState(false);
  const [pendingSeek, setPendingSeek] = useState<{
    positionSeconds: number;
    requestedAt: number;
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
  const isPlaying = engineState.state === "playing" || engineState.state === "buffering";
  const displayedPosition =
    scrubPositionSeconds ?? pendingSeek?.positionSeconds ?? engineState.currentTimeSeconds;
  const playedPct = duration > 0 ? Math.min(100, (displayedPosition / duration) * 100) : 0;

  useEffect(() => {
    if (!pendingSeek || engineState.state === "buffering" || engineState.state === "loading") {
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
      setPendingSeek({
        positionSeconds: finalPosition,
        requestedAt: performance.now(),
      });
      onSeek(finalPosition);
      setScrubPositionSeconds(null);
    },
    [positionFromPointer, onSeek]
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
      const activeIndex = Math.max(
        0,
        qualityOptions.findIndex((quality) => quality.id === activeQualityId)
      );
      qualityOptionRefs.current[activeIndex]?.focus();
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
        fullscreenButtonRef.current,
      ].filter((control): control is HTMLButtonElement => control !== null && !control.disabled),
    []
  );

  const commitSeek = useCallback(
    (positionSeconds: number) => {
      const nextPosition = Math.min(duration, Math.max(0, positionSeconds));
      setPendingSeek({
        positionSeconds: nextPosition,
        requestedAt: performance.now(),
      });
      onSeek(nextPosition);
    },
    [duration, onSeek]
  );

  const handleQualityMenuKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!qualityMenuOpen) return;
      const focusedIndex = qualityOptionRefs.current.findIndex(
        (element) => element === document.activeElement
      );
      let nextIndex: number | undefined;
      switch (event.key) {
        case "ArrowUp":
          nextIndex = Math.max(0, focusedIndex - 1);
          break;
        case "ArrowDown":
          if (focusedIndex >= qualityOptions.length - 1) {
            event.preventDefault();
            event.stopPropagation();
            closeQualityMenu();
            return;
          }
          nextIndex = focusedIndex < 0 ? 0 : focusedIndex + 1;
          break;
        case "Home":
          nextIndex = 0;
          break;
        case "End":
          nextIndex = qualityOptions.length - 1;
          break;
        case "Escape":
        case "BrowserBack":
        case "GoBack":
          event.preventDefault();
          event.stopPropagation();
          closeQualityMenu();
          return;
        default:
          if (event.keyCode === 10009 || event.keyCode === 461) {
            event.preventDefault();
            event.stopPropagation();
            closeQualityMenu();
          }
          return;
      }
      event.preventDefault();
      event.stopPropagation();
      qualityOptionRefs.current[nextIndex]?.focus();
    },
    [closeQualityMenu, qualityMenuOpen, qualityOptions.length]
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
        case "Escape":
        case "BrowserBack":
        case "GoBack":
          event.preventDefault();
          event.stopPropagation();
          closeMenu();
          return;
        default:
          if (event.keyCode === 10009 || event.keyCode === 461) {
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
        qualityOptionRefs.current.some((option) => option === target) ||
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
            document.querySelector<HTMLButtonElement>(".player-back")?.focus();
            return;
          case "ArrowDown":
            event.preventDefault();
            event.stopPropagation();
            (rowControls()[0] ?? qualityButtonRef.current)?.focus();
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
          return;
        default:
          return;
      }
    },
    [
      commitSeek,
      displayedPosition,
      duration,
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
      <div
        ref={trackRef}
        className={`player-seek-track${scrubPositionSeconds !== null ? " is-scrubbing" : ""}`}
        onPointerDown={handleSeekPointerDown}
        onPointerMove={handleSeekPointerMove}
        onPointerUp={handleSeekPointerUp}
        onPointerCancel={handleSeekPointerCancel}
        role="slider"
        tabIndex={0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.max(duration, 0)}
        aria-valuenow={displayedPosition}
        aria-valuetext={`${formatTime(displayedPosition)} of ${formatTime(duration)}`}
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
          aria-label="Previous episode"
        >
          <PreviousIcon />
        </button>

        <button
          ref={playButtonRef}
          type="button"
          className="player-btn player-btn-primary"
          data-player-default-focus
          onClick={onTogglePlay}
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? <PauseIcon /> : <PlayIcon />}
        </button>

        <button
          ref={nextButtonRef}
          type="button"
          className="player-btn"
          onClick={onNext}
          disabled={!canNext || !onNext}
          aria-label="Next episode"
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
              aria-label={engineState.muted ? "Unmute" : "Mute"}
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
              aria-label="Volume"
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
            <div className="player-quality-menu" role="menu" aria-label="Audio track">
              <p className="player-quality-heading">Audio</p>
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
                      <strong>{track.label}</strong>
                      {track.language ? <small>{track.language}</small> : null}
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
            aria-label={`Audio: ${activeAudio?.label ?? "Unavailable"}`}
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
            <div className="player-quality-menu" role="menu" aria-label="Subtitle track">
              <p className="player-quality-heading">Subtitles</p>
              {subtitleSwitching ? (
                <p className="player-track-status" role="status">
                  Preparing subtitles…
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
                  <strong>Off</strong>
                  <small>No subtitles</small>
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
                      <strong>{track.label}</strong>
                      {track.language ? <small>{track.language}</small> : null}
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
                ? "Subtitles: preparing selected track"
                : subtitleError
                  ? `Subtitles error: ${subtitleError}`
                  : `Subtitles: ${activeSubtitle?.label ?? "Off"}`
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
          aria-label={`Playlist: ${playlistCount} ${
            playlistCount === 1 ? "item" : "episodes"
          }`}
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
              Couldn’t change quality
            </p>
          )}
          {qualityMenuOpen && (
            <div className="player-quality-menu" role="menu" aria-label="Playback quality">
              <p className="player-quality-heading">Quality</p>
              {qualityOptions.map((quality, index) => {
                const selected = quality.id === activeQualityId;
                return (
                  <button
                    key={quality.id}
                    ref={(element) => {
                      qualityOptionRefs.current[index] = element;
                    }}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    className={`player-quality-option${selected ? " is-selected" : ""}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setQualityMenuOpen(false);
                      onSelectQuality(quality.id);
                      window.requestAnimationFrame(() => qualityButtonRef.current?.focus());
                    }}
                  >
                    <span>
                      <strong>{quality.label}</strong>
                      {quality.video_bitrate_bps ? (
                        <small>{Math.round(quality.video_bitrate_bps / 1_000_000)} Mbps</small>
                      ) : (
                        <small>Source quality</small>
                      )}
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
            ref={qualityButtonRef}
            type="button"
            className="player-quality-button"
            aria-label={`Quality: ${activeQuality?.label ?? "Original"}`}
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
              HD
            </span>
            <span>{qualitySwitching ? "Changing…" : activeQuality?.label ?? "Original"}</span>
          </button>
        </div>

        {!systemVolumeOnly && (
          <button
            ref={fullscreenButtonRef}
            type="button"
            className="player-btn"
            onClick={onToggleFullscreen}
            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          >
            {isFullscreen ? <FullscreenExitIcon /> : <FullscreenEnterIcon />}
          </button>
        )}
      </div>
    </div>
  );
}
