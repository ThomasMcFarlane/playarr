import type {
  ResumeOption,
  ResumeOptionKind,
  ResumePlan,
  WorkDetail,
} from "@playarr-tv/api-client";
import type { PlayerPlaylistItem } from "../components/player/PlayerSurface";
import type { PlayerLocationState } from "../pages/Player";
import type { TranslationKey } from "./i18n/translations";

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
