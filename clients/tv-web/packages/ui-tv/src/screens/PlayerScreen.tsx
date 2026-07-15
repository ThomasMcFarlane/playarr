import { useEffect, useState, type RefObject } from "react";
import type { PlaybackEngine, PlaybackEngineState } from "@streamarr-tv/player-core";
import { color, spacing, typeScale } from "@streamarr-tv/design-tokens";
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
 */
export function PlayerScreen({ engine, title, onExit, seekStepSeconds = 10 }: PlayerScreenProps) {
  const [state, setState] = useState<PlaybackEngineState>(engine.getState());

  useEffect(() => engine.onStateChange(setState), [engine]);

  const isPlaying = state.state === "playing";

  return (
    <div
      style={{
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
      {title && (
        <h2 style={{ fontSize: typeScale.title.fontSize, margin: 0 }}>{title}</h2>
      )}

      <ProgressBar current={state.currentTimeSeconds} duration={state.durationSeconds} />

      <div style={{ display: "flex", alignItems: "center", gap: spacing.md }}>
        <TransportButton
          id="player-back"
          label="< Back"
          onSelect={() => void engine.seek(Math.max(0, state.currentTimeSeconds - seekStepSeconds))}
        />
        <TransportButton
          id="player-play-pause"
          label={isPlaying ? "Pause" : "Play"}
          primary
          onSelect={() => void (isPlaying ? engine.pause() : engine.play())}
        />
        <TransportButton
          id="player-forward"
          label="Forward >"
          onSelect={() =>
            void engine.seek(Math.min(state.durationSeconds, state.currentTimeSeconds + seekStepSeconds))
          }
        />
        {onExit && <TransportButton id="player-exit" label="Exit" onSelect={onExit} />}
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

interface TransportButtonProps {
  id: string;
  label: string;
  primary?: boolean;
  onSelect: () => void;
}

function TransportButton({ id, label, primary, onSelect }: TransportButtonProps) {
  const { ref, isFocused } = useFocusable(id, "player-transport");

  return (
    <button
      ref={ref as RefObject<HTMLButtonElement>}
      type="button"
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
