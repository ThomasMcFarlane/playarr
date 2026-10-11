// core/WatchState.ts: which watch mark a title card shows, ported from web components/WatchStateOverlay.tsx.
import type { WatchProgress, WatchProgressState } from "./Types/Playback.ts";

/** What a card draws: an unseen dot, a progress bar (`progress` in [0, 1]), or nothing. */
export interface WatchMark {
  unseen: boolean;
  progress: number;
}

const NO_MARK: WatchMark = { unseen: false, progress: -1 };

function statePriority(state: WatchProgressState): number {
  if (state === "part_watched") {
    return 2;
  }
  return state === "watched" ? 1 : 0;
}

/** One row per work: a part-watched file beats a watched one, which beats an unseen one (web). */
export function indexWatchProgressByWork(rows: WatchProgress[]): Map<string, WatchProgress> {
  const byWork = new Map<string, WatchProgress>();
  for (const row of rows) {
    const current = byWork.get(row.work_id);
    if (current === undefined || statePriority(row.state) > statePriority(current.state)) {
      byWork.set(row.work_id, row);
    }
  }
  return byWork;
}

/**
 * Web's overlay rule: part watched draws progress; unseen draws the dot, and so does a work with no row
 * once the progress list has loaded (`showUnwatched`); watched draws nothing.
 */
export function watchMarkFor(progress: WatchProgress | undefined, progressLoaded: boolean): WatchMark {
  if (progress !== undefined && progress.state === "part_watched") {
    const fraction = progress.duration_ms > 0 ? progress.position_ms / progress.duration_ms : 0;
    return { unseen: false, progress: Math.min(1, Math.max(0, fraction)) };
  }
  if ((progress !== undefined && progress.state === "unseen") || (progress === undefined && progressLoaded)) {
    return { unseen: true, progress: -1 };
  }
  return NO_MARK;
}
