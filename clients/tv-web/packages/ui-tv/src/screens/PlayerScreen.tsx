import { useEffect, useState, type RefObject } from "react";
import type { PlaybackEngine, PlaybackEngineState } from "@playarr-tv/player-core";
import { color, spacing, typeScale } from "@playarr-tv/design-tokens";
import { useFocusable } from "../SpatialNavContext";

export interface PlayerScreenProps {
  engine: PlaybackEngine;
  title?: string;
  onExit?: () => void;
  /** Seek step in seconds for the skip-forward/back controls. Defaults to 10. */
  seekStepSeconds?: number;
}

/**
 * Player chrome placeholder: subscribes to a `PlaybackEngine`'s state and
 * renders transport controls. Deliberately has no `<video>` element or any
 * other DOM media node -- that's owned by whichever adapter needs one
 * (`player-shaka` attaches to a `<video>` the app shell provides; Tizen's
 * `player-avplay` has no DOM media element at all, it draws to a native
 * plane via `setDisplayRect`). This screen is therefore reusable as-is by
 * every app shell regardless of which adapter is behind `engine`.
 *
 * When playback ends it shows Replay and Back to details (the minimal end
 * state of docs/architecture/end-of-playback.md); this legacy fallback has no
 * queue or catalogue data, so up-next and suggestions are not available here.
 *
 * Chrome parity with the web and Android players: the only top-level control
 * is an X ("Close player") at the top right that stops playback and returns.
 * There is no top-left back/exit. The controls here never auto-hide, so
 * click/OK can never pause on a reveal; this screen owns no `<video>` (so it
 * has no Picture-in-Picture or mini player to offer) and shows no quality label.
 */
export function PlayerScreen({ engine, title, onExit, seekStepSeconds = 10 }: PlayerScreenProps) {
  const [state, setState] = useState<PlaybackEngineState>(engine.getState());

  useEffect(() => engine.onStateChange(setState), [engine]);

  const isPlaying = state.state === "playing";
  const ended = state.state === "ended";

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        minHeight: "100%",
        background: color.background.base,
        color: color.text.primary,
        padding: spacing.xl,
        gap: spacing.md,
      }}
    >
      {onExit && (
        <div style={{ position: "absolute", top: spacing.xl, right: spacing.xl }}>
          <TransportButton
            id="player-close"
            label="×"
            ariaLabel={PLAYER_CLOSE_LABEL}
            onSelect={() => {
              // Close stops playback, then returns to the previous screen.
              void engine.pause().finally(onExit);
            }}
          />
        </div>
      )}

      {title && (
        <h2 style={{ fontSize: typeScale.title.fontSize, margin: 0 }}>{title}</h2>
      )}

      {ended && (
        <p role="status" style={{ fontSize: typeScale.body.fontSize, margin: 0 }}>
          Finished
        </p>
      )}

      <ProgressBar current={state.currentTimeSeconds} duration={state.durationSeconds} />

      <div style={{ display: "flex", alignItems: "center", gap: spacing.md }}>
        <TransportButton
          id="player-rewind"
          label={`-${seekStepSeconds}s`}
          onSelect={() => void engine.seek(Math.max(0, state.currentTimeSeconds - seekStepSeconds))}
        />
        <TransportButton
          id="player-play-pause"
          label={ended ? "Replay" : isPlaying ? "Pause" : "Play"}
          primary
          onSelect={() =>
            void (ended
              ? engine.seek(0).then(() => engine.play())
              : isPlaying
                ? engine.pause()
                : engine.play())
          }
        />
        <TransportButton
          id="player-forward"
          label={`+${seekStepSeconds}s`}
          onSelect={() =>
            void engine.seek(Math.min(state.durationSeconds, state.currentTimeSeconds + seekStepSeconds))
          }
        />
        {ended && onExit && <TransportButton id="player-exit" label="Back to details" onSelect={onExit} />}
      </div>

      <p style={{ fontSize: typeScale.caption.fontSize, color: color.text.secondary, margin: 0 }}>
        {state.state}
        {state.error ? ` -- ${state.error.message}` : ""}
      </p>
    </div>
  );
}

function ProgressBar({ current, duration }: { current: number; duration: number }) {
  const pct = duration > 0 ? Math.min(100, (current / duration) * 100) : 0;
  return (
    <div
      style={{
        width: "100%",
        height: 6,
        borderRadius: 3,
        backgroundColor: color.background.raised,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${pct}%`,
          height: "100%",
          backgroundColor: color.brand.primary,
          transition: "width 200ms linear",
        }}
      />
    </div>
  );
}

/** Accessible name of the top-right X, shared by every Playarr player chrome. */
export const PLAYER_CLOSE_LABEL = "Close player";

interface TransportButtonProps {
  id: string;
  label: string;
  ariaLabel?: string;
  primary?: boolean;
  onSelect: () => void;
}

function TransportButton({ id, label, ariaLabel, primary, onSelect }: TransportButtonProps) {
  const { ref, isFocused } = useFocusable(id, "player-transport");

  return (
    <button
      ref={ref as RefObject<HTMLButtonElement>}
      type="button"
      aria-label={ariaLabel}
      onClick={onSelect}
      style={{
        padding: `${spacing.sm}px ${spacing.lg}px`,
        borderRadius: 8,
        border: isFocused ? `3px solid ${color.focus.ring}` : "3px solid transparent",
        outline: "none",
        backgroundColor: primary ? color.brand.primary : color.background.raised,
        color: color.text.primary,
        fontSize: typeScale.body.fontSize,
        transform: isFocused ? "scale(1.08)" : "scale(1)",
        transition: "transform 150ms cubic-bezier(0.4, 0, 0.2, 1)",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}
