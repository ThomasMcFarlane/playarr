import type { WatchProgress } from "@streamarr-tv/api-client";
import { useLanguage } from "../lib/i18n/LanguageProvider";

export function indexWatchProgressByWork(
  rows: WatchProgress[]
): Map<string, WatchProgress> {
  const progressByWork = new Map<string, WatchProgress>();

  for (const progress of rows) {
    const current = progressByWork.get(progress.work_id);
    if (!current || watchStatePriority(progress.state) > watchStatePriority(current.state)) {
      progressByWork.set(progress.work_id, progress);
    }
  }

  return progressByWork;
}

export function WatchStateOverlay({
  progress,
  showUnwatched = false,
}: {
  progress?: WatchProgress;
  showUnwatched?: boolean;
}) {
  const { t } = useLanguage();

  if (progress?.state === "part_watched") {
    const progressPercent =
      progress.duration_ms > 0
        ? Math.min(100, Math.max(0, (progress.position_ms / progress.duration_ms) * 100))
        : 0;

    return (
      <span
        className="tv-watch-progress"
        aria-label={t("components.watchStateOverlay.percentWatched", {
          percent: Math.round(progressPercent),
        })}
      >
        <i style={{ width: `${progressPercent}%` }} />
      </span>
    );
  }

  if (progress?.state === "unseen" || (!progress && showUnwatched)) {
    return (
      <span
        className="tv-watch-unseen"
        aria-label={t("components.watchStateOverlay.unwatched")}
      />
    );
  }

  return null;
}

function watchStatePriority(state: WatchProgress["state"]): number {
  if (state === "part_watched") return 2;
  if (state === "watched") return 1;
  return 0;
}
