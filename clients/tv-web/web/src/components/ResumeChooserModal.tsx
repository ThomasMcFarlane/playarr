import { useEffect, useRef } from "react";
import type { ResumeOption, ResumePlan } from "@playarr-tv/api-client";
import { Button } from "./ui";
import { useLanguage } from "../lib/i18n/LanguageProvider";
import { formatLastWatched, resumeOptionCaptionKey } from "../lib/resumePlan";
import { isBackKey } from "../lib/backKey";
import { useRestoreFocusOnClose } from "../lib/useRestoreFocus";

/**
 * Asks where to continue a series when the server's resume plan found an
 * ambiguity (unfinished episodes, a missed episode, a rewatch). Every option
 * is a real button, so D-pad focus, Enter and touch all work; Back/Escape
 * closes without choosing (nothing is recorded).
 */
export function ResumeChooserModal({
  plan,
  seriesTitle,
  onCancel,
  onSelect,
}: {
  plan: ResumePlan;
  seriesTitle: string;
  onCancel: () => void;
  onSelect: (option: ResumeOption) => void;
}) {
  const { t, language } = useLanguage();
  const firstButtonRef = useRef<HTMLButtonElement>(null);

  useRestoreFocusOnClose();
  useEffect(() => {
    firstButtonRef.current?.focus({ preventScroll: true });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isBackKey(event)) return;
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onCancel]);

  return (
    <div className="resume-chooser-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        className="resume-chooser-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="resume-chooser-title"
        data-testid="resume-chooser"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <p className="page-kicker">{t("components.resumeChooser.subtitle")}</p>
        <h2 id="resume-chooser-title">
          {t("components.resumeChooser.title", { title: seriesTitle })}
        </h2>
        <div className="resume-chooser-options" data-tv-scroll-container data-tv-scroll-axis="y">
          {plan.options.map((option, index) => {
            const watched = formatLastWatched(option.last_watched_at, language);
            const showProgress = option.kind === "unfinished";
            return (
              <button
                ref={index === 0 ? firstButtonRef : undefined}
                key={`${option.kind}:${option.episode_id}`}
                type="button"
                className="resume-chooser-option"
                data-option-kind={option.kind}
                data-episode-id={option.episode_id}
                onClick={() => onSelect(option)}
              >
                <span className="resume-chooser-caption">
                  {t(resumeOptionCaptionKey(option.kind))}
                </span>
                <strong>
                  <span className="resume-chooser-label">{option.label}</span>
                  {option.title ? <span> · {option.title}</span> : null}
                </strong>
                {watched ? (
                  <small>{t("components.resumeChooser.lastWatched", { date: watched })}</small>
                ) : null}
                {showProgress ? (
                  <span
                    className="resume-chooser-progress"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={option.progress_percent}
                    aria-label={t("components.resumeChooser.percentWatched", {
                      percent: option.progress_percent,
                    })}
                  >
                    <span style={{ width: `${option.progress_percent}%` }} />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        <Button variant="secondary" onClick={onCancel}>
          {t("components.resumeChooser.cancel")}
        </Button>
      </section>
    </div>
  );
}
