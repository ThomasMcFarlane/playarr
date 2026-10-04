import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link, useNavigate } from "react-router-dom";
import type {
  EpisodeDetail,
  ResumeOption,
  ResumePlan,
  WatchProgress,
  Work,
  WorkChildren,
} from "@playarr-tv/api-client";
import { useCatalogBrowse, useHomeRails } from "@playarr-tv/api-client/react";
import { useApiClient } from "../lib/ApiClientProvider";
import { useLanguage } from "../lib/i18n/LanguageProvider";
import {
  indexWatchProgressByWork,
  WatchStateOverlay,
} from "../components/WatchStateOverlay";
import { MediaThumbnailArtwork } from "../components/MediaThumbnailArtwork";
import { useMediaContextMenu } from "../components/MediaContextMenu";
import { CachedArtworkImage, useCachedArtwork } from "../lib/artwork";
import { smoothScrollTo } from "../lib/smoothScroll";
import {
  isNavigationLayerRestoring,
  useNavigationLayer,
} from "../lib/navigationLayer";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import { useHomeView, type HomeViewPreference } from "../lib/homeView";
import { useLiveRevision, useLiveSubscription } from "../lib/liveEvents";
import {
  TvMediaTrack,
  TvRailSurface,
  TvStageShell,
} from "../components/tv/TvStage";
import { TvEmptyState } from "../components/tv/TvEmptyState";
import { ResumeChooserModal } from "../components/ResumeChooserModal";
import {
  isStackedPlan,
  resumePlayerState,
  seriesPlaylist,
} from "../lib/resumePlan";

function detailRoute(work: Work): string {
  return work.kind === "site"
    ? `/sites/${work.id}`
    : work.kind === "series"
      ? `/series/${work.id}`
      : work.kind === "artist"
        ? `/music/${work.id}`
      : `/movies/${work.id}`;
}

function isEpisodic(work: Work): boolean {
  return work.kind === "series" || work.kind === "site";
}

function workKindLabel(work: Work, t: ReturnType<typeof useLanguage>["t"]): string {
  return work.kind === "site"
    ? t("pages.home.workKind.site")
    : work.kind === "series"
      ? t("pages.home.workKind.series")
      : work.kind === "artist"
        ? t("pages.home.workKind.artist")
      : t("pages.home.workKind.movie");
}

function mergeRecent(...groups: Work[][]): Work[] {
  return groups
    .flat()
    .sort((a, b) => new Date(b.added_at).getTime() - new Date(a.added_at).getTime());
}

/** `primary`, `sites-new` / `sites-more`, or a server rail's definition id. */
type HomeRailId = string;

interface HomeRailDefinition {
  id: HomeRailId;
  title: string;
  items: Work[];
}

interface OnDeckEntry {
  work: Work;
  /** Absent for a series that is on deck only because it needs a Resume choice. */
  progress: WatchProgress | null;
  episode: {
    detail: EpisodeDetail;
    seasonNumber: number;
  } | null;
}

const EMPTY_WORKS: Work[] = [];

/** Longest Home holds its first render for the On Deck detail calls. */
const ON_DECK_WAIT_MS = 2500;

function findOnDeckEpisode(
  children: WorkChildren,
  mediaFileId: string
): OnDeckEntry["episode"] {
  if (typeof children !== "object" || children === null || !("Series" in children)) {
    return null;
  }
  for (const season of children.Series) {
    const detail = season.episodes.find(
      (episode) => episode.media_file_id === mediaFileId
    );
    if (detail) {
      return {
        detail,
        seasonNumber: season.season.season_number,
      };
    }
  }
  return null;
}

function centreHomeRail(
  container: HTMLElement,
  section: HTMLElement,
  animate: boolean
): void {
  const target =
    section.offsetTop + section.offsetHeight / 2 - container.clientHeight / 2;
  const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
  const top = Math.max(0, Math.min(maxScrollTop, target));
  // Eased, interruptible, retargeting scroll (shared with remote navigation);
  // the focused rail glides to a stable vertical anchor at the viewport centre.
  if (animate) smoothScrollTo(container, { top });
  else container.scrollTop = top;
}

