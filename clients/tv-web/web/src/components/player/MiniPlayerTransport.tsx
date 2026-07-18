import { useRef, type KeyboardEvent } from "react";
import { useLanguage } from "../../lib/i18n/LanguageProvider";
import { NextIcon, PauseIcon, PlayIcon, PreviousIcon } from "./PlayerIcons";

export function MiniPlayerTransport({
  playing,
  canPrevious,
  canNext,
  onPrevious,
  onTogglePlay,
  onNext,
}: {
  playing: boolean;
  canPrevious: boolean;
  canNext: boolean;
  onPrevious?: () => void;
  onTogglePlay: () => void;
  onNext?: () => void;
}) {
  const { t } = useLanguage();
  const controlsRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

    const controls = Array.from(
      controlsRef.current?.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)"
      ) ?? []
    );
    const currentIndex = controls.indexOf(event.target as HTMLButtonElement);
    const nextIndex = currentIndex + (event.key === "ArrowLeft" ? -1 : 1);
    const nextControl = controls[nextIndex];
    if (!nextControl) return;

    event.preventDefault();
    event.stopPropagation();
    nextControl.focus({ preventScroll: true });
  };

  return (
    <div
      ref={controlsRef}
      className="mini-player-transport"
      onKeyDown={handleKeyDown}
    >
      <button
        type="button"
        className="mini-player-control"
        data-navigation-focus-key="shell:mini-player-previous"
        onClick={onPrevious}
        disabled={!canPrevious || !onPrevious}
        aria-label={t("components.player.controls.previousItem")}
      >
        <PreviousIcon />
      </button>
      <button
        type="button"
        className="mini-player-control mini-player-control-primary"
        data-navigation-focus-key="shell:mini-player-playback"
        onClick={onTogglePlay}
        aria-label={
          playing
            ? t("components.player.controls.pause")
            : t("components.player.controls.play")
        }
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <button
        type="button"
        className="mini-player-control"
        data-navigation-focus-key="shell:mini-player-next"
        onClick={onNext}
        disabled={!canNext || !onNext}
        aria-label={t("components.player.controls.nextItem")}
      >
        <NextIcon />
      </button>
    </div>
  );
}
