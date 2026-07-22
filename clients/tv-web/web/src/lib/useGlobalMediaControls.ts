import { useEffect, useRef } from "react";

export type GlobalMediaControlAction =
  | "play"
  | "pause"
  | "toggle-playback"
  | "stop"
  | "seek-backward"
  | "seek-forward"
  | "previous-track"
  | "next-track";

interface MediaControlKeystroke {
  key: string;
  repeat?: boolean;
  defaultPrevented?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  typingTarget?: boolean;
}

export function globalMediaControlActionForKeystroke({
  key,
  repeat = false,
  defaultPrevented = false,
  metaKey = false,
  ctrlKey = false,
  altKey = false,
  typingTarget = false,
}: MediaControlKeystroke): GlobalMediaControlAction | null {
  if (repeat || defaultPrevented) return null;

  switch (key) {
    case "MediaPlay":
      return "play";
    case "MediaPause":
      return "pause";
    case "MediaPlayPause":
      return "toggle-playback";
    case "MediaStop":
      return "stop";
    case "MediaRewind":
      return "seek-backward";
    case "MediaFastForward":
      return "seek-forward";
    case "MediaTrackPrevious":
      return "previous-track";
    case "MediaTrackNext":
      return "next-track";
    default:
      break;
  }

  if (metaKey || ctrlKey || altKey || typingTarget) return null;
  return key === "k" || key === " " ? "toggle-playback" : null;
}

interface GlobalMediaControlCallbacks {
  onPlay: () => void;
  onPause: () => void;
  onTogglePlay: () => void;
  onStop?: () => void;
  onSeekBackward?: () => void;
  onSeekForward?: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
}

interface MediaSessionLike {
  playbackState: MediaSessionPlaybackState;
  setActionHandler(
    action: MediaSessionAction,
    handler: MediaSessionActionHandler | null
  ): void;
}

function setMediaSessionHandler(
  mediaSession: MediaSessionLike,
  action: MediaSessionAction,
  handler: MediaSessionActionHandler | null
) {
  try {
    mediaSession.setActionHandler(action, handler);
  } catch {
    // Older browsers expose Media Session while rejecting newer actions.
  }
}

export function installMediaSessionActionHandlers(
  mediaSession: MediaSessionLike,
  callbacks: GlobalMediaControlCallbacks
): () => void {
  const handlers: Array<
    [MediaSessionAction, MediaSessionActionHandler | null]
  > = [
    ["play", callbacks.onPlay],
    ["pause", callbacks.onPause],
    ["previoustrack", callbacks.onPrevious ?? null],
    ["nexttrack", callbacks.onNext ?? null],
  ];

  handlers.forEach(([action, handler]) =>
    setMediaSessionHandler(mediaSession, action, handler)
  );

  return () => {
    handlers.forEach(([action]) =>
      setMediaSessionHandler(mediaSession, action, null)
    );
  };
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) {
    return [
      "date",
      "datetime-local",
      "email",
      "month",
      "number",
      "password",
      "search",
      "tel",
      "text",
      "time",
      "url",
      "week",
    ].includes(target.type);
  }
  return (
    target instanceof Element &&
    Boolean(
      target.closest('[contenteditable]:not([contenteditable="false"])')
    )
  );
}

function runMediaControlAction(
  action: GlobalMediaControlAction,
  callbacks: GlobalMediaControlCallbacks
): boolean {
  switch (action) {
    case "play":
      callbacks.onPlay();
      return true;
    case "pause":
      callbacks.onPause();
      return true;
    case "toggle-playback":
      callbacks.onTogglePlay();
      return true;
    case "stop":
      callbacks.onStop?.();
      return Boolean(callbacks.onStop);
    case "seek-backward":
      callbacks.onSeekBackward?.();
      return Boolean(callbacks.onSeekBackward);
    case "seek-forward":
      callbacks.onSeekForward?.();
      return Boolean(callbacks.onSeekForward);
    case "previous-track":
      callbacks.onPrevious?.();
      return Boolean(callbacks.onPrevious);
    case "next-track":
      callbacks.onNext?.();
      return Boolean(callbacks.onNext);
  }
}

export function useGlobalMediaControls({
  onPlay,
  onPause,
  onTogglePlay,
  onStop,
  onSeekBackward,
  onSeekForward,
  onPrevious,
  onNext,
  playbackState,
}: GlobalMediaControlCallbacks & { playbackState: string }) {
  const callbacksRef = useRef<GlobalMediaControlCallbacks>({
    onPlay,
    onPause,
    onTogglePlay,
    onStop,
    onSeekBackward,
    onSeekForward,
    onPrevious,
    onNext,
  });
  callbacksRef.current = {
    onPlay,
    onPause,
    onTogglePlay,
    onStop,
    onSeekBackward,
    onSeekForward,
    onPrevious,
    onNext,
  };

  const canPrevious = Boolean(onPrevious);
  const canNext = Boolean(onNext);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const action = globalMediaControlActionForKeystroke({
        key: event.key,
        repeat: event.repeat,
        defaultPrevented: event.defaultPrevented,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        typingTarget: isTypingTarget(event.target),
      });
      if (!action || !runMediaControlAction(action, callbacksRef.current)) return;

      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener("keydown", handleKeyDown, true);

    const mediaSession = navigator.mediaSession;
    const removeMediaSessionHandlers = mediaSession
      ? installMediaSessionActionHandlers(mediaSession, {
          onPlay: () => callbacksRef.current.onPlay(),
          onPause: () => callbacksRef.current.onPause(),
          onTogglePlay: () => callbacksRef.current.onTogglePlay(),
          onPrevious: canPrevious
            ? () => callbacksRef.current.onPrevious?.()
            : undefined,
          onNext: canNext ? () => callbacksRef.current.onNext?.() : undefined,
        })
      : undefined;

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      removeMediaSessionHandlers?.();
    };
  }, [canNext, canPrevious]);

  useEffect(() => {
    const mediaSession = navigator.mediaSession;
    if (!mediaSession) return;

    try {
      mediaSession.playbackState =
        playbackState === "playing" || playbackState === "buffering"
          ? "playing"
          : playbackState === "paused"
            ? "paused"
            : "none";
    } catch {
      // A partially implemented Media Session API must not affect playback.
    }
  }, [playbackState]);
}
