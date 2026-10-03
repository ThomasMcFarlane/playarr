/**
 * Pure helpers for executing phone-remote commands on this device
 * (docs/architecture/remote-control.md). Kept free of React and the DOM
 * singletons so the behaviour is unit-testable.
 */

/** Command kinds this web client can execute, advertised as capabilities. */
export const WEB_TARGET_CAPABILITIES = ["navigate", "text", "playback", "handoff"] as const;
/** Minimal capability set while merely playing (so the title can be handed off). */
export const WEB_HANDOFF_ONLY_CAPABILITIES = ["handoff"] as const;

const NAVIGATION_KEY_MAP: Record<string, { key: string; keyCode: number }> = {
  up: { key: "ArrowUp", keyCode: 38 },
  down: { key: "ArrowDown", keyCode: 40 },
  left: { key: "ArrowLeft", keyCode: 37 },
  right: { key: "ArrowRight", keyCode: 39 },
  back: { key: "Escape", keyCode: 27 },
};

export type RemoteCommandOutcome =
  | { status: "ok" }
  | { status: "failed"; detail: string }
  | { status: "unsupported"; detail: string };

/** Key to synthesise for a directional/back navigation command, or `null` (select/home are handled separately). */
export function navigationKeyFor(key: string): { key: string; keyCode: number } | null {
  return NAVIGATION_KEY_MAP[key] ?? null;
}

export interface TextCommandArgs {
  value: string;
  mode: "insert" | "replace" | "backspace";
  submit: boolean;
}

export function parseTextArgs(args: Record<string, unknown>): TextCommandArgs {
  const mode = args.mode === "replace" || args.mode === "backspace" ? args.mode : "insert";
  return {
    value: typeof args.value === "string" ? args.value : "",
    mode,
    submit: args.submit === true,
  };
}

/** Applies a text command to a field value and selection; returns the new value and caret. */
export function applyTextCommand(
  current: string,
  selectionStart: number,
  selectionEnd: number,
  args: TextCommandArgs
): { value: string; caret: number } {
  const start = Math.max(0, Math.min(selectionStart, current.length));
  const end = Math.max(start, Math.min(selectionEnd, current.length));
  switch (args.mode) {
    case "replace":
      return { value: args.value, caret: args.value.length };
    case "backspace": {
      if (end > start) {
        return { value: current.slice(0, start) + current.slice(end), caret: start };
      }
      if (start === 0) return { value: current, caret: 0 };
      return { value: current.slice(0, start - 1) + current.slice(end), caret: start - 1 };
    }
    default: {
      const value = current.slice(0, start) + args.value + current.slice(end);
      return { value, caret: start + args.value.length };
    }
  }
}

/** The side-effect surface a playback command needs; implemented by the active player. */
export interface RemotePlayerControls {
  mediaFileId: string;
  snapshot(): { positionMs: number; durationMs: number; paused: boolean };
  /** True once media is loaded and controllable (used to acknowledge a handoff). */
  isReady(): boolean;
  title?: string;
  play(): void;
  pause(): void;
  seekToMs(positionMs: number): void;
  setVolume(volume: number): void;
  stop(): void;
  next?(): void;
  previous?(): void;
  setAudioLanguage?(language: string): boolean;
  setSubtitleLanguage?(language: string | null): boolean;
}

export function executePlaybackCommand(
  player: RemotePlayerControls | null,
  args: Record<string, unknown>
): RemoteCommandOutcome {
  if (!player) return { status: "failed", detail: "nothing is playing" };
  const unsupported = (detail: string): RemoteCommandOutcome => ({ status: "unsupported", detail });
  switch (args.action) {
    case "play":
      player.play();
      return { status: "ok" };
    case "pause":
      player.pause();
      return { status: "ok" };
    case "toggle":
      if (player.snapshot().paused) player.play();
      else player.pause();
      return { status: "ok" };
    case "stop":
      player.stop();
      return { status: "ok" };
    case "seek": {
      if (typeof args.position_ms !== "number") return { status: "failed", detail: "missing position" };
      player.seekToMs(Math.max(0, args.position_ms));
      return { status: "ok" };
    }
    case "seek_by": {
      if (typeof args.delta_ms !== "number") return { status: "failed", detail: "missing delta" };
      const { positionMs, durationMs } = player.snapshot();
      const target = Math.max(0, positionMs + args.delta_ms);
      player.seekToMs(durationMs > 0 ? Math.min(target, durationMs) : target);
      return { status: "ok" };
    }
    case "volume": {
      if (typeof args.level !== "number") return { status: "failed", detail: "missing level" };
      player.setVolume(Math.min(1, Math.max(0, args.level / 100)));
      return { status: "ok" };
    }
    case "next":
      if (!player.next) return unsupported("no next item");
      player.next();
      return { status: "ok" };
    case "previous":
      if (!player.previous) return unsupported("no previous item");
      player.previous();
      return { status: "ok" };
    case "set_audio": {
      if (!player.setAudioLanguage) return unsupported("audio selection unavailable");
      return player.setAudioLanguage(String(args.language ?? ""))
        ? { status: "ok" }
        : { status: "failed", detail: "no matching audio track" };
    }
    case "set_subtitle": {
      if (!player.setSubtitleLanguage) return unsupported("subtitle selection unavailable");
      const language = String(args.language ?? "off");
      return player.setSubtitleLanguage(language === "off" ? null : language)
        ? { status: "ok" }
        : { status: "failed", detail: "no matching subtitle track" };
    }
    default:
      return unsupported("unknown playback action");
  }
}

/** Default name shown to controllers for this device. */
export function defaultDeviceName(platform: string, isTv: boolean): string {
  if (isTv) {
    return (
      {
        "android-tv": "Android TV",
        "tv-webos": "LG TV",
        "tv-tizen": "Samsung TV",
        "tv-vidaa": "Hisense TV",
        xbox: "Xbox",
      } as Record<string, string>
    )[platform] ?? "TV";
  }
  return "Web browser";
}
