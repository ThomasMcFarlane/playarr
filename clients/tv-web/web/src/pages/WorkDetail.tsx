import { setScrollInstant, smoothScrollIntoView } from "../lib/smoothScroll";
import { Drawer, PageLayout } from "../components/shell";
import { releaseYear, yearRangeLabel } from "../lib/workYear";
import { WatchlistToggle } from "../components/WatchlistToggle";
import { snapshotFromWork } from "../lib/discovery";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import type {
  CreditResponse,
  EpisodeDetail,
  MediaChapter,
  MediaPlaybackOptions,
  MediaPlaybackPreferences,
  ResumeOption,
  ResumePlan,
  SeasonDetail,
  WatchProgress,
  Work,
  WorkChildren,
  WorkCreditsResponse,
  WorkDetail,
} from "@playarr-tv/api-client";
import { describeApiError } from "@playarr-tv/api-client";
import { useWorkDetail } from "@playarr-tv/api-client/react";
import { AvailabilityLagNote } from "../components/AvailabilityLag";
import { useApiClient } from "../lib/ApiClientProvider";
import { useLiveRevision, useLiveSubscription } from "../lib/liveEvents";
import { knownWork } from "../lib/knownWorks";
import { SkeletonBlock, SkeletonLines, SkeletonRails } from "../components/shell";
import { CachedArtworkImage, PersonHeadshot, useCachedArtwork } from "../lib/artwork";
import { useDownloads } from "../lib/DownloadsProvider";
import type { PlayableLeaf } from "../lib/playableLeaves";
import type { PlaybackLaunchSettings } from "../lib/usePlaybackEngine";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import { useToast } from "../lib/toast";
import { useLanguage } from "../lib/i18n/LanguageProvider";
import type { TranslationKey } from "../lib/i18n/translations";
import {
  readPlayerDefaults,
  selectDefaultSubtitleTrackId,
} from "../lib/playerDefaults";
import {
  navigationOriginFromState,
  useNavigationLayer,
  type NavigationOrigin,
} from "../lib/navigationLayer";
import { MediaThumbnailArtwork } from "../components/MediaThumbnailArtwork";
import { ServerChoiceModal } from "../components/ServerChoiceModal";
import { ResumeChooserModal } from "../components/ResumeChooserModal";
import {
  resumeButtonLabelKey,
  resumeButtonTitleKey,
  nextUpSelection,
  resumePlanKey,
  resumePlayerState,
  RESUME_PLAN_TAGS,
} from "../lib/resumePlan";
import { WatchStateOverlay } from "../components/WatchStateOverlay";
import { useMediaContextMenu } from "../components/MediaContextMenu";
import {
  DownloadQualityDrawer,
  type DownloadQualitySelection,
} from "../components/DownloadQualityDrawer";
import type { PlayerPlaylistItem } from "../components/player/PlayerSurface";
import type { PlayerLocationState } from "./Player";
import {
  getJoinedWorkSources,
  type JoinedWorkSource,
} from "../lib/joinedServers";
import { TvEmptyState } from "../components/tv/TvEmptyState";
import { TvMediaTrack, TvRailSurface, type TvTrackSpacing } from "../components/tv/TvStage";
import { Select } from "../components/ui";
import { RailStack, centreTrackInStack } from "../components/tv/RailStack";

interface MoviePlaybackDraft {
  quality_id: string;
  audio_track_id: string | null;
  subtitle_track_id: string | null;
}

type MoviePlaybackOptionsState =
  | { status: "idle" | "loading" }
  | { status: "ready"; options: MediaPlaybackOptions }
  | { status: "error"; message: string };

type TFunc = (key: TranslationKey, params?: Record<string, string | number>) => string;

function isEpisodicKind(kind: Work["kind"]): boolean {
  return kind === "series" || kind === "site";
}

