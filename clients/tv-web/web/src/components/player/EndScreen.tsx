import { useCallback, useEffect, useRef, useState } from "react";
import type { Work } from "@playarr-tv/api-client";
import { CachedArtworkImage } from "../../lib/artwork";
import { useLanguage } from "../../lib/i18n/LanguageProvider";
import {
  END_SCREEN_COUNTDOWN_SECONDS,
  detailRouteForWork,
  type EndScreenKind,
} from "../../lib/endScreen";
import { Button } from "../ui";

export interface EndScreenNextItem {
  title: string;
  subtitle?: string;
  seasonNumber?: number;
  episodeNumber?: number;
}

interface EndScreenProps {
  kind: EndScreenKind;
  /** Title of the item that just finished. */
  title: string;
  subtitle?: string;
  next?: EndScreenNextItem;
  suggestions: Work[];
  onReplay: () => void;
  onExit: () => void;
  onPlayNow: () => void;
  onSelectSuggestion: (route: string) => void;
}

const NAV_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter", " "]);

/**
 * End-of-playback card: Replay / Back to details / suggestions, or an up-next
 * countdown with Play now / Cancel. Spec: docs/architecture/end-of-playback.md.
 */
export function EndScreen({
  kind,
  title,
  subtitle,
  next,
  suggestions,
  onReplay,
  onExit,
  onPlayNow,
  onSelectSuggestion,
}: EndScreenProps) {
  const { t } = useLanguage();
  const rootRef = useRef<HTMLDivElement>(null);
  const [cancelled, setCancelled] = useState(false);
  const [remaining, setRemaining] = useState(END_SCREEN_COUNTDOWN_SECONDS);
  const counting = kind === "up-next" && !cancelled;
  const playNowRef = useRef(onPlayNow);
  playNowRef.current = onPlayNow;

  useEffect(() => {
    if (!counting) return;
    const id = window.setInterval(() => {
      // Paused while the page is hidden; resumes from the same second.
      if (document.hidden) return;
      setRemaining((value) => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [counting]);

  useEffect(() => {
    if (counting && remaining === 0) playNowRef.current();
  }, [counting, remaining]);

  // Keep the screen awake while the card (and its countdown) is visible.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    let released = false;
    const wakeLock = (navigator as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> };
    }).wakeLock;
    void wakeLock?.request("screen").then(
      (sentinel) => {
        if (released) void sentinel.release();
        else lock = sentinel;
      },
      () => undefined
    );
    return () => {
      released = true;
      void lock?.release();
    };
  }, []);

  // Initial focus: the primary action.
  const primaryAction = counting ? "play-now" : "replay";
  useEffect(() => {
    rootRef.current
      ?.querySelector<HTMLElement>("[data-end-screen-primary]")
      ?.focus({ preventScroll: true });
  }, [primaryAction]);

  const cancel = useCallback(() => setCancelled(true), []);

  // D-pad / keyboard: own the directional keys so the video surface behind
  // the card never seeks or toggles. Back is handled by the player page.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const root = rootRef.current;
      if (!root || !NAV_KEYS.has(event.key)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      event.stopPropagation();
      const target = document.activeElement as HTMLElement | null;
      const inCard = Boolean(target && root.contains(target));
      if (!inCard) {
        if (event.key.startsWith("Arrow")) {
          event.preventDefault();
          root.querySelector<HTMLElement>("[data-end-screen-primary]")?.focus();
        }
        return;
      }
      if (event.key === "Enter" || event.key === " ") return; // native click
      event.preventDefault();
      const actions = Array.from(
        root.querySelectorAll<HTMLElement>("[data-end-screen-action]")
      );
      const tiles = Array.from(
        root.querySelectorAll<HTMLElement>("[data-end-screen-tile]")
      );
      const list = tiles.includes(target!) ? tiles : actions;
      const index = list.indexOf(target!);
      if (event.key === "ArrowRight") list[Math.min(list.length - 1, index + 1)]?.focus();
      else if (event.key === "ArrowLeft") list[Math.max(0, index - 1)]?.focus();
      else if (event.key === "ArrowDown" && list === actions) tiles[0]?.focus();
      else if (event.key === "ArrowUp" && list === tiles) actions[0]?.focus();
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, []);

  const nextLabel = next
    ? [
        next.subtitle,
        next.seasonNumber !== undefined && next.episodeNumber !== undefined
          ? `S${next.seasonNumber}:E${next.episodeNumber}`
          : undefined,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  const dialogLabel =
    kind === "up-next" && next
      ? t("components.player.endScreen.upNextLabel", { title: next.title })
      : t("components.player.endScreen.finishedLabel", { title });
  const announcement =
    counting && (remaining === END_SCREEN_COUNTDOWN_SECONDS || remaining === 5 || remaining === 0)
      ? t("components.player.endScreen.playingIn", { seconds: remaining })
      : "";

  return (
    <div
      ref={rootRef}
      className="end-screen"
      role="dialog"
      aria-modal="true"
      aria-label={dialogLabel}
      data-end-screen={kind}
    >
      <div className="end-screen-panel">
        {kind === "up-next" && next ? (
          <section className="end-screen-next">
            <p className="end-screen-kicker">{t("components.player.endScreen.upNext")}</p>
            <h2 className="end-screen-title">{next.title}</h2>
            {nextLabel && <p className="end-screen-subtitle">{nextLabel}</p>}
            {counting ? (
              <>
                <div className="end-screen-countdown" aria-hidden="true">
                  <span
                    className="end-screen-countdown-bar"
                    style={{
                      width: `${(remaining / END_SCREEN_COUNTDOWN_SECONDS) * 100}%`,
                    }}
                  />
                </div>
                <p className="end-screen-subtitle" aria-hidden="true">
                  {t("components.player.endScreen.playingIn", { seconds: remaining })}
                </p>
              </>
            ) : null}
          </section>
        ) : (
          <section className="end-screen-next">
            <p className="end-screen-kicker">{t("components.player.endScreen.finished")}</p>
            <h2 className="end-screen-title">{title}</h2>
            {subtitle && <p className="end-screen-subtitle">{subtitle}</p>}
          </section>
        )}
        <div className="end-screen-actions">
          {kind === "up-next" && (
            <Button
              type="button" variant="primary"
              data-end-screen-action
              {...(primaryAction === "play-now" ? { "data-end-screen-primary": true } : {})}
              onClick={onPlayNow}
            >
              {t("components.player.endScreen.playNow")}
            </Button>
          )}
          {counting && (
            <Button
              type="button" className="on-player"
              data-end-screen-action
              onClick={cancel}
            >
              {t("components.player.endScreen.cancel")}
            </Button>
          )}
          <Button
            type="button"
            variant={primaryAction === "replay" ? "primary" : "secondary"}
            className={primaryAction === "replay" ? undefined : "on-player"}
            data-end-screen-action
            {...(primaryAction === "replay" ? { "data-end-screen-primary": true } : {})}
            onClick={onReplay}
          >
            {t("components.player.endScreen.replay")}
          </Button>
          <Button
            type="button" className="on-player"
            data-end-screen-action
            onClick={onExit}
          >
            {t("pages.player.backToDetails")}
          </Button>
        </div>
        {suggestions.length > 0 && (
          <section
            className="end-screen-suggestions"
            aria-label={t("components.player.endScreen.suggestions")}
          >
            <h3>{t("components.player.endScreen.suggestions")}</h3>
            <div
              className="end-screen-suggestion-row"
              data-tv-scroll-container
              data-tv-scroll-axis="x"
            >
              {suggestions.map((work) => (
                <button
                  key={work.id}
                  type="button"
                  className="media-card end-screen-tile"
                  data-end-screen-tile
                  aria-label={t("pages.workDetail.openTitle", { title: work.title })}
                  onClick={() => onSelectSuggestion(detailRouteForWork(work))}
                >
                  <span className="end-screen-tile-art">
                    <CachedArtworkImage
                      work={work}
                      kinds={["backdrop", "thumb", "poster", "banner"]}
                      alt=""
                      loading="lazy"
                      fallback={<span>{work.title}</span>}
                    />
                  </span>
                  <strong>{work.title}</strong>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
      <p className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
