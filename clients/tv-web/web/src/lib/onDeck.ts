import type {
  EpisodeDetail,
  ResumePlan,
  WatchProgress,
  Work,
  WorkChildren,
} from "@playarr-tv/api-client";
import { isStackedPlan } from "./resumePlan";

export interface OnDeckEntry {
  work: Work;
  /** Absent for a series that is on deck only because it needs a Resume choice. */
  progress: WatchProgress | null;
  episode: {
    detail: EpisodeDetail;
    seasonNumber: number;
  } | null;
}

/** The slice of the API client the On Deck loader needs. */
export interface OnDeckClient {
  listResumePlans(): Promise<ResumePlan[]>;
  listWatchProgress(): Promise<WatchProgress[]>;
  getWork(id: string): Promise<{ work: Work; children: WorkChildren }>;
}

export interface OnDeckSink {
  /** False once the caller no longer wants results (unmount or a newer load). Never time-based. */
  isActive(): boolean;
  onProgress(rows: WatchProgress[]): void;
  onStackedPlans(plans: Map<string, ResumePlan>): void;
  onEntries(entries: OnDeckEntry[]): void;
}

function isEpisodic(work: Work): boolean {
  return work.kind === "series" || work.kind === "site";
}

export function findOnDeckEpisode(
  children: WorkChildren,
  mediaFileId: string
): OnDeckEntry["episode"] {
  if (typeof children !== "object" || children === null || !("Series" in children)) {
    return null;
  }
  for (const season of children.Series) {
    const detail = season.episodes.find((episode) => episode.media_file_id === mediaFileId);
    if (detail) return { detail, seasonNumber: season.season.season_number };
  }
  return null;
}

/**
 * Resolves Home's On Deck rail. Results are delivered as they arrive and are
 * never discarded for being slow: on a high-latency link the three dependent
 * round trips (progress, resume plans, per-title detail) can take many seconds,
 * and dropping them left Home on "Start watching" with no stacked card.
 * Throws only when watch progress itself cannot be loaded.
 */
export async function loadOnDeck(client: OnDeckClient, sink: OnDeckSink): Promise<void> {
  // Series whose history is ambiguous are shown as a stacked card (ask on Home).
  const plansRequest: Promise<ResumePlan[]> = client.listResumePlans().catch(() => []);
  const progressRows = await client.listWatchProgress();
  if (!sink.isActive()) return;
  sink.onProgress(progressRows);
  const seenWorkIds = new Set<string>();
  const resumable = [...progressRows]
    .filter((progress) => progress.state === "part_watched")
    .sort((a, b) => new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime())
    .filter((progress) => {
      if (seenWorkIds.has(progress.work_id)) return false;
      seenWorkIds.add(progress.work_id);
      return true;
    })
    .slice(0, 10);
  // The title details depend on the progress rows only, so they are asked for as soon as those arrive, in
  // parallel with the resume plans (the slowest request on a busy server), not after them: a plan only
  // chooses which episode of an already-fetched series leads. This takes the plans off the critical path.
  const detailRequests = resumable.map((progress) =>
    client.getWork(progress.work_id).then(
      (detail) => ({ detail }),
      () => null
    )
  );
  const stacked = (await plansRequest).filter(isStackedPlan);
  const plansByWork = new Map(stacked.map((plan) => [plan.series_work_id, plan]));
  if (!sink.isActive()) return;
  sink.onStackedPlans(plansByWork);

  const resolvedRows = await Promise.all(
    resumable.map(async (progress, index): Promise<OnDeckEntry | null> => {
      // One malformed detail drops only its own row.
      try {
        const resolved = await detailRequests[index];
        if (!resolved) return null;
        const { detail } = resolved;
        // A stacked series shows the plan's lead episode, not just the last one played.
        const lead = plansByWork.get(progress.work_id)?.target;
        const episode = isEpisodic(detail.work)
          ? findOnDeckEpisode(detail.children, lead?.media_file_id ?? progress.media_file_id)
          : null;
        if (isEpisodic(detail.work) && !episode) return null;
        return { work: detail.work, progress, episode };
      } catch {
        return null;
      }
    })
  );
  // Series that need a choice but have no part-watched episode still belong here.
  const rowWorkIds = new Set(resumable.map((progress) => progress.work_id));
  const planOnly = await Promise.all(
    stacked
      .filter((plan) => !rowWorkIds.has(plan.series_work_id))
      .slice(0, Math.max(0, 10 - resumable.length))
      .map(async (plan): Promise<OnDeckEntry | null> => {
        try {
          const detail = await client.getWork(plan.series_work_id);
          const episode = plan.target
            ? findOnDeckEpisode(detail.children, plan.target.media_file_id)
            : null;
          return episode ? { work: detail.work, progress: null, episode } : null;
        } catch {
          return null;
        }
      })
  );
  if (!sink.isActive()) return;
  sink.onEntries([...resolvedRows, ...planOnly].filter((e): e is OnDeckEntry => e !== null));
}