function playlistFromWorkDetail(detail: WorkDetail, t: TFunc): PlayerPlaylistItem[] {
  if (detail.work.kind === "movie") {
    return detail.media_file_id
      ? [
          {
            mediaFileId: detail.media_file_id,
            title: detail.work.title,
            synopsis: detail.work.overview ?? undefined,
          },
        ]
      : [];
  }
  if (typeof detail.children !== "object" || !("Series" in detail.children)) return [];
  return [...detail.children.Series]
    .sort((left, right) => left.season.season_number - right.season.season_number)
    .flatMap((season) =>
      playableEpisodes(season).map((episode) => ({
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

function detailRouteBase(work: Work): string {
  return work.kind === "site"
    ? "/sites"
    : work.kind === "series"
      ? "/series"
      : "/movies";
}

function workKindLabel(work: Work, t: TFunc): string {
  return work.kind === "site"
    ? t("pages.workDetail.kindSite")
    : work.kind === "series"
      ? t("pages.workDetail.kindSeries")
      : t("pages.workDetail.kindMovie");
}

/**
 * Where Back goes from a title page, and what it is called. Known before the title has loaded, so the header (and Back)
 * stays up while the page loads or fails.
 */
function resolveDetailBack({
  routeBase,
  requestedBackTo,
  pathname,
  search,
  t,
}: {
  routeBase: string;
  requestedBackTo: unknown;
  pathname: string;
  search: string;
  t: TFunc;
}): { backTo: string; backLabel: string } {
  const searchBackTo =
    typeof requestedBackTo === "string" && /^\/search(?:\?.*)?$/.test(requestedBackTo)
      ? requestedBackTo
      : pathname.startsWith("/search/")
        ? `/search${search}`
        : null;
  const playlistBackTo =
    typeof requestedBackTo === "string" &&
    /^\/playlists(?:\?playlist=[^&]+(?:&.*)?)?$/.test(requestedBackTo)
      ? requestedBackTo
      : null;
  const backTo =
    requestedBackTo === "/" ||
    requestedBackTo === "/series" ||
    requestedBackTo === "/movies" ||
    requestedBackTo === "/sites"
      ? requestedBackTo
      : playlistBackTo ?? searchBackTo ?? routeBase;
  const backLabel =
    backTo === "/"
      ? t("pages.workDetail.backHome")
      : backTo === "/series"
        ? t("pages.workDetail.kindSeries")
        : backTo === "/sites"
          ? t("pages.workDetail.backSites")
          : backTo.startsWith("/playlists")
            ? t("pages.workDetail.backPlaylists")
            : backTo.startsWith("/search")
              ? t("pages.workDetail.backSearch")
              : t("pages.workDetail.backMovies");
  return { backTo, backLabel };
}

function playbackDraft(
  preferences: MediaPlaybackPreferences
): MoviePlaybackDraft {
  return {
    quality_id: preferences.quality_id,
    audio_track_id: preferences.audio_track_id ?? null,
    subtitle_track_id: preferences.subtitle_track_id ?? null,
  };
}

function resolvePlaybackLaunchSettings(
  options: MediaPlaybackOptions | null
): PlaybackLaunchSettings | null {
  if (!options) return null;
  const { preferences } = options;
  const playerDefaults = readPlayerDefaults();
  const preferredQualityId =
    preferences.quality_id === "original"
      ? playerDefaults.qualityId
      : preferences.quality_id;
  const quality = options.quality_options.find(
    (option) => option.id === preferredQualityId
  );
  const audio = options.audio_tracks.find(
    (track) => track.id === preferences.audio_track_id
  );
  return {
    qualityId: quality?.id ?? "original",
    profile: quality?.profile ?? null,
    forceTranscode: Boolean(quality && quality.id !== "original"),
    audioTrackId: audio?.id ?? null,
    audioStreamIndex: audio?.stream_index ?? null,
    subtitleTrackId:
      preferences.subtitle_track_id ??
      selectDefaultSubtitleTrackId(options.subtitle_tracks, playerDefaults),
  };
}

function MoviePlaybackSettingsDrawer({
  title,
  state,
  draft,
  saving,
  onChange,
  onSave,
  onClose,
}: {
  title: string;
  state: MoviePlaybackOptionsState;
  draft: MoviePlaybackDraft;
  saving: boolean;
  onChange: (preferences: MoviePlaybackDraft) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();

  const options = state.status === "ready" ? state.options : null;
  return (
    <Drawer
      id="movie-playback-settings"
      className="tv-playback-settings-drawer"
      ariaLabel={t("pages.workDetail.playbackSettingsFor", { title })}
      kicker={t("pages.workDetail.kindMovie")}
      title={t("pages.workDetail.playbackSettingsTitle")}
      closeLabel={t("pages.workDetail.closeSettings")}
      onClose={onClose}
    >

      {state.status === "loading" || state.status === "idle" ? (
        <div className="tv-playback-settings-status" role="status">
          <span className="tv-mini-loader" aria-hidden="true" />
          <p>{t("pages.workDetail.loadingOptions")}</p>
        </div>
      ) : state.status === "error" ? (
        <TvEmptyState
          graphic="details"
          tone="error"
          variant="compact"
          title={t("pages.workDetail.playbackOptionsLoadError")}
          description={state.message}
        />
      ) : options ? (
        <>
          <section>
            <h3>{t("pages.workDetail.qualityHeading")}</h3>
            <Select
              ariaLabel={t("pages.workDetail.qualityHeading")}
              value={draft.quality_id}
              options={options.quality_options.map((quality) => ({
                value: quality.id,
                label: quality.label,
                hint: quality.video_bitrate_bps
                  ? t("pages.workDetail.bitrateMbps", { value: Math.round(quality.video_bitrate_bps / 1_000_000) })
                  : t("pages.workDetail.sourceQuality"),
              }))}
              onChange={(id) => onChange({ ...draft, quality_id: id })}
            />
          </section>

          <section>
            <h3>{t("pages.workDetail.audioHeading")}</h3>
            <Select
              ariaLabel={t("pages.workDetail.audioHeading")}
              value={draft.audio_track_id ?? ""}
              options={[
                { value: "", label: t("pages.workDetail.automatic"), hint: t("pages.workDetail.useYourPreferredLanguage") },
                ...options.audio_tracks.map((track) => ({
                  value: track.id,
                  label: track.label,
                  hint: track.language ?? track.codec ?? t("pages.workDetail.originalAudio"),
                })),
              ]}
              onChange={(id) => onChange({ ...draft, audio_track_id: id === "" ? null : id })}
            />
          </section>

          <section>
            <h3>{t("pages.workDetail.subtitlesHeading")}</h3>
            <Select
              ariaLabel={t("pages.workDetail.subtitlesHeading")}
              value={draft.subtitle_track_id ?? ""}
              options={[
                { value: "", label: t("pages.workDetail.subtitlesOff"), hint: t("pages.workDetail.noSubtitles") },
                ...options.subtitle_tracks.map((track) => ({
                  value: track.id,
                  label: track.label,
                  hint: track.language ?? track.codec ?? undefined,
                })),
              ]}
              onChange={(id) => onChange({ ...draft, subtitle_track_id: id === "" ? null : id })}
            />
          </section>

          <div className="tv-playback-settings-actions">
            <button type="button" onClick={onClose}>
              {t("pages.workDetail.cancel")}
            </button>
            <button type="button" className="is-primary" disabled={saving} onClick={onSave}>
              {saving ? t("pages.workDetail.saving") : t("pages.workDetail.save")}
            </button>
          </div>
        </>
      ) : null}
    </Drawer>
  );
}

function seriesChildren(children: WorkChildren): SeasonDetail[] | null {
  return typeof children === "object" && children !== null && "Series" in children
    ? children.Series
    : null;
}

function playableEpisodes(season: SeasonDetail): EpisodeDetail[] {
  return season.episodes.filter((episode) => episode.media_file_id != null);
}

function formatClock(positionMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(positionMs / 1_000));
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${totalMinutes}:${String(seconds).padStart(2, "0")}`;
}

function formatRuntime(durationMs: number, t: TFunc): string {
  const totalMinutes = Math.max(1, Math.round(durationMs / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return t("pages.workDetail.runtimeMinutes", { minutes });
  return minutes > 0
    ? t("pages.workDetail.runtimeHoursMinutes", { hours, minutes })
    : t("pages.workDetail.runtimeHours", { hours });
}

function formatDetailDate(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function relatedWorkScore(target: Work, candidate: Work): number {
  const targetGenres = new Set(
    target.genres.map((genre) => genre.trim().toLocaleLowerCase())
  );
  const sharedGenres = candidate.genres.reduce(
    (count, genre) =>
      count + (targetGenres.has(genre.trim().toLocaleLowerCase()) ? 1 : 0),
    0
  );
  const sameKind = target.kind === candidate.kind ? 1 : 0;
  const targetYear = releaseYear(target) ?? Number.NaN;
  const candidateYear = releaseYear(candidate) ?? Number.NaN;
  const yearProximity =
    Number.isFinite(targetYear) && Number.isFinite(candidateYear)
      ? Math.max(0, 5 - Math.abs(targetYear - candidateYear) / 5)
      : 0;

  return sharedGenres * 100 + sameKind * 10 + yearProximity;
}

function generatedMovieChapters(runtimeMs: number, t: TFunc): MediaChapter[] {
  if (runtimeMs <= 0) return [];

  const targetIntervalMs = runtimeMs / 10;
  const intervalOptionsMs = [5, 10, 15, 20, 30].map((minutes) => minutes * 60_000);
  const intervalMs =
    intervalOptionsMs.find((candidate) => candidate >= targetIntervalMs) ??
    intervalOptionsMs[intervalOptionsMs.length - 1]!;
  const chapterCount = Math.max(1, Math.ceil(runtimeMs / intervalMs));

  return Array.from({ length: chapterCount }, (_, index) => {
    const startMs = index * intervalMs;
    return {
      index,
      title: t("pages.workDetail.chapterNumber", { number: index + 1 }),
      start_ms: startMs,
      end_ms: Math.min(runtimeMs, startMs + intervalMs),
    };
  });
}

function MovieChapterTrack({
  chapters,
  generated,
  mediaFileId,
  movieTitle,
  workId,
  detailRoute,
  detailParentBackTo,
  playlistItems,
  progress,
  runtimeMs,
  onProgressChanged,
  navigationOrigin,
  detailNavigationOrigin,
  playbackSettings,
  onNavigate,
  workSources,
  onChooseServer,
}: {
  chapters: MediaChapter[];
  generated: boolean;
  mediaFileId: string;
  movieTitle: string;
  workId: string;
  detailRoute: string;
  detailParentBackTo: string;
  playlistItems: PlayerPlaylistItem[];
  progress?: WatchProgress;
  runtimeMs: number;
  onProgressChanged: (workId: string, progress: WatchProgress[]) => void;
  navigationOrigin: NavigationOrigin;
  detailNavigationOrigin: NavigationOrigin | null;
  playbackSettings: PlaybackLaunchSettings | null;
  onNavigate: ReturnType<typeof useNavigationLayer>["captureLink"];
  workSources: JoinedWorkSource[];
  onChooseServer: (state: PlayerLocationState) => void;
}) {
  const { t } = useLanguage();
  const [selectedChapterIndex, setSelectedChapterIndex] = useState(
    chapters[0]?.index ?? 0
  );
  const mediaContext = useMediaContextMenu({ onProgressChanged });
  return (
    <TvMediaTrack
      title={t("pages.workDetail.chaptersHeading")}
      meta={
        generated
          ? t("pages.workDetail.sceneMarkersCount", { count: chapters.length })
          : t("pages.workDetail.chaptersCount", { count: chapters.length })
      }
      ariaLabel={t("pages.workDetail.titleChapters", { title: movieTitle })}
      scrollKey={`detail:${workId}:chapters`}
      itemsKey={chapters
        .map((chapter) => `${chapter.index}:${chapter.start_ms}`)
        .join(":")}
      dataTrackId="chapters"
      overlay={mediaContext.contextMenu}
    >
      {chapters.map((chapter) => (
        <Link
          key={`${chapter.index}-${chapter.start_ms}`}
          to={`/player/${mediaFileId}`}
          state={{
            serverUrl: workSources[0]?.url,
            title: movieTitle,
            backTo: detailRoute,
            detailParentBackTo,
            startPositionSeconds: chapter.start_ms / 1000,
            mediaFileId,
            playlistItems,
            navigationOrigin,
            detailNavigationOrigin,
            playbackSettings,
          }}
          className={`media-card tv-episode-card${
            selectedChapterIndex === chapter.index ? " is-selected" : ""
          }`}
          data-navigation-focus-key={`detail:${workId}:chapter:${chapter.index}`}
          onFocus={() => setSelectedChapterIndex(chapter.index)}
          onClick={(event) => {
            onNavigate(event);
            if (workSources.length > 1) {
              event.preventDefault();
              onChooseServer({
                title: movieTitle,
                backTo: detailRoute,
                detailParentBackTo,
                startPositionSeconds: chapter.start_ms / 1000,
                mediaFileId,
                playlistItems,
                navigationOrigin,
                detailNavigationOrigin,
                playbackSettings,
              });
            }
          }}
          aria-label={t("pages.workDetail.playTitleFrom", {
            title: movieTitle,
            position: chapter.title ?? formatClock(chapter.start_ms),
          })}
          {...mediaContext.itemProps({
            workId,
            title: movieTitle,
            detailRoute,
            parentRoute: detailParentBackTo,
            progress,
            leaves: [
              {
                mediaFileId,
                runtimeMs,
                title: movieTitle,
                workKind: "movie",
              },
            ],
            activateOrigin: true,
            startPositionSeconds: chapter.start_ms / 1000,
          })}
        >
          <MediaThumbnailArtwork
            mediaFileId={mediaFileId}
            positionMs={chapter.start_ms}
            fallback={null}
            className="tv-episode-art"
            intersectionRootSelector=".tv-movie-browser .tv-media-track-scroll"
          >
            <strong>{String(chapter.index + 1).padStart(2, "0")}</strong>
          </MediaThumbnailArtwork>
          <span className="tv-episode-copy">
            <small>{formatClock(chapter.start_ms)}</small>
            <strong>
              {chapter.title ?? t("pages.workDetail.chapterNumber", { number: chapter.index + 1 })}
            </strong>
          </span>
        </Link>
      ))}
    </TvMediaTrack>
  );
}

function personInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  return words
    .slice(0, 2)
    .map((word) => word[0]?.toLocaleUpperCase())
    .join("");
}

interface MoviePeopleGroup {
  key: string;
  title: string;
  credits: CreditResponse[];
}

function groupCrewCredits(credits: CreditResponse[], t: TFunc): MoviePeopleGroup[] {
  const groups = new Map<string, MoviePeopleGroup>();
  for (const credit of credits) {
    const title = credit.department?.trim() || t("pages.workDetail.crewFallback");
    const key = title.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-") || "crew";
    const existing = groups.get(key);
    if (existing) {
      existing.credits.push(credit);
    } else {
      groups.set(key, { key, title, credits: [credit] });
    }
  }
  return [...groups.values()];
}

function MoviePeopleTrack({
  title,
  credits,
  workId,
  groupKey,
  spacing,
}: {
  title: string;
  credits: CreditResponse[];
  workId: string;
  groupKey: string;
  spacing?: TvTrackSpacing;
}) {
  const { t } = useLanguage();
  const [selectedCreditId, setSelectedCreditId] = useState(credits[0]?.id ?? null);

  return (
    <TvMediaTrack
      title={title}
      meta={
        credits.length === 1
          ? t("pages.workDetail.peopleCountOne", { count: credits.length })
          : t("pages.workDetail.peopleCountOther", { count: credits.length })
      }
      ariaLabel={t("pages.workDetail.groupForThisTitle", { title })}
      scrollKey={`detail:${workId}:people:${groupKey}`}
      itemsKey={credits.map((credit) => credit.id).join(":")}
      dataTrackId={`people:${groupKey}`}
      spacing={spacing}
    >
      {credits.map((credit) => {
        const subtitle =
          credit.character?.trim() ||
          credit.job?.trim() ||
          credit.department?.trim() ||
          null;
        const selected = credit.id === selectedCreditId;

        return (
          <article
            key={credit.id}
            tabIndex={0}
            className={`media-card tv-episode-card tv-person-card${selected ? " is-selected" : ""}`}
            data-navigation-focus-key={`detail:${workId}:person:${groupKey}:${credit.id}`}
            onFocus={() => setSelectedCreditId(credit.id)}
            aria-label={`${credit.person.name}${subtitle ? `, ${subtitle}` : ""}`}
          >
            <span className="tv-episode-art tv-person-art">
              <PersonHeadshot
                personId={credit.person.id}
                hasHeadshot={Boolean(credit.person.headshot_url)}
                fallback={
                  <span className="tv-person-placeholder">
                    {personInitials(credit.person.name)}
                  </span>
                }
              />
            </span>
            <span className="tv-episode-copy tv-person-copy">
              <strong>{credit.person.name}</strong>
              {subtitle ? <small>{subtitle}</small> : null}
            </span>
          </article>
        );
      })}
    </TvMediaTrack>
  );
}

function SimilarTitlesTrack({
  works,
  workId,
  detailRoute,
  navigationOrigin,
  onNavigate,
}: {
  works: Work[];
  workId: string;
  detailRoute: string;
  navigationOrigin: NavigationOrigin;
  onNavigate: ReturnType<typeof useNavigationLayer>["captureLink"];
}) {
  const { t } = useLanguage();
  const [selectedWorkId, setSelectedWorkId] = useState(works[0]?.id ?? null);
  const mediaContext = useMediaContextMenu();

  return (
    <TvMediaTrack
      title={t("pages.workDetail.similarTitlesHeading")}
      meta={
        works.length === 1
          ? t("pages.workDetail.titlesCountOne", { count: works.length })
          : t("pages.workDetail.titlesCountOther", { count: works.length })
      }
      ariaLabel={t("pages.workDetail.similarTitlesAriaLabel")}
      scrollKey={`detail:${workId}:similar`}
      itemsKey={works.map((work) => work.id).join(":")}
      dataTrackId="similar"
      spacing="section"
      overlay={mediaContext.contextMenu}
    >
      {works.map((similarWork) => {
        const routeBase = detailRouteBase(similarWork);
        const similarDetailRoute = `${routeBase}/${similarWork.id}`;
        const selected = similarWork.id === selectedWorkId;

        return (
          <Link
            key={similarWork.id}
            to={similarDetailRoute}
            state={{ backTo: detailRoute, navigationOrigin }}
            className={`media-card tv-title-card${selected ? " is-selected" : ""}`}
            data-navigation-focus-key={`detail:${workId}:similar:${similarWork.id}`}
            onFocus={() => setSelectedWorkId(similarWork.id)}
            onClick={onNavigate}
            aria-label={t("pages.workDetail.openTitle", { title: similarWork.title })}
            {...mediaContext.itemProps({
              work: similarWork,
              detailRoute: similarDetailRoute,
              parentRoute: detailRoute,
            })}
          >
            <span className="tv-title-card-art">
              <CachedArtworkImage
                work={similarWork}
                kinds={["backdrop", "poster"]}
                alt=""
                loading="lazy"
                fallback={<span>{similarWork.title}</span>}
              />
            </span>
            <span className="tv-title-card-copy">
              <strong>{similarWork.title}</strong>
              <small>{workKindLabel(similarWork, t)}</small>
            </span>
          </Link>
        );
      })}
    </TvMediaTrack>
  );
}

/** Every downloadable episode of a season as playable leaves (the "Whole season" download scope). */
function seasonDownloadLeaves(
  season: SeasonDetail,
  seriesTitle: string,
  t: ReturnType<typeof useLanguage>["t"]
): PlayableLeaf[] {
  const seasonNumber = season.season.season_number;
  return playableEpisodes(season).flatMap((episode) =>
    episode.media_file_id
      ? [
          {
            mediaFileId: episode.media_file_id,
            runtimeMs: episode.runtime_ms ?? (episode.episode.runtime_minutes ?? 0) * 60_000,
            episodeId: episode.episode.id,
            title:
              episode.episode.title ??
              t("pages.workDetail.episodeNumber", { number: episode.episode.episode_number }),
            seriesTitle,
            seasonNumber,
            episodeNumber: episode.episode.episode_number,
            workKind: "series" as const,
          },
        ]
      : []
  );
}

function SeasonEpisodeTrack({
  season,
  seriesTitle,
  workId,
  detailRoute,
  detailParentBackTo,
  backdrop,
  playlistItems,
  selectedEpisodeId,
  progressByMedia,
  onSelect,
  onProgressChanged,
  navigationOrigin,
  detailNavigationOrigin,
  onNavigate,
  workSources,
  onChooseServer,
  defaultFocusReady,
}: {
  season: SeasonDetail;
  seriesTitle: string;
  workId: string;
  detailRoute: string;
  detailParentBackTo: string;
  backdrop: string | null;
  playlistItems: PlayerPlaylistItem[];
  selectedEpisodeId: string | null;
  progressByMedia: Map<string, WatchProgress>;
  onSelect: (seasonNumber: number, episodeId: string) => void;
  onProgressChanged: (workId: string, progress: WatchProgress[]) => void;
  navigationOrigin: NavigationOrigin;
  detailNavigationOrigin: NavigationOrigin | null;
  onNavigate: ReturnType<typeof useNavigationLayer>["captureLink"];
  workSources: JoinedWorkSource[];
  onChooseServer: (state: PlayerLocationState) => void;
  /** False until the series' next-up episode is known, so default focus never lands on a placeholder. */
  defaultFocusReady: boolean;
}) {
  const { t } = useLanguage();
  const episodes = playableEpisodes(season);
  const seasonNumber = season.season.season_number;
  const seasonLabel =
    season.season.title ?? t("pages.workDetail.seasonNumber", { number: seasonNumber });
  const mediaContext = useMediaContextMenu({ onProgressChanged });
  const seasonLeaves = seasonDownloadLeaves(season, seriesTitle, t);

  return (
    <TvMediaTrack
      title={seasonLabel}
      meta={t("pages.workDetail.episodesCount", { count: episodes.length })}
      ariaLabel={seasonLabel}
      scrollKey={`detail:${workId}:season:${seasonNumber}`}
      itemsKey={episodes.map((episode) => episode.episode.id).join(":")}
      dataTrackId={`season:${seasonNumber}`}
      overlay={mediaContext.contextMenu}
    >
      {episodes.map((episode) => {
            const mediaFileId = episode.media_file_id;
            if (!mediaFileId) return null;
            const isSelected = episode.episode.id === selectedEpisodeId;
            // Artwork preference: the episode's own still (cached by Playarr
            // Server), then the media-file frame thumbnail, then the series
            // backdrop already cached by Playarr Server. The TV never loads
            // the episode provider URL directly.
            const hasStill = episode.episode.images.some((image) => image.kind === "thumb");
            const episodeArtwork = backdrop;
            const progress = progressByMedia.get(mediaFileId);
            const episodeTitle =
              episode.episode.title ??
              t("pages.workDetail.episodeNumber", { number: episode.episode.episode_number });
            return (
              <Link
                key={episode.episode.id}
                to={`/player/${mediaFileId}`}
                state={{
                  serverUrl: workSources[0]?.url,
                  title: t("pages.workDetail.seriesTitleSeparator", {
                    series: seriesTitle,
                    title: episodeTitle,
                  }),
                  backTo: detailRoute,
                  detailParentBackTo,
                  episodeId: episode.episode.id,
                  mediaFileId,
                  playlistItems,
                  navigationOrigin,
                  detailNavigationOrigin,
                }}
                className={`media-card tv-episode-card${isSelected ? " is-selected" : ""}`}
                onFocus={() => {
                  onSelect(seasonNumber, episode.episode.id);
                }}
                onClick={(event) => {
                  onSelect(seasonNumber, episode.episode.id);
                  onNavigate(event);
                  if (workSources.length > 1) {
                    event.preventDefault();
                    onChooseServer({
                      title: t("pages.workDetail.seriesTitleSeparator", {
                        series: seriesTitle,
                        title: episodeTitle,
                      }),
                      backTo: detailRoute,
                      detailParentBackTo,
                      episodeId: episode.episode.id,
                      mediaFileId,
                      playlistItems,
                      navigationOrigin,
                      detailNavigationOrigin,
                    });
                  }
                }}
                aria-current={isSelected ? "true" : undefined}
                data-tv-focus-default={isSelected && defaultFocusReady ? true : undefined}
                data-episode-id={episode.episode.id}
                data-media-file-id={mediaFileId}
                data-navigation-focus-key={`detail:${workId}:episode:${episode.episode.id}`}
                {...mediaContext.itemProps({
                  workId,
                  title:
                    episode.episode.title ??
                    t("pages.workDetail.seriesEpisodeFallback", {
                      series: seriesTitle,
                      number: episode.episode.episode_number,
                    }),
                  detailRoute,
                  parentRoute: detailParentBackTo,
                  progress,
                  preferredMediaFileId: mediaFileId,
                  preferredEpisodeId: episode.episode.id,
                  leaves: [
                    {
                      mediaFileId,
                      runtimeMs:
                        episode.runtime_ms ??
                        (episode.episode.runtime_minutes ?? 0) * 60_000,
                      episodeId: episode.episode.id,
                      title: episodeTitle,
                      seriesTitle,
                      seasonNumber,
                      episodeNumber: episode.episode.episode_number,
                      workKind: "series",
                    },
                  ],
                  downloadScopes: { season: seasonLeaves },
                  activateOrigin: true,
                })}
              >
                <MediaThumbnailArtwork
                  mediaFileId={mediaFileId}
                  fallback={episodeArtwork ?? null}
                  className="tv-episode-art"
                  intersectionRootSelector=".tv-episode-rail"
                  still={hasStill ? { seriesWorkId: workId, episodeId: episode.episode.id } : undefined}
                >
                  <strong>{String(episode.episode.episode_number).padStart(2, "0")}</strong>
                  <WatchStateOverlay progress={progress} showUnwatched />
                </MediaThumbnailArtwork>
                <span className="tv-episode-copy">
                  <small>
                    S{String(seasonNumber).padStart(2, "0")}
                    {" · "}
                    E{String(episode.episode.episode_number).padStart(2, "0")}
                  </small>
                  <strong>{episodeTitle}</strong>
                </span>
              </Link>
            );
      })}
    </TvMediaTrack>
  );
}

/**
 * The detail page while its data loads: the real frame (the same copy column and track surface as the loaded page, so
 * every block sits where its final version will), filled from the card the viewer opened when it is known and with
 * shimmer blocks for the rest.
 */
function DetailPending({ work, fallbackKind, label }: { work: Work | undefined; fallbackKind: "series" | "movie"; label: string }) {
  const series = (work?.kind ?? fallbackKind) === "series";
  return (
    <>
      <aside className="tv-detail-copy" role="status" aria-busy="true" aria-label={label}>
        {work?.genres[0] ? (
          <p className="tv-detail-kicker">{work.genres[0]}</p>
        ) : (
          <SkeletonBlock height="0.8rem" width="6rem" />
        )}
        {work ? (
          <h2 className="tv-detail-title">{work.title}</h2>
        ) : (
          <div className="skeleton-detail-title" aria-hidden="true">
            <SkeletonBlock height="3.4rem" width="min(18rem, 90%)" />
            <SkeletonBlock height="3.4rem" width="min(12rem, 60%)" />
          </div>
        )}
        <div className="tv-detail-meta" aria-hidden="true">
          <SkeletonBlock height="0.8rem" width="12rem" />
        </div>
        <div className="skeleton-detail-synopsis" aria-hidden="true">
          <SkeletonLines count={3} />
        </div>
        <div className="tv-detail-actions" aria-hidden="true">
          <SkeletonBlock height="3.2rem" width="8rem" style={{ borderRadius: 999 }} />
          <SkeletonBlock height="3.2rem" width="8rem" style={{ borderRadius: 999 }} />
        </div>
      </aside>
      <TvRailSurface className={series ? "tv-series-browser" : "tv-movie-browser"} mode="content">
        <div className="skeleton-detail-track" aria-hidden="true">
          <SkeletonRails rails={series ? 2 : 1} cards={5} />
        </div>
      </TvRailSurface>
    </>
  );
}

/** Immersive movie/series/site detail surface modelled on the supplied TV motion reference. */
export function WorkDetailPage() {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { workId } = useParams<{ workId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const client = useApiClient();
  const downloads = useDownloads();
  const liveWorkScope = useMemo(
    () => ({ areas: ["catalog", "progress"] as const, keys: workId ? [workId] : [] }),
    [workId]
  );
  const liveWork = useLiveSubscription(liveWorkScope);
  const liveProgressRevision = useLiveRevision(liveWorkScope);
  const [detailAttempt, setDetailAttempt] = useState(0);
  const state = useWorkDetail(client, workId, { subscribe: liveWork, retryKey: detailAttempt });
  const [selectedSeasonNumber, setSelectedSeasonNumber] = useState<number | null>(null);
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string | null>(null);
  const [progressByMedia, setProgressByMedia] = useState<Map<string, WatchProgress>>(new Map());
  const [runtimeByMedia, setRuntimeByMedia] = useState<Map<string, number>>(new Map());
  const [movieChapters, setMovieChapters] = useState<MediaChapter[]>([]);
  const [workCredits, setWorkCredits] = useState<WorkCreditsResponse | null>(null);
  const [similarWorks, setSimilarWorks] = useState<Work[]>([]);
  const [moviePlaybackOptions, setMoviePlaybackOptions] =
    useState<MoviePlaybackOptionsState>({ status: "idle" });
  const [moviePlaybackDraft, setMoviePlaybackDraft] =
    useState<MoviePlaybackDraft>({
      quality_id: "original",
      audio_track_id: null,
      subtitle_track_id: null,
    });
  const [moviePlaybackSettingsOpen, setMoviePlaybackSettingsOpen] = useState(false);
  const [moviePlaybackSettingsSaving, setMoviePlaybackSettingsSaving] =
    useState(false);
  const [movieDownloadOpen, setMovieDownloadOpen] = useState(false);
  const [movieDownloadBusy, setMovieDownloadBusy] = useState(false);
  // A stored plan (Back, a revisit) is read in the first render, so the Resume button and the next-up episode
  // are in the first frame instead of arriving after the request and pushing the other buttons along.
  const [resumeSeed] = useState(() => (workId ? client.queries.peek<ResumePlan>(resumePlanKey(workId))?.data ?? null : null));
  const [resumePlan, setResumePlan] = useState<ResumePlan | null>(resumeSeed);
  // Series id whose resume plan request has settled (answered or failed): the next-up
  // episode is only known from then on, so initial focus waits for it.
  const [resumePlanSettledFor, setResumePlanSettledFor] = useState<string | null>(resumeSeed ? workId ?? null : null);
  const [resumeChooserOpen, setResumeChooserOpen] = useState(false);
  // The episode the viewer moved to on this page; later plan refreshes must not undo it.
  const userSelectionRef = useRef<{ workId: string; episodeId: string } | null>(null);
  const initialFocusDoneRef = useRef<string | null>(null);
  const resumeButtonRef = useRef<HTMLButtonElement>(null);
  const seriesBrowserRef = useRef<HTMLDivElement>(null);
  const moviePlaybackSettingsButtonRef = useRef<HTMLButtonElement>(null);
  const movieDownloadButtonRef = useRef<HTMLButtonElement>(null);
  const runtimeRequestsRef = useRef<Set<string>>(new Set());
  const handleProgressChanged = useCallback(
    (_workId: string, updated: WatchProgress[]) => {
      setProgressByMedia((current) => {
        const next = new Map(current);
        for (const progress of updated) {
          next.set(progress.media_file_id, progress);
        }
        return next;
      });
    },
    []
  );
  const detailMediaContext = useMediaContextMenu({
    onProgressChanged: handleProgressChanged,
  });
  const detailNavigationState = location.state as {
    backTo?: unknown;
    episodeId?: unknown;
    mediaFileId?: unknown;
    navigationOrigin?: unknown;
  } | null;
  const parentNavigationOrigin = navigationOriginFromState(detailNavigationState);
  const requestedEpisodeId =
    typeof detailNavigationState?.episodeId === "string"
      ? detailNavigationState.episodeId
      : null;
  const requestedMediaFileId =
    typeof detailNavigationState?.mediaFileId === "string"
      ? detailNavigationState.mediaFileId
      : null;
  useDocumentTitle(state.status === "ready" ? state.data.work.title : undefined);
  const chapterMediaFileId =
    state.status === "ready" && state.data.work.kind === "movie"
      ? state.data.media_file_id ?? undefined
      : undefined;
  const detailWork = state.status === "ready" ? state.data.work : null;
  const detailWorkId = detailWork?.id ?? null;
  const detailWorkGenres = detailWork?.genres.join("\u0000") ?? "";
  const resumeSeriesId = detailWork?.kind === "series" ? detailWork.id : null;
  // `progressByMedia` is every title's progress and gets a new identity on any progress event, so the
  // resume plan keys on this series' own episodes instead: it is only re-read when one of them moved.
  const seriesProgressKey = useMemo(() => {
    if (!resumeSeriesId || state.status !== "ready") return "";
    const children = state.data.children;
    if (typeof children !== "object" || children === null || !("Series" in children)) return "";
    const parts: string[] = [];
    for (const season of children.Series) {
      for (const episode of season.episodes) {
        const mediaFileId = episode.media_file_id;
        const progress = mediaFileId ? progressByMedia.get(mediaFileId) : undefined;
        if (mediaFileId && progress) parts.push(`${mediaFileId}:${progress.state}:${progress.position_ms}`);
      }
    }
    return parts.join("|");
  }, [resumeSeriesId, state, progressByMedia]);
  useEffect(() => {
    if (!resumeSeriesId) return;
    let cancelled = false;
    // The plan depends on watch history, so it is re-read when progress changes. A stored copy paints
    // first and is replaced in place.
    const stored = client.queries.peek<ResumePlan>(resumePlanKey(resumeSeriesId));
    if (stored) {
      setResumePlan(stored.data);
      setResumePlanSettledFor(resumeSeriesId);
    }
    client.queries
      .fetch(resumePlanKey(resumeSeriesId), () => client.getResumePlan(resumeSeriesId), { tags: RESUME_PLAN_TAGS })
      .then((plan) => {
        if (cancelled) return;
        setResumePlan(plan);
        setResumePlanSettledFor(resumeSeriesId);
      })
      .catch(() => {
        // An older server has no resume plan: the page simply has no Start/Resume button.
        if (cancelled) return;
        setResumePlan(null);
        setResumePlanSettledFor(resumeSeriesId);
      });
    return () => {
      cancelled = true;
    };
  }, [client, resumeSeriesId, seriesProgressKey]);
  const artworkWork =
    state.status === "ready"
      ? state.data.work
      : { id: workId ?? "", images: [] };
  const cachedBackdrop = useCachedArtwork(artworkWork, ["backdrop", "poster"], true, 1920).url;

  const seasons = useMemo(() => {
    if (state.status !== "ready") return [];
    return (seriesChildren(state.data.children) ?? []).filter(
      (season) => playableEpisodes(season).length > 0
    );
  }, [state]);
  const navigationLayer = useNavigationLayer(
    state.status === "ready"
      ? `${state.data.work.id}:${seasons
          .flatMap((season) => playableEpisodes(season))
          .map((episode) => episode.episode.id)
          .join(",")}`
      : `${workId ?? "detail"}:${state.status}`,
    state.status === "ready",
    state.status === "ready"
  );
  const workSources = detailWork ? getJoinedWorkSources(detailWork.id) : [];
  const [pendingServerPlayback, setPendingServerPlayback] =
    useState<PlayerLocationState | null>(null);
  const choosePlaybackServer = useCallback(
    async (source: JoinedWorkSource) => {
      if (!pendingServerPlayback) return;
      const sourceDetail = await source.client.getWork(source.work.id);
      const sourcePlaylist = playlistFromWorkDetail(sourceDetail, t);
      const requested = pendingServerPlayback.playlistItems?.find(
        (item) => item.mediaFileId === pendingServerPlayback.mediaFileId
      );
      const selected =
        sourceDetail.work.kind === "movie"
          ? sourcePlaylist[0]
          : sourcePlaylist.find(
              (item) =>
                item.seasonNumber === requested?.seasonNumber &&
                item.episodeNumber === requested?.episodeNumber
            );
      if (!selected) {
        throw new Error(t("pages.workDetail.serverMissingItem"));
      }
      setPendingServerPlayback(null);
      navigate(`/player/${selected.mediaFileId}`, {
        state: {
          ...pendingServerPlayback,
          serverUrl: source.url,
          title: selected.subtitle
            ? t("pages.workDetail.seriesTitleSeparator", {
                series: selected.subtitle,
                title: selected.title,
              })
            : selected.title,
          episodeId: selected.episodeId,
          mediaFileId: selected.mediaFileId,
          playlistItems: sourcePlaylist,
          playbackSettings:
            source.url === workSources[0]?.url
              ? pendingServerPlayback.playbackSettings
              : null,
        } satisfies PlayerLocationState,
      });
    },
    [navigate, pendingServerPlayback, t, workSources]
  );

  const runtimeTarget = useMemo(() => {
    if (state.status !== "ready") return null;
    if (state.data.work.kind === "movie") {
      const mediaFileId = state.data.media_file_id;
      return mediaFileId
        ? { mediaFileId, persistedRuntimeMs: state.data.runtime_ms ?? null }
        : null;
    }
    const selectedSeason =
      seasons.find((season) => season.season.season_number === selectedSeasonNumber) ?? seasons[0];
    const episodes = selectedSeason ? playableEpisodes(selectedSeason) : [];
    const selectedEpisode =
      episodes.find((episode) => episode.episode.id === selectedEpisodeId) ?? episodes[0];
    return selectedEpisode?.media_file_id
      ? {
          mediaFileId: selectedEpisode.media_file_id,
          persistedRuntimeMs: selectedEpisode.runtime_ms ?? null,
        }
      : null;
  }, [seasons, selectedEpisodeId, selectedSeasonNumber, state]);

  const nextUpReady = detailWorkId !== null && resumePlanSettledFor === detailWorkId;
  const nextUp = useMemo(
    () => (nextUpReady && detailWorkId ? nextUpSelection(seasons, resumePlan, detailWorkId) : null),
    [detailWorkId, nextUpReady, resumePlan, seasons]
  );
  const nextUpEpisodeId = nextUp?.episodeId ?? null;
  // Default focus (TV autofocus) may only mark the selected tile once the selection has caught up
  // with the next-up episode; otherwise it could land on the placeholder first tile for a frame.
  const defaultFocusReady =
    nextUpReady &&
    (requestedEpisodeId !== null ||
      requestedMediaFileId !== null ||
      selectedEpisodeId === nextUpEpisodeId);

  useEffect(() => {
    const requestedEpisode = seasons
      .flatMap((season) =>
        playableEpisodes(season).map((episode) => ({ season, episode }))
      )
      .find(
        ({ episode }) =>
          episode.episode.id === requestedEpisodeId ||
          episode.media_file_id === requestedMediaFileId
      );
    if (requestedEpisode) {
      setSelectedSeasonNumber(requestedEpisode.season.season.season_number);
      setSelectedEpisodeId(requestedEpisode.episode.episode.id);
      return;
    }

    const userSelection = userSelectionRef.current;
    if (userSelection && userSelection.workId === detailWorkId) {
      const kept = seasons
        .flatMap((season) => playableEpisodes(season).map((episode) => ({ season, episode })))
        .find(({ episode }) => episode.episode.id === userSelection.episodeId);
      if (kept) {
        setSelectedSeasonNumber(kept.season.season.season_number);
        setSelectedEpisodeId(kept.episode.episode.id);
        return;
      }
    }

    // No explicit request: open on the next item to play (the episode the Play button
    // resumes), which is the first playable episode when nothing was watched yet.
    const firstSeason = seasons[0];
    setSelectedSeasonNumber(nextUp?.seasonNumber ?? firstSeason?.season.season_number ?? null);
    setSelectedEpisodeId(
      nextUp?.episodeId ??
        (firstSeason ? playableEpisodes(firstSeason)[0]?.episode.id ?? null : null)
    );
  }, [
    requestedEpisodeId,
    requestedMediaFileId,
    seasons,
    nextUp,
    detailWorkId,
  ]);

  useEffect(() => {
    if (navigationLayer.hasSnapshot) return;
    if (seasons.length === 0) return;
    const workKey = detailWorkId;
    const frame = window.requestAnimationFrame(() => {
      const requestedCard =
        (requestedMediaFileId
          ? seriesBrowserRef.current?.querySelector<HTMLElement>(
              `[data-media-file-id="${CSS.escape(requestedMediaFileId)}"]`
            )
          : null) ??
        (requestedEpisodeId
          ? seriesBrowserRef.current?.querySelector<HTMLElement>(
              `[data-episode-id="${CSS.escape(requestedEpisodeId)}"]`
            )
          : null);
      const nextUpCard =
        !requestedCard && nextUpEpisodeId && initialFocusDoneRef.current !== workKey
          ? seriesBrowserRef.current?.querySelector<HTMLElement>(
              `[data-episode-id="${CSS.escape(nextUpEpisodeId)}"]`
            )
          : null;
      const initialCard = requestedCard ?? nextUpCard ?? null;
      const requestedTrack = initialCard?.closest<HTMLElement>(".tv-media-track");
      const targetTrack =
        requestedTrack ??
        seriesBrowserRef.current?.querySelector<HTMLElement>(".tv-media-track");
      if (nextUpCard) {
        // Do not steal focus the viewer already moved elsewhere on the page.
        const active = document.activeElement;
        const free =
          active === document.body ||
          active === null ||
          active === nextUpCard ||
          (active instanceof HTMLElement && active.closest(".app-nav") !== null);
        if (!free) return;
      }
      if (targetTrack) centreTrackInStack(targetTrack, { animate: false });
      const rail = initialCard?.closest<HTMLElement>(".tv-episode-rail");
      if (initialCard && rail) {
        setScrollInstant(rail, {
          left:
            initialCard.offsetLeft +
            initialCard.offsetWidth / 2 -
            rail.clientWidth / 2,
        });
        initialCard.focus({ preventScroll: true });
        // Stacked (phone) layouts scroll the page, not the track surface: bring the tile into view.
        const cardRect = initialCard.getBoundingClientRect();
        if (cardRect.top < 0 || cardRect.bottom > window.innerHeight) {
          smoothScrollIntoView(initialCard, { block: "center", instant: true });
        }
        if (nextUpCard) initialFocusDoneRef.current = workKey;
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    requestedMediaFileId,
    requestedEpisodeId,
    nextUpEpisodeId,
    seasons.length,
    navigationLayer.hasSnapshot,
    detailWorkId,
  ]);

  useEffect(() => {
    let cancelled = false;
    client
      .listWatchProgress()
      .then((rows) => {
        if (!cancelled) {
          setProgressByMedia(new Map(rows.map((progress) => [progress.media_file_id, progress])));
        }
      })
      .catch(() => {
        if (!cancelled && liveProgressRevision === 0) setProgressByMedia(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [client, liveProgressRevision]);

  useEffect(() => {
    if (!runtimeTarget) return;
    const { mediaFileId, persistedRuntimeMs } = runtimeTarget;
    if (persistedRuntimeMs && persistedRuntimeMs > 0) {
      setRuntimeByMedia((current) => {
        if (current.get(mediaFileId) === persistedRuntimeMs) return current;
        const next = new Map(current);
        next.set(mediaFileId, persistedRuntimeMs);
        return next;
      });
      return;
    }
    if (runtimeByMedia.has(mediaFileId) || runtimeRequestsRef.current.has(mediaFileId)) return;
    runtimeRequestsRef.current.add(mediaFileId);

    // Not cancelled by the effect lifecycle: this effect re-runs whenever `runtimeByMedia` changes, and
    // the request guard above would then skip the re-run, dropping a result that is still wanted. The
    // result is keyed by media file id, so storing it late is always correct.
    client
      .getMediaMetadata(mediaFileId)
      .then((metadata) => {
        runtimeRequestsRef.current.delete(mediaFileId);
        if (metadata.duration_ms <= 0) return;
        setRuntimeByMedia((current) => {
          const next = new Map(current);
          next.set(mediaFileId, metadata.duration_ms);
          return next;
        });
      })
      .catch(() => {
        runtimeRequestsRef.current.delete(mediaFileId);
        // A genuinely unreadable/missing source stays unavailable; opening
        // another episode retries only that file, never the whole library.
      });
  }, [client, runtimeByMedia, runtimeTarget]);

  useEffect(() => {
    if (!chapterMediaFileId) {
      setMovieChapters([]);
      return;
    }
    let cancelled = false;
    client
      .getMediaChapters(chapterMediaFileId)
      .then((chapters) => {
        if (!cancelled) setMovieChapters(chapters);
      })
      .catch(() => {
        if (!cancelled) setMovieChapters([]);
      });
    return () => {
      cancelled = true;
    };
  }, [chapterMediaFileId, client]);

  const loadMoviePlaybackOptions = useCallback(
    (mediaFileId: string, isCancelled: () => boolean = () => false) => {
      setMoviePlaybackOptions({ status: "loading" });
      void client
        .getMediaPlaybackOptions(mediaFileId)
        .then((options) => {
          if (isCancelled()) return;
          setMoviePlaybackOptions({ status: "ready", options });
          setMoviePlaybackDraft(playbackDraft(options.preferences));
        })
        .catch((error: unknown) => {
          if (!isCancelled()) {
            setMoviePlaybackOptions({
              status: "error",
              message: describeApiError(error),
            });
          }
        });
    },
    [client]
  );

  useEffect(() => {
    setMoviePlaybackSettingsOpen(false);
    setMoviePlaybackSettingsSaving(false);
    if (!chapterMediaFileId) {
      setMoviePlaybackOptions({ status: "idle" });
      return;
    }
    let cancelled = false;
    loadMoviePlaybackOptions(chapterMediaFileId, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [chapterMediaFileId, loadMoviePlaybackOptions]);

  const closeMoviePlaybackSettings = useCallback(() => {
    setMoviePlaybackSettingsOpen(false);
    window.requestAnimationFrame(() =>
      moviePlaybackSettingsButtonRef.current?.focus({ preventScroll: true })
    );
  }, []);

  const saveMoviePlaybackSettings = useCallback(() => {
    if (
      !chapterMediaFileId ||
      moviePlaybackOptions.status !== "ready" ||
      moviePlaybackSettingsSaving
    ) {
      return;
    }

    setMoviePlaybackSettingsSaving(true);
    void client
      .updateMediaPlaybackOptions(chapterMediaFileId, moviePlaybackDraft)
      .then((options) => {
        setMoviePlaybackOptions({ status: "ready", options });
        setMoviePlaybackDraft(playbackDraft(options.preferences));
        closeMoviePlaybackSettings();
        showToast(t("pages.workDetail.playbackSettingsSaved"));
      })
      .catch((error: unknown) => {
        setMoviePlaybackOptions({
          status: "error",
          message: describeApiError(error),
        });
      })
      .finally(() => {
        setMoviePlaybackSettingsSaving(false);
      });
  }, [
    chapterMediaFileId,
    client,
    closeMoviePlaybackSettings,
    moviePlaybackDraft,
    moviePlaybackOptions,
    moviePlaybackSettingsSaving,
    showToast,
    t,
  ]);

  useEffect(() => {
    if (!detailWorkId) {
      setWorkCredits(null);
      return;
    }

    let cancelled = false;
    setWorkCredits(null);
    client
      .getWorkCredits(detailWorkId)
      .then((credits) => {
        if (!cancelled) setWorkCredits(credits);
      })
      .catch(() => {
        if (!cancelled) setWorkCredits(null);
      });
    return () => {
      cancelled = true;
    };
  }, [client, detailWorkId]);

  useEffect(() => {
    if (!detailWorkId || !detailWork) {
      setSimilarWorks([]);
      return;
    }

    let cancelled = false;
    setSimilarWorks([]);

    const loadGenreFallback = async (): Promise<Work[]> => {
      const genres = detailWork.genres.slice(0, 3);
      const pages = await Promise.all(
        genres.length > 0
          ? genres.map((genre) =>
              client.browseCatalog({
                genre,
                available_only: true,
                limit: 100,
              })
            )
          : [
              client.browseCatalog({
                kind: detailWork.kind,
                available_only: true,
                sort: "date_added",
                order: "desc",
                limit: 100,
              }),
            ]
      );
      const candidates = new Map<string, Work>();
      for (const page of pages) {
        for (const candidate of page.items) {
          if (
            candidate.id !== detailWork.id &&
            (candidate.kind === "movie" || isEpisodicKind(candidate.kind))
          ) {
            candidates.set(candidate.id, candidate);
          }
        }
      }

      return [...candidates.values()]
        .sort(
          (left, right) =>
            relatedWorkScore(detailWork, right) -
              relatedWorkScore(detailWork, left) ||
            left.sort_title.localeCompare(right.sort_title)
        )
        .slice(0, 20);
    };

    void (async () => {
      let works: Work[] = [];
      try {
        works = await client.getSimilarWorks(detailWorkId);
      } catch {
        // A catalogue without cached embeddings returns 404. Genre-based
        // ranking below still provides a useful, playable track.
      }

      let visibleWorks = works.filter(
        (similarWork) =>
          similarWork.id !== detailWork.id &&
          (similarWork.kind === "movie" || isEpisodicKind(similarWork.kind))
      );
      if (visibleWorks.length === 0) {
        try {
          visibleWorks = await loadGenreFallback();
        } catch {
          visibleWorks = [];
        }
      }

      if (!cancelled) setSimilarWorks(visibleWorks);
    })();

    return () => {
      cancelled = true;
    };
  }, [client, detailWork, detailWorkGenres, detailWorkId]);

  if (state.status !== "ready") {
    // The header and Back stay up while the title loads, fails or is unavailable.
    const pendingBase = location.pathname.startsWith("/series")
      ? "/series"
      : location.pathname.startsWith("/sites")
        ? "/sites"
        : "/movies";
    const pendingBack = resolveDetailBack({
      routeBase: pendingBase,
      requestedBackTo: detailNavigationState?.backTo,
      pathname: location.pathname,
      search: location.search,
      t,
    });
    const preview = knownWork(workId);
    const pendingSection = location.pathname.startsWith("/search/")
      ? t("shell.nav.search")
      : location.pathname.startsWith("/playlists/")
        ? t("shell.nav.playlists")
        : pendingBase === "/series"
          ? t("shell.nav.series")
          : pendingBase === "/sites"
            ? t("shell.nav.sites")
            : t("shell.nav.movies");
    return (
      <PageLayout
        pageId="work-detail"
        className="tv-detail"
        ariaLabel={t("pages.workDetail.loadingTitleDetailsAriaLabel")}
        backdrop={
          preview
            ? {
                artKey: preview.id,
                art: <CachedArtworkImage work={preview} kinds={["backdrop", "poster"]} alt="" fallback={<span>{preview.title}</span>} />,
              }
            : undefined
        }
        header={{
          variant: "detail",
          title: pendingSection,
          detail: preview?.title,
          back: {
            label: t("pages.workDetail.backTo", { destination: pendingBack.backLabel }),
            onBack: () => {
              if (parentNavigationOrigin) navigate(-1);
              else navigate(pendingBack.backTo);
            },
          },
        }}
        state={
          state.status === "error"
            ? { kind: "error", props: { graphic: "details", title: t("pages.workDetail.titleLoadError"), description: state.message, onRetry: () => setDetailAttempt((value) => value + 1), retryLabel: t("components.states.retry") } }
            : state.status === "empty"
              ? {
                  kind: "empty",
                  props: {
                    graphic: "details",
                    title: t("pages.workDetail.titleDetailsUnavailable"),
                    description: t("pages.workDetail.titleDetailsUnavailableDescription"),
                  },
                }
              : undefined
        }
      >
        {state.status === "error" || state.status === "empty" ? null : (
          <DetailPending
            work={preview}
            fallbackKind={pendingBase === "/series" ? "series" : "movie"}
            label={t("pages.workDetail.loadingDetails")}
          />
        )}
      </PageLayout>
    );
  }

  const { work, media_file_id: movieMediaFileId } = state.data;
  const backdrop = cachedBackdrop;
  const routeBase = detailRouteBase(work);
  const episodic = isEpisodicKind(work.kind);
  const { backTo, backLabel } = resolveDetailBack({
    routeBase,
    requestedBackTo: detailNavigationState?.backTo,
    pathname: location.pathname,
    search: location.search,
    t,
  });
  const detailRoute =
    location.pathname.startsWith("/search/") ||
    location.pathname.startsWith("/playlists/")
    ? `${location.pathname}${location.search}`
    : `${routeBase}/${work.id}`;
  const playlistItems: PlayerPlaylistItem[] =
    work.kind === "movie"
      ? movieMediaFileId
        ? [{ mediaFileId: movieMediaFileId, title: work.title }]
        : []
      : [...seasons]
          .sort((left, right) => left.season.season_number - right.season.season_number)
          .flatMap((season) =>
            [...playableEpisodes(season)]
              .sort(
                (left, right) =>
                  left.episode.episode_number - right.episode.episode_number
              )
              .flatMap((episode) => {
                const mediaFileId = episode.media_file_id;
                if (!mediaFileId) return [];
                const seasonNumber = season.season.season_number;
                const episodeNumber = episode.episode.episode_number;
                const episodeTitle =
                  episode.episode.title ??
                  t("pages.workDetail.episodeNumber", { number: episodeNumber });
                return [
                  {
                    mediaFileId,
                    title: episodeTitle,
                    subtitle: work.title,
                    synopsis: episode.episode.overview ?? work.overview ?? undefined,
                    episodeId: episode.episode.id,
                    seasonNumber,
                    episodeNumber,
                  },
                ];
              })
          );
  const selectedSeason =
    seasons.find((season) => season.season.season_number === selectedSeasonNumber) ?? seasons[0];
  const episodes = selectedSeason ? playableEpisodes(selectedSeason) : [];
  const selectedEpisode =
    episodes.find((episode) => episode.episode.id === selectedEpisodeId) ?? episodes[0];
  const playMediaFileId =
    work.kind === "movie" ? movieMediaFileId : selectedEpisode?.media_file_id ?? null;
  const activeProgress = playMediaFileId ? progressByMedia.get(playMediaFileId) : undefined;
  const activeOverview =
    episodic
      ? selectedEpisode?.episode.overview ?? selectedSeason?.season.overview ?? work.overview
      : work.overview;
  const selectedSeasonLabel = selectedSeason
    ? selectedSeason.season.title ??
      t("pages.workDetail.seasonNumber", { number: selectedSeason.season.season_number })
    : workKindLabel(work, t);
  const selectedEpisodeLabel = selectedEpisode
    ? selectedEpisode.episode.title ??
      t("pages.workDetail.episodeNumber", { number: selectedEpisode.episode.episode_number })
    : null;
  const detailDateValue =
    episodic
      ? selectedEpisode?.episode.air_date ?? work.release_date
      : work.release_date ?? work.added_at;
  const detailDate = detailDateValue ? formatDetailDate(detailDateValue) : null;
  const detailYear = yearRangeLabel(work);
  const detailDateLabel =
    episodic && selectedEpisode?.episode.air_date
      ? t("pages.workDetail.dateAired")
      : work.release_date
        ? episodic
          ? t("pages.workDetail.datePremiered")
          : t("pages.workDetail.dateReleased")
        : t("pages.workDetail.dateAdded");
  const runtimeMs =
    (playMediaFileId ? runtimeByMedia.get(playMediaFileId) : undefined) ??
    (episodic
      ? selectedEpisode?.runtime_ms
        ? selectedEpisode.runtime_ms
        : selectedEpisode?.episode.runtime_minutes
        ? selectedEpisode.episode.runtime_minutes * 60_000
        : activeProgress?.duration_ms
      : state.data.runtime_ms ?? activeProgress?.duration_ms);
  const runtimeLabel =
    runtimeMs && runtimeMs > 0
      ? formatRuntime(runtimeMs, t)
      : playMediaFileId
        ? t("pages.workDetail.loadingRuntime")
        : t("pages.workDetail.runtimeUnavailable");
  const movieActionLabel =
    activeProgress?.state === "part_watched"
      ? t("pages.workDetail.resumeFrom", { position: formatClock(activeProgress.position_ms) })
      : t("pages.workDetail.play");
  const resumePlanPending = work.kind === "series" && resumePlanSettledFor !== work.id;
  const activeResumePlan =
    work.kind === "series" && resumePlan?.series_work_id === work.id && resumePlan.target
      ? resumePlan
      : null;
  const playResumeOption = (option: ResumeOption) => {
    const playerState = resumePlayerState(
      option,
      work.title,
      playlistItems,
      {
        serverUrl: workSources[0]?.url,
        backTo: detailRoute,
        detailParentBackTo: backTo,
        navigationOrigin: navigationLayer.origin,
        detailNavigationOrigin: parentNavigationOrigin,
      },
      t
    );
    if (workSources.length > 1) {
      setPendingServerPlayback(playerState);
    } else {
      navigate(`/player/${option.media_file_id}`, { state: playerState });
    }
  };
  const displayedMovieChapters =
    movieChapters.length > 0 ? movieChapters : generatedMovieChapters(runtimeMs ?? 0, t);
  const savedMoviePlaybackOptions =
    moviePlaybackOptions.status === "ready" ? moviePlaybackOptions.options : null;
  const moviePlaybackSettings = resolvePlaybackLaunchSettings(
    savedMoviePlaybackOptions
  );
  const movieCrewGroups = groupCrewCredits(workCredits?.crew ?? [], t);
  const hasMovieTracks =
    displayedMovieChapters.length > 0 ||
    (workCredits?.cast.length ?? 0) > 0 ||
    movieCrewGroups.length > 0 ||
    similarWorks.length > 0;
  const hasSeriesTracks =
    seasons.length > 0 ||
    (workCredits?.cast.length ?? 0) > 0 ||
    similarWorks.length > 0;
  const detailCollectionLabel =
    work.kind === "series"
      ? t("shell.nav.series")
      : work.kind === "movie"
        ? t("shell.nav.movies")
        : workKindLabel(work, t);

  return (
    <PageLayout
      pageId="work-detail"
      className="tv-detail"
      ariaLabel={work.title}
      backdrop={{
        artKey: work.id,
        art: (
          <CachedArtworkImage
            work={work}
            kinds={["backdrop", "poster"]}
            alt=""
            fallback={<span>{work.title}</span>}
          />
        ),
      }}
      header={{
        variant: "detail",
        title: detailCollectionLabel,
        detail: work.title,
        back: {
          label: t("pages.workDetail.backTo", { destination: backLabel }),
          onBack: () => {
            if (parentNavigationOrigin) {
              navigate(-1);
            } else {
              navigate(backTo);
            }
          },
        },
      }}
    >
      <aside className="tv-detail-copy" key={`copy-${work.id}`}>
        <p className="tv-detail-kicker">
          {episodic && selectedEpisode ? (
            <>
              S{String(selectedSeason?.season.season_number ?? 0).padStart(2, "0")}
              {" · "}
              E{String(selectedEpisode.episode.episode_number).padStart(2, "0")}
            </>
          ) : (
            work.genres[0] ?? workKindLabel(work, t)
          )}
        </p>
        <h2 className="tv-detail-title">{work.title}</h2>
        {episodic && selectedEpisode && selectedEpisodeLabel ? (
          <h2>{selectedEpisodeLabel}</h2>
        ) : null}
        <div className="tv-detail-meta">
          <span>{episodic ? selectedSeasonLabel : t("pages.workDetail.kindMovie")}</span>
          {episodic && selectedEpisode ? (
            <span>
              S{String(selectedSeason?.season.season_number ?? 0).padStart(2, "0")}
              {" · "}
              E{String(selectedEpisode.episode.episode_number).padStart(2, "0")}
            </span>
          ) : null}
          <span>{runtimeLabel}</span>
          {detailYear ? <span>{detailYear}</span> : null}
          {detailDate && detailDateValue ? (
            <time dateTime={detailDateValue}>
              {detailDateLabel} {detailDate}
            </time>
          ) : null}
          {work.genres.slice(0, 3).map((genre, index) => (
            <span key={`${genre}-${index}`}>{genre}</span>
          ))}
        </div>
        {work.kind === "series" ? <AvailabilityLagNote workId={work.id} /> : null}
        <p className="tv-detail-synopsis">
          {activeOverview ??
            (episodic
              ? t("pages.workDetail.noEpisodeSynopsis")
              : t("pages.workDetail.noSynopsis"))}
        </p>
        {work.kind === "movie" && playMediaFileId ? (
          <div className="tv-detail-actions">
            {downloads.canDownload === true ? (
              <button
                ref={movieDownloadButtonRef}
                type="button"
                className="tv-detail-download"
                aria-label={t("pages.workDetail.downloadTitle", { title: work.title })}
                aria-haspopup="dialog"
                aria-expanded={movieDownloadOpen}
                data-navigation-focus-key={`detail:${work.id}:download`}
                onClick={() => setMovieDownloadOpen(true)}
              >
                <span aria-hidden="true">⇩</span>
                <strong>{t("pages.workDetail.downloadButtonLabel")}</strong>
              </button>
            ) : null}
            <button
              ref={moviePlaybackSettingsButtonRef}
              type="button"
              className="tv-detail-playback-settings"
              aria-label={t("pages.workDetail.playbackSettingsFor", { title: work.title })}
              aria-haspopup="dialog"
              aria-expanded={moviePlaybackSettingsOpen}
              aria-controls="movie-playback-settings"
              data-navigation-focus-key={`detail:${work.id}:playback-settings`}
              onClick={() => {
                if (savedMoviePlaybackOptions) {
                  setMoviePlaybackDraft(
                    playbackDraft(savedMoviePlaybackOptions.preferences)
                  );
                } else if (chapterMediaFileId) {
                  loadMoviePlaybackOptions(chapterMediaFileId);
                }
                setMoviePlaybackSettingsOpen(true);
              }}
            >
              <span aria-hidden="true">☷</span>
              <strong>{t("pages.workDetail.playbackButtonLabel")}</strong>
            </button>
            <Link
              to={`/player/${playMediaFileId}`}
              state={{
                serverUrl: workSources[0]?.url,
                title: work.title,
                backTo: detailRoute,
                detailParentBackTo: backTo,
                mediaFileId: playMediaFileId,
                playlistItems,
                navigationOrigin: navigationLayer.origin,
                detailNavigationOrigin: parentNavigationOrigin,
                playbackSettings: moviePlaybackSettings,
              }}
              className="tv-detail-play"
              data-tv-focus-default
              data-navigation-focus-key={`detail:${work.id}:play`}
              onClick={(event) => {
                navigationLayer.captureLink(event);
                if (workSources.length > 1) {
                  event.preventDefault();
                  setPendingServerPlayback({
                    title: work.title,
                    backTo: detailRoute,
                    detailParentBackTo: backTo,
                    mediaFileId: playMediaFileId,
                    playlistItems,
                    navigationOrigin: navigationLayer.origin,
                    detailNavigationOrigin: parentNavigationOrigin,
                    playbackSettings: moviePlaybackSettings,
                  });
                }
              }}
              data-watch-state={activeProgress?.state}
              aria-label={
                activeProgress?.state === "part_watched"
                  ? t("pages.workDetail.resumeTitleFrom", {
                      title: work.title,
                      position: formatClock(activeProgress.position_ms),
                    })
                  : t("pages.workDetail.playTitle", { title: work.title })
              }
              {...detailMediaContext.itemProps({
                work,
                detailRoute,
                parentRoute: backTo,
                progress: activeProgress,
                preferredMediaFileId: playMediaFileId,
                leaves: [
                  {
                    mediaFileId: playMediaFileId,
                    runtimeMs: runtimeMs ?? 0,
                    title: work.title,
                    workKind: work.kind,
                  },
                ],
                activateOrigin: true,
              })}
            >
              <span aria-hidden="true">▶</span>
              <strong>{movieActionLabel}</strong>
            </Link>
          </div>
        ) : work.kind === "movie" ? (
          <span
            className="tv-detail-play is-disabled"
            aria-label={t("pages.workDetail.noPlayableMedia")}
          >
            {t("pages.workDetail.unavailable")}
          </span>
        ) : null}
        <div className="tv-detail-actions tv-detail-watchlist">
          {resumePlanPending ? (
            // The Resume button (and "ask again") arrive with the resume plan: its space is held and the other buttons
            // wait for it, so nothing visible shifts when it lands.
            <SkeletonBlock
              className="tv-detail-play-pending"
              // The Resume button's own minimum width and height (.tv-detail-play).
              style={{ display: "inline-block", flex: "none", width: "clamp(112px, calc(8.5 * var(--vw)), 156px)", height: "clamp(44px, calc(4.2 * var(--vw)), 64px)", borderRadius: 999 }}
            />
          ) : null}
          {activeResumePlan?.target ? (
            <button
              ref={resumeButtonRef}
              type="button"
              className="tv-detail-play"
              data-resume-action={activeResumePlan.action}
              data-navigation-focus-key={`detail:${work.id}:resume`}
              aria-haspopup={activeResumePlan.needs_choice ? "dialog" : undefined}
              aria-label={t(resumeButtonTitleKey(activeResumePlan), { title: work.title })}
              onClick={(event) => {
                navigationLayer.captureLink(event);
                if (activeResumePlan.needs_choice) {
                  setResumeChooserOpen(true);
                } else if (activeResumePlan.target) {
                  playResumeOption(activeResumePlan.target);
                }
              }}
            >
              <span aria-hidden="true">▶</span>
              <strong>{t(resumeButtonLabelKey(activeResumePlan))}</strong>
            </button>
          ) : null}
          {activeResumePlan && activeResumePlan.action !== "start" ? (
            <button
              type="button"
              className="tv-detail-download"
              data-navigation-focus-key={`detail:${work.id}:resume-ask-again`}
              aria-label={t("pages.workDetail.resumeAskAgainTitle", { title: work.title })}
              onClick={() => {
                client
                  .clearResumeChoices(work.id)
                  .then(() => client.getResumePlan(work.id))
                  .then((plan) => {
                    setResumePlan(plan);
                    showToast(t("pages.workDetail.resumeAskAgainDone"));
                  })
                  .catch((caught) => showToast(describeApiError(caught)));
              }}
            >
              <span aria-hidden="true">↺</span>
              <strong>{t("pages.workDetail.resumeAskAgain")}</strong>
            </button>
          ) : null}
          {resumePlanPending ? null : (
            <>
              <WatchlistToggle
                snapshot={snapshotFromWork(work)}
                className="tv-detail-download"
                focusKey={`detail:${work.id}:watchlist`}
              />
              <button
                type="button"
                className="tv-detail-download"
                aria-haspopup="dialog"
                data-navigation-focus-key={`detail:${work.id}:add-to-playlist`}
                onClick={(event) =>
                  detailMediaContext.openAction(
                    "playlists",
                    {
                      work,
                      detailRoute,
                      parentRoute: backTo,
                      progress: activeProgress,
                      preferredMediaFileId: playMediaFileId,
                      preferredEpisodeId: selectedEpisode?.episode.id,
                    },
                    event.currentTarget
                  )
                }
              >
                <span aria-hidden="true">+</span>
                <strong>{t("components.mediaContextMenu.addToPlaylist")}</strong>
              </button>
            </>
          )}
        </div>
      </aside>

      {episodic && hasSeriesTracks ? (
        <RailStack
          className="tv-series-browser"
          ref={seriesBrowserRef}
          spacing="related"
          scrollKey={`detail:${work.id}:seasons`}
          ariaLabel={t("pages.workDetail.titleSeasonsAndEpisodes", { title: work.title })}
        >
          {seasons.map((season) => (
            <SeasonEpisodeTrack
              key={season.season.id}
              season={season}
              seriesTitle={work.title}
              workId={work.id}
              detailRoute={detailRoute}
              detailParentBackTo={backTo}
              backdrop={backdrop ?? null}
              playlistItems={playlistItems}
              selectedEpisodeId={selectedEpisode?.episode.id ?? null}
              progressByMedia={progressByMedia}
              onProgressChanged={handleProgressChanged}
              navigationOrigin={navigationLayer.origin}
              detailNavigationOrigin={parentNavigationOrigin}
              onNavigate={navigationLayer.captureLink}
              workSources={workSources}
              onChooseServer={setPendingServerPlayback}
              defaultFocusReady={defaultFocusReady}
              onSelect={(seasonNumber, episodeId) => {
                userSelectionRef.current = { workId: work.id, episodeId };
                setSelectedSeasonNumber(seasonNumber);
                setSelectedEpisodeId(episodeId);
              }}
            />
          ))}
          {workCredits?.cast.length ? (
            <MoviePeopleTrack
              title={t("pages.workDetail.cast")}
              credits={workCredits.cast}
              workId={work.id}
              groupKey="cast"
              spacing="section"
            />
          ) : null}
          {similarWorks.length > 0 ? (
            <SimilarTitlesTrack
              works={similarWorks}
              workId={work.id}
              detailRoute={detailRoute}
              navigationOrigin={navigationLayer.origin}
              onNavigate={navigationLayer.captureLink}
            />
          ) : null}
        </RailStack>
      ) : null}

      {work.kind === "movie" && hasMovieTracks ? (
        <RailStack
          className="tv-movie-browser"
          spacing="related"
          scrollKey={`detail:${work.id}:movie-tracks`}
          ariaLabel={t("pages.workDetail.titleChaptersAndPeople", { title: work.title })}
        >
          {movieMediaFileId && displayedMovieChapters.length > 0 ? (
            <MovieChapterTrack
              chapters={displayedMovieChapters}
              generated={movieChapters.length === 0}
              mediaFileId={movieMediaFileId}
              movieTitle={work.title}
              workId={work.id}
              detailRoute={detailRoute}
              detailParentBackTo={backTo}
              playlistItems={playlistItems}
              progress={activeProgress}
              runtimeMs={runtimeMs ?? 0}
              onProgressChanged={handleProgressChanged}
              navigationOrigin={navigationLayer.origin}
              detailNavigationOrigin={parentNavigationOrigin}
              playbackSettings={moviePlaybackSettings}
              onNavigate={navigationLayer.captureLink}
              workSources={workSources}
              onChooseServer={setPendingServerPlayback}
            />
          ) : null}
          {workCredits?.cast.length ? (
            <MoviePeopleTrack
              title={t("pages.workDetail.cast")}
              credits={workCredits.cast}
              workId={work.id}
              groupKey="cast"
              spacing="section"
            />
          ) : null}
          {movieCrewGroups.map((group) => (
            <MoviePeopleTrack
              key={group.key}
              title={group.title}
              credits={group.credits}
              workId={work.id}
              groupKey={group.key}
            />
          ))}
          {similarWorks.length > 0 ? (
            <SimilarTitlesTrack
              works={similarWorks}
              workId={work.id}
              detailRoute={detailRoute}
              navigationOrigin={navigationLayer.origin}
              onNavigate={navigationLayer.captureLink}
            />
          ) : null}
        </RailStack>
      ) : null}

      {detailMediaContext.contextMenu}

      {activeResumePlan && resumeChooserOpen ? (
        <ResumeChooserModal
          plan={activeResumePlan}
          seriesTitle={work.title}
          onCancel={() => {
            setResumeChooserOpen(false);
            resumeButtonRef.current?.focus({ preventScroll: true });
          }}
          onSelect={(option) => {
            setResumeChooserOpen(false);
            if (resumeButtonRef.current) navigationLayer.capture(resumeButtonRef.current);
            // Report the pick so declined gaps and rewatch answers are remembered.
            void client
              .recordResumeChoice(work.id, option)
              .then(setResumePlan)
              .catch(() => undefined);
            playResumeOption(option);
          }}
        />
      ) : null}

      {pendingServerPlayback && workSources.length > 1 ? (
        <ServerChoiceModal
          sources={workSources}
          title={work.title}
          onCancel={() => setPendingServerPlayback(null)}
          onSelect={choosePlaybackServer}
        />
      ) : null}

      {work.kind === "movie" && moviePlaybackSettingsOpen ? (
        <MoviePlaybackSettingsDrawer
          title={work.title}
          state={moviePlaybackOptions}
          draft={moviePlaybackDraft}
          saving={moviePlaybackSettingsSaving}
          onChange={setMoviePlaybackDraft}
          onSave={saveMoviePlaybackSettings}
          onClose={closeMoviePlaybackSettings}
        />
      ) : null}

      {work.kind === "movie" && movieDownloadOpen && playMediaFileId ? (
        <DownloadQualityDrawer
          title={work.title}
          leaves={[{ mediaFileId: playMediaFileId, runtimeMs: runtimeMs ?? 0, title: work.title }]}
          busy={movieDownloadBusy}
          onClose={() => setMovieDownloadOpen(false)}
          onConfirm={(selection: DownloadQualitySelection) => {
            setMovieDownloadBusy(true);
            void downloads
              .enqueue({
                workId: work.id,
                workKind: work.kind,
                mediaFileId: playMediaFileId,
                title: work.title,
                runtimeMs: runtimeMs ?? 0,
                qualityId: selection.qualityId,
                qualityLabel: selection.qualityLabel,
                keepUntil: selection.keepUntil,
              })
              .then(() => {
                setMovieDownloadBusy(false);
                setMovieDownloadOpen(false);
                showToast(t("pages.workDetail.downloadStarted", { title: work.title }));
              })
              .catch((caught: unknown) => {
                setMovieDownloadBusy(false);
                showToast(describeApiError(caught));
              });
          }}
        />
      ) : null}

      <div className="tv-stage-footer" aria-hidden="true">
        <span>{workKindLabel(work, t)}</span>
        <i />
        <span>{work.genres.slice(0, 2).join(" · ") || t("pages.workDetail.yourLibrary")}</span>
      </div>
    </PageLayout>
  );
}
