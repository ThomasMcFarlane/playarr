import type {
  ApiClient,
  SeasonDetail,
  ResumeOption,
  ResumeOptionKind,
  ResumePlan,
  WorkDetail,
} from "@playarr-tv/api-client";
import type { PlayerPlaylistItem } from "../components/player/PlayerSurface";
import type { PlayerLocationState } from "../pages/Player";
import type { TranslationKey } from "./i18n/translations";

/** The query-cache key of a series' resume plan (shared by the detail page and the focus prefetch). */
export const resumePlanKey = (seriesId: string) => `resume-plan:${seriesId}`;
/** What a resume plan depends on: watch history and the catalogue. */
export const RESUME_PLAN_TAGS = ["progress", "catalog"] as const;

/**
 * Warms the query cache with a series' resume plan, so opening the detail paints the Resume button in its first
 * frame instead of holding its place with a skeleton until the request returns. A no-op while the cache is off and
 * when one is stored or already loading; a failure (an older server has no plan) is left to the page.
 */
export function prefetchResumePlan(client: ApiClient, seriesId: string): Promise<void> {
  const { queries } = client;
  if (!queries.enabled) return Promise.resolve();
  return queries
    .fetch(resumePlanKey(seriesId), () => client.getResumePlan(seriesId), { tags: RESUME_PLAN_TAGS, ttlMs: 30_000 })
    .then(() => undefined, () => undefined);
}

type TFunc = (key: TranslationKey, params?: Record<string, string | number>) => string;

/** Label key for the series detail's primary button, from the server's plan. */
export function resumeButtonLabelKey(plan: ResumePlan): TranslationKey {
  switch (plan.action) {
    case "start":
      return "pages.workDetail.startSeries";
    case "restart":
      return "pages.workDetail.watchAgain";
    default:
      return "pages.workDetail.resumeSeries";
  }
}

/** Accessible-name key for the primary button. */
export function resumeButtonTitleKey(plan: ResumePlan): TranslationKey {
  switch (plan.action) {
    case "start":
      return "pages.workDetail.startSeriesTitle";
    case "restart":
      return "pages.workDetail.watchAgainTitle";
    default:
      return "pages.workDetail.resumeSeriesTitle";
  }
}

/** Short caption saying why an option is offered. */
export function resumeOptionCaptionKey(kind: ResumeOptionKind): TranslationKey {
  switch (kind) {
    case "unfinished":
      return "components.resumeChooser.unfinished";
    case "missed_episode":
      return "components.resumeChooser.missedEpisode";
    case "continue_from_last_watched":
      return "components.resumeChooser.continueFromLast";
    case "next_in_series":
      return "components.resumeChooser.nextInSeries";
    default:
      return "components.resumeChooser.startOver";
  }
}

/** True when Home must show the series as a stacked card and ask there. */
export function isStackedPlan(plan: ResumePlan | undefined): plan is ResumePlan {
  return plan !== undefined && plan.needs_choice && plan.options.length > 1;
}

/** "4 Oct 2026" in the viewer's language, or null for a missing/invalid stamp. */
export function formatLastWatched(
  value: string | null | undefined,
  language: string
): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(language, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

/** Playlist (in watch order) for a series, built from its catalogue detail. */
export function seriesPlaylist(detail: WorkDetail, t: TFunc): PlayerPlaylistItem[] {
  if (typeof detail.children !== "object" || !("Series" in detail.children)) return [];
  return [...detail.children.Series]
    .sort((a, b) => a.season.season_number - b.season.season_number)
    .flatMap((season) =>
      [...season.episodes]
        .filter((episode) => episode.media_file_id != null)
        .sort((a, b) => a.episode.episode_number - b.episode.episode_number)
        .map((episode) => ({
          mediaFileId: episode.media_file_id!,
          title:
            episode.episode.title ??
            t("pages.workDetail.episodeNumber", { number: episode.episode.episode_number }),
          subtitle: detail.work.title,
          synopsis: episode.episode.overview ?? detail.work.overview ?? undefined,
          episodeId: episode.episode.id,
          seasonNumber: season.season.season_number,
          episodeNumber: episode.episode.episode_number,
        }))
    );
}

/** Player route state for playing one resume option. */
export function resumePlayerState(
  option: ResumeOption,
  seriesTitle: string,
  playlistItems: PlayerPlaylistItem[],
  base: Pick<
    PlayerLocationState,
    "backTo" | "detailParentBackTo" | "navigationOrigin" | "detailNavigationOrigin" | "serverUrl"
  >,
  t: TFunc
): PlayerLocationState {
  const episodeTitle =
    option.title ?? t("pages.workDetail.episodeNumber", { number: option.episode_number });
  return {
    ...base,
    title: t("pages.workDetail.seriesTitleSeparator", {
      series: seriesTitle,
      title: episodeTitle,
    }),
    episodeId: option.episode_id,
    mediaFileId: option.media_file_id,
    playlistItems,
  };
}

/** The episode the series page opens on, as a season number and an episode id. */
export interface NextUpSelection {
  seasonNumber: number;
  episodeId: string;
}

/**
 * The "next item to play" on a series page: the episode the server's resume plan
 * (the same plan that drives the Play/Resume button) points at. Falls back to the
 * first playable episode when nothing was watched, the plan is missing or
 * unreadable, or its target is not in the catalogue. A fully watched series follows
 * the plan too (the Play button offers "Watch again" with its own target).
 */
export function nextUpSelection(
  seasons: readonly SeasonDetail[],
  plan: ResumePlan | null | undefined,
  seriesWorkId: string
): NextUpSelection | null {
  const playable = seasons.flatMap((season) =>
    season.episodes
      .filter((episode) => episode.media_file_id != null)
      .map((episode) => ({ season, episode }))
  );
  const target = plan?.series_work_id === seriesWorkId ? plan.target : null;
  const match = target
    ? playable.find(({ episode }) => episode.episode.id === target.episode_id) ??
      playable.find(({ episode }) => episode.media_file_id === target.media_file_id)
    : undefined;
  const chosen = match ?? playable[0];
  return chosen
    ? { seasonNumber: chosen.season.season.season_number, episodeId: chosen.episode.episode.id }
    : null;
}