/** TV-first landing page: a mixed library spotlight plus on-deck and recent rails. */
export function HomePage() {
  const { t, language } = useLanguage();
  const { preference: homeView } = useHomeView();
  useDocumentTitle(t("pages.home.title"));
  const client = useApiClient();
  const liveCatalog = useLiveSubscription({ areas: ["catalog"] });
  const liveOnDeckRevision = useLiveRevision({ areas: ["progress", "catalog"] });
  const railsState = useHomeRails(client, { lang: language }, { subscribe: liveCatalog });
  const siteState = useCatalogBrowse(client, {
    kind: "site",
    available_only: true,
    sort: "recent",
    limit: 36,
  }, { subscribe: liveCatalog });
  const [activeRail, setActiveRail] = useState<HomeRailId>("primary");
  const [selectedByRail, setSelectedByRail] = useState<Record<HomeRailId, string | null>>({});
  const [onDeck, setOnDeck] = useState<OnDeckEntry[]>([]);
  const [onDeckSettled, setOnDeckSettled] = useState(false);
  const [resumeChooser, setResumeChooser] = useState<{ work: Work; plan: ResumePlan } | null>(
    null
  );
  const [stackedPlans, setStackedPlans] = useState<Map<string, ResumePlan>>(new Map());
  const navigate = useNavigate();
  const [watchProgress, setWatchProgress] = useState<WatchProgress[] | null>(null);
  const railsRef = useRef<HTMLDivElement>(null);
  const focusedRailRef = useRef<HomeRailId | null>(null);
  const homeSelectTimerRef = useRef(0);
  // Latest focus handler behind a stable identity so memoised rails never re-render for it.
  const focusFromRailRef = useRef<
    (rail: HomeRailId, id: string, section: HTMLElement) => void
  >(() => undefined);
  const stableFocusFromRail = useCallback(
    (rail: HomeRailId, id: string, section: HTMLElement) =>
      focusFromRailRef.current(rail, id, section),
    []
  );
  const pendingHomeSelectRef = useRef<{ rail: HomeRailId; id: string } | null>(
    null
  );
  const handleProgressChanged = useCallback(
    (workId: string, updated: WatchProgress[]) => {
      const updatedIds = new Set(updated.map((progress) => progress.media_file_id));
      setWatchProgress((current) => [
        ...(current ?? []).filter(
          (progress) => !updatedIds.has(progress.media_file_id)
        ),
        ...updated,
      ]);
      setOnDeck((current) => current.filter((entry) => entry.work.id !== workId));
    },
    []
  );

  useEffect(() => {
    let cancelled = false;
    // On Deck is resolved through one detail call per title. The rails must not
    // be swapped under the viewer once they are interactive (the primary rail's
    // cards would remount and take the focus ring with them), so Home waits for
    // On Deck, but never longer than ON_DECK_WAIT_MS; late results are dropped.
    // A live refresh (revision > 0) updates in place and has no such deadline.
    const giveUp =
      liveOnDeckRevision === 0
        ? window.setTimeout(() => {
            cancelled = true;
            setOnDeckSettled(true);
          }, ON_DECK_WAIT_MS)
        : undefined;

    // Series whose history is ambiguous are shown as a stacked card (ask on Home).
    const plansRequest: Promise<ResumePlan[]> = client.listResumePlans().catch(() => []);
    client
      .listWatchProgress()
      .then(async (progressRows) => {
        if (!cancelled) setWatchProgress(progressRows);
        const stackedPlans = (await plansRequest).filter(isStackedPlan);
        const plansByWork = new Map(stackedPlans.map((plan) => [plan.series_work_id, plan]));
        if (!cancelled) setStackedPlans(plansByWork);
        const resumableRows = [...progressRows]
          .filter((progress) => progress.state === "part_watched")
          .sort(
            (a, b) =>
              new Date(b.updated_at ?? 0).getTime() -
              new Date(a.updated_at ?? 0).getTime()
          );
        const seenWorkIds = new Set<string>();
        const resumable = resumableRows
          .filter((progress) => {
            if (seenWorkIds.has(progress.work_id)) return false;
            seenWorkIds.add(progress.work_id);
            return true;
          })
          .slice(0, 10);
        const resolvedRows = await Promise.all(
          resumable.map(async (progress) => {
            try {
              const detail = await client.getWork(progress.work_id);
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
          stackedPlans
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
        const resolved = [...resolvedRows, ...planOnly];
        if (!cancelled) {
          setOnDeck(
            resolved.filter(
              (entry): entry is OnDeckEntry => entry !== null
            )
          );
          setOnDeckSettled(true);
        }
      })
      .catch(() => {
        if (!cancelled && liveOnDeckRevision === 0) {
          setOnDeck([]);
          setWatchProgress(null);
          setOnDeckSettled(true);
        }
      });

    return () => {
      cancelled = true;
      if (giveUp !== undefined) window.clearTimeout(giveUp);
    };
  }, [client, liveOnDeckRevision]);

  const serverRails = useMemo(
    () => (railsState.status === "ready" ? railsState.data.rails : []),
    [railsState]
  );
  const siteItems = siteState.status === "ready" ? siteState.data.items : EMPTY_WORKS;
  const items = useMemo(
    () => mergeRecent(...serverRails.map((rail) => rail.items), siteItems),
    [serverRails, siteItems]
  );
  const onDeckItems = useMemo(() => onDeck.map((entry) => entry.work), [onDeck]);
  const onDeckByWork = useMemo(
    () => new Map(onDeck.map((entry) => [entry.work.id, entry])),
    [onDeck]
  );
  const rails = useMemo<HomeRailDefinition[]>(() => {
    const usedIds = new Set<string>();
    const takeUnused = (source: Work[], count: number) => {
      const selectedItems: Work[] = [];
      for (const work of source) {
        if (usedIds.has(work.id)) continue;
        usedIds.add(work.id);
        selectedItems.push(work);
        if (selectedItems.length >= count) break;
      }
      return selectedItems;
    };

    const primaryItems =
      onDeckItems.length > 0
        ? takeUnused(onDeckItems, 10)
        : takeUnused(items, 8);

    const definitions: HomeRailDefinition[] = [
      {
        id: "primary",
        title: onDeckItems.length > 0 ? t("pages.home.rail.onDeck") : t("pages.home.rail.startWatching"),
        items: primaryItems,
      },
      ...serverRails.map((rail) => ({
        id: rail.id,
        title: rail.title,
        items: rail.items,
      })),
      {
        id: "sites-new",
        title: t("pages.home.rail.newSites"),
        items: takeUnused(siteItems, 12),
      },
      {
        id: "sites-more",
        title: t("pages.home.rail.moreSites"),
        items: takeUnused(siteItems, 12),
      },
    ];
    return definitions.filter((rail) => rail.items.length > 0);
  }, [items, onDeckItems, serverRails, siteItems, t]);
  const progressByWork = useMemo(
    () => indexWatchProgressByWork(watchProgress ?? []),
    [watchProgress]
  );
  // An empty server response is still "settled": Home then shows what it has.
  const homeDataSettled =
    (railsState.status === "ready" ||
      railsState.status === "empty" ||
      railsState.status === "error") &&
    siteState.status !== "idle" &&
    siteState.status !== "loading";
  const railsKey = useMemo(() => rails.map((rail) => rail.id).join(":"), [rails]);
  const navigationLayer = useNavigationLayer(
    rails
      .map((rail) => `${rail.id}:${rail.items.map((item) => item.id).join(",")}`)
      .join("|"),
    onDeckSettled && homeDataSettled,
    onDeckSettled && homeDataSettled
  );

  useLayoutEffect(() => {
    if (navigationLayer.hasSnapshot) return;
    const container = railsRef.current;
    const firstSection = container?.querySelector<HTMLElement>(".tv-media-track");
    if (!container || !firstSection) return;
    centreHomeRail(container, firstSection, false);
    focusedRailRef.current =
      (firstSection.dataset.tvTrackId as HomeRailId | undefined) ?? null;
  }, [navigationLayer.hasSnapshot, railsKey]);

  const activeItems = rails.find((rail) => rail.id === activeRail)?.items ?? rails[0]?.items ?? [];
  const selected =
    activeItems.find((work) => work.id === selectedByRail[activeRail]) ??
    activeItems[0] ??
    rails[0]?.items[0];
  const selectedOnDeck =
    activeRail === "primary" && selected ? onDeckByWork.get(selected.id) : undefined;
  const isLoading =
    !onDeckSettled ||
    railsState.status === "idle" ||
    railsState.status === "loading" ||
    siteState.status === "idle" ||
    siteState.status === "loading";
  const error =
    railsState.status === "error" && siteItems.length === 0 ? railsState.message : null;

  if (isLoading) {
    return <HomeLoader />;
  }

  if (error) {
    return (
      <div className="page tv-state-page">
        <TvEmptyState
          graphic="home"
          tone="error"
          variant="page"
          title={t("pages.home.error.title")}
          description={error}
        />
      </div>
    );
  }

  if (!selected) {
    return (
      <div className="page tv-state-page">
        <TvEmptyState
          graphic="home"
          variant="page"
          title={t("pages.home.empty.title")}
          description={t("pages.home.empty.description")}
        />
      </div>
    );
  }

  const selectedEpisode = selectedOnDeck?.episode;
  const featureTitle =
    selectedEpisode?.detail.episode.title ??
    (selectedEpisode
      ? t("pages.home.episodeLabel", { number: selectedEpisode.detail.episode.episode_number })
      : selected.title);
  const featureOverview =
    selectedEpisode?.detail.episode.overview ??
    selected.overview ??
    t("pages.home.noSynopsis");

  function selectFromRail(rail: HomeRailId, id: string) {
    setActiveRail(rail);
    setSelectedByRail((current) =>
      current[rail] === id ? current : { ...current, [rail]: id }
    );
  }

  function focusFromRail(rail: HomeRailId, id: string, section: HTMLElement) {
    const enteredNewRail = focusedRailRef.current !== rail;
    focusedRailRef.current = rail;
    const remote = document.body.dataset.inputMode === "remote";
    // Debounce stage selection under remote holds so React does not re-render
    // the whole home stage on every key (dominant lag on limited TV CPUs).
    pendingHomeSelectRef.current = { rail, id };
    window.clearTimeout(homeSelectTimerRef.current);
    homeSelectTimerRef.current = window.setTimeout(() => {
      const pending = pendingHomeSelectRef.current;
      if (!pending) return;
      selectFromRail(pending.rail, pending.id);
    }, remote ? 280 : 0);
    if (!enteredNewRail || isNavigationLayerRestoring()) return;

    window.requestAnimationFrame(() => {
      const container = railsRef.current;
      if (container && section.isConnected) {
        centreHomeRail(container, section, true);
      }
    });
  }

  focusFromRailRef.current = focusFromRail;

  function openResumeChooser(work: Work, plan: ResumePlan) {
    setResumeChooser({ work, plan });
  }

  async function playResumeOption(work: Work, option: ResumeOption) {
    setResumeChooser(null);
    // Report the pick so declined gaps and rewatch answers are remembered.
    void client.recordResumeChoice(work.id, option).catch(() => undefined);
    try {
      const detail = await client.getWork(work.id);
      navigate(`/player/${option.media_file_id}`, {
        state: resumePlayerState(
          option,
          work.title,
          seriesPlaylist(detail, t),
          {
            backTo: detailRoute(work),
            detailParentBackTo: "/",
            navigationOrigin: navigationLayer.origin,
          },
          t
        ),
      });
    } catch {
      navigate(detailRoute(work));
    }
  }

  return (
    <TvStageShell
      className={`tv-home${homeView === "cover" ? " is-cover-view" : ""}`}
      ariaLabel={t("pages.home.title")}
      artworkKey={selected.id}
      artwork={
        <CachedArtworkImage
          work={selected}
          kinds={["backdrop", "poster"]}
          alt=""
          fallback={<span>{selected.title}</span>}
        />
      }
    >

      <Link to="/customise-home" className="tv-home-customise" data-navigation-focus-key="home:customise">
        {t("pages.home.customise.open")}
      </Link>

      <aside className="tv-home-feature" key={`home-feature-${selected.id}`}>
        <p className="tv-provider">
          {selectedEpisode
            ? t("pages.home.episodeProvider", {
                title: selected.title,
                season: String(selectedEpisode.seasonNumber).padStart(2, "0"),
                episode: String(selectedEpisode.detail.episode.episode_number).padStart(2, "0"),
              })
            : t("pages.home.kindGenre", {
                kind: workKindLabel(selected, t),
                genre: selected.genres[0] ?? t("pages.home.defaultGenre"),
              })}
        </p>
        <h2>{featureTitle}</h2>
        <p>{featureOverview}</p>
      </aside>

      <TvRailSurface
        className="tv-home-rails"
        ref={railsRef}
        mode="vertical-tracks"
        scrollKey="home:rails"
        ariaLabel={t("pages.home.mediaTracksAriaLabel")}
      >
        {rails.map((rail) => (
          <HomeRail
            key={rail.id}
            railId={rail.id}
            title={rail.title}
            items={rail.items}
            selectedId={selectedByRail[rail.id] ?? rail.items[0]?.id ?? null}
            isActive={activeRail === rail.id}
            onFocusItem={stableFocusFromRail}
            progressByWork={progressByWork}
            progressReady={watchProgress !== null}
            onDeckByWork={rail.id === "primary" ? onDeckByWork : undefined}
            stackedPlans={rail.id === "primary" ? stackedPlans : undefined}
            onOpenStack={openResumeChooser}
            onProgressChanged={handleProgressChanged}
            navigationOrigin={navigationLayer.origin}
            onNavigate={navigationLayer.captureLink}
            view={homeView}
          />
        ))}
      </TvRailSurface>
      {resumeChooser ? (
        <ResumeChooserModal
          plan={resumeChooser.plan}
          seriesTitle={resumeChooser.work.title}
          onCancel={() => setResumeChooser(null)}
          onSelect={(option) => void playResumeOption(resumeChooser.work, option)}
        />
      ) : null}
    </TvStageShell>
  );
}

function HomeRailArtwork({
  work,
  mediaFileId,
  title,
  children,
  view,
}: {
  work: Work;
  mediaFileId?: string | null;
  title: string;
  children: ReactNode;
  view: HomeViewPreference;
}) {
  const kinds =
    view === "cover"
      ? (["poster", "backdrop"] as const)
      : (["backdrop", "poster"] as const);
  const fallback = useCachedArtwork(work, kinds).url;
  if (mediaFileId && view === "thumbnail") {
    return (
      <MediaThumbnailArtwork
        mediaFileId={mediaFileId}
        fallback={fallback}
        className="tv-home-card-art"
        intersectionRootSelector=".tv-media-track-scroll"
      >
        {!fallback ? <span>{title}</span> : null}
        {children}
      </MediaThumbnailArtwork>
    );
  }

  return (
    <span className="tv-home-card-art">
      <CachedArtworkImage
        work={work}
        kinds={kinds}
        alt=""
        loading="lazy"
        fallback={<span>{title}</span>}
      />
      {children}
    </span>
  );
}

const HomeRail = memo(function HomeRail({
  railId,
  title,
  items,
  selectedId,
  isActive,
  onFocusItem,
  progressByWork = new Map(),
  progressReady,
  onDeckByWork = new Map(),
  stackedPlans = new Map(),
  onOpenStack,
  onProgressChanged,
  navigationOrigin,
  onNavigate,
  view,
}: {
  railId: HomeRailId;
  title: string;
  items: Work[];
  selectedId: string | null;
  isActive: boolean;
  onFocusItem: (
    rail: HomeRailId,
    id: string,
    section: HTMLElement
  ) => void;
  progressByWork?: Map<string, WatchProgress>;
  progressReady: boolean;
  onDeckByWork?: Map<string, OnDeckEntry>;
  stackedPlans?: Map<string, ResumePlan>;
  onOpenStack: (work: Work, plan: ResumePlan) => void;
  onProgressChanged: (workId: string, progress: WatchProgress[]) => void;
  navigationOrigin: ReturnType<typeof useNavigationLayer>["origin"];
  onNavigate: ReturnType<typeof useNavigationLayer>["captureLink"];
  view: HomeViewPreference;
}) {
  const mediaContext = useMediaContextMenu({ onProgressChanged });
  const { t } = useLanguage();

  return (
    <TvMediaTrack
      title={title}
      active={isActive}
      ariaLabel={title}
      scrollKey={`home:rail:${railId}`}
      itemsKey={items.map((item) => item.id).join(":")}
      dataTrackId={railId}
      overlay={mediaContext.contextMenu}
    >
      {items.map((work) => {
            const onDeckEntry = onDeckByWork.get(work.id);
            const episode = onDeckEntry?.episode;
            const mediaFileId =
              episode?.detail.media_file_id ??
              (work.kind === "artist"
                ? onDeckEntry?.progress?.media_file_id
                : undefined);
            const progress = onDeckEntry?.progress ?? progressByWork.get(work.id);
            const stackedPlan = stackedPlans.get(work.id);
            const title =
              episode?.detail.episode.title ??
              (episode
                ? t("pages.home.episodeLabel", { number: episode.detail.episode.episode_number })
                : work.title);
            const subtitle = episode
              ? t("pages.home.episodeProvider", {
                  title: work.title,
                  season: String(episode.seasonNumber).padStart(2, "0"),
                  episode: String(episode.detail.episode.episode_number).padStart(2, "0"),
                })
              : workKindLabel(work, t);
            return (
              <Link
                key={work.id}
                to={detailRoute(work)}
                state={{
                  backTo: "/",
                  episodeId: episode?.detail.episode.id,
                  mediaFileId,
                  navigationOrigin,
                }}
                className={`tv-home-card${
                  isActive && work.id === selectedId ? " is-selected" : ""
                }${stackedPlan ? " is-stacked" : ""}`}
                data-resume-stack={stackedPlan ? stackedPlan.options.length : undefined}
                data-tv-focus-default={
                  railId === "primary" && work.id === items[0]?.id ? true : undefined
                }
                data-navigation-focus-key={`home:${railId}:${work.id}`}
                onClick={(event) => {
                  if (stackedPlan) {
                    // Several ways to continue: ask here instead of opening the series.
                    event.preventDefault();
                    onOpenStack(work, stackedPlan);
                    return;
                  }
                  onNavigate(event);
                }}
                onFocus={(event) => {
                  const section = event.currentTarget.closest<HTMLElement>(
                    ".tv-media-track"
                  );
                  if (section) onFocusItem(railId, work.id, section);
                }}
                {...mediaContext.itemProps({
                  work,
                  detailRoute: detailRoute(work),
                  parentRoute: "/",
                  progress: progress ?? undefined,
                  preferredMediaFileId: mediaFileId,
                  preferredEpisodeId: episode?.detail.episode.id,
                })}
              >
                <HomeRailArtwork
                  work={work}
                  mediaFileId={mediaFileId}
                  title={title}
                  view={view}
                >
                  <WatchStateOverlay
                    progress={progress ?? undefined}
                    showUnwatched={progressReady && !stackedPlan}
                  />
                  {stackedPlan ? (
                    <i className="tv-home-card-stack-badge">
                      {t("pages.home.resumeOptions", { count: stackedPlan.options.length })}
                    </i>
                  ) : null}
                </HomeRailArtwork>
                <strong>{title}</strong>
                <small>{subtitle}</small>
              </Link>
            );
      })}
    </TvMediaTrack>
  );
});

function HomeLoader() {
  const { t } = useLanguage();
  return (
    <div
      className="tv-home tv-compact-loading"
      aria-label={t("pages.home.loadingAriaLabel")}
      role="status"
    >
      <div className="tv-orbit-loader" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <p>{t("pages.home.preparingHome")}</p>
    </div>
  );
}
