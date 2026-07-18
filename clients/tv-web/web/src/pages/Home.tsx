import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import type {
  EpisodeDetail,
  WatchProgress,
  Work,
  WorkChildren,
} from "@streamarr-tv/api-client";
import { useCatalogBrowse } from "@streamarr-tv/api-client/react";
import { useApiClient } from "../lib/ApiClientProvider";
import { useLanguage } from "../lib/i18n/LanguageProvider";
import {
  indexWatchProgressByWork,
  WatchStateOverlay,
} from "../components/WatchStateOverlay";
import { MediaThumbnailArtwork } from "../components/MediaThumbnailArtwork";
import { useMediaContextMenu } from "../components/MediaContextMenu";
import { CachedArtworkImage, useCachedArtwork } from "../lib/artwork";
import {
  isNavigationLayerRestoring,
  useNavigationLayer,
} from "../lib/navigationLayer";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import {
  TvMediaTrack,
  TvRailSurface,
  TvStageShell,
} from "../components/tv/TvStage";
import { TvEmptyState } from "../components/tv/TvEmptyState";

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

type HomeRailId =
  | "primary"
  | "new-movies"
  | "new-series"
  | "new-sites"
  | "more-movies"
  | "more-series"
  | "more-sites";

interface HomeRailDefinition {
  id: HomeRailId;
  title: string;
  items: Work[];
}

interface OnDeckEntry {
  work: Work;
  progress: WatchProgress;
  episode: {
    detail: EpisodeDetail;
    seasonNumber: number;
  } | null;
}

const EMPTY_WORKS: Work[] = [];

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
  behavior: ScrollBehavior
): void {
  const target =
    section.offsetTop + section.offsetHeight / 2 - container.clientHeight / 2;
  const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
  container.scrollTo({
    top: Math.max(0, Math.min(maxScrollTop, target)),
    behavior,
  });
}

/** TV-first landing page: a mixed library spotlight plus on-deck and recent rails. */
export function HomePage() {
  const { t } = useLanguage();
  useDocumentTitle(t("pages.home.title"));
  const client = useApiClient();
  const seriesState = useCatalogBrowse(client, {
    kind: "series",
    available_only: true,
    sort: "recent",
    limit: 36,
  });
  const movieState = useCatalogBrowse(client, {
    kind: "movie",
    available_only: true,
    sort: "recent",
    limit: 36,
  });
  const siteState = useCatalogBrowse(client, {
    kind: "site",
    available_only: true,
    sort: "recent",
    limit: 36,
  });
  const [activeRail, setActiveRail] = useState<HomeRailId>("primary");
  const [selectedByRail, setSelectedByRail] = useState<Record<HomeRailId, string | null>>({
    primary: null,
    "new-movies": null,
    "new-series": null,
    "new-sites": null,
    "more-movies": null,
    "more-series": null,
    "more-sites": null,
  });
  const [onDeck, setOnDeck] = useState<OnDeckEntry[]>([]);
  const [onDeckSettled, setOnDeckSettled] = useState(false);
  const [watchProgress, setWatchProgress] = useState<WatchProgress[] | null>(null);
  const railsRef = useRef<HTMLDivElement>(null);
  const focusedRailRef = useRef<HomeRailId | null>(null);
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

    client
      .listWatchProgress()
      .then(async (progressRows) => {
        if (!cancelled) setWatchProgress(progressRows);
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
        const resolved = await Promise.all(
          resumable.map(async (progress) => {
            try {
              const detail = await client.getWork(progress.work_id);
              const episode = isEpisodic(detail.work)
                ? findOnDeckEpisode(detail.children, progress.media_file_id)
                : null;
              if (isEpisodic(detail.work) && !episode) return null;
              return { work: detail.work, progress, episode };
            } catch {
              return null;
            }
          })
        );
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
        if (!cancelled) {
          setOnDeck([]);
          setWatchProgress(null);
          setOnDeckSettled(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [client]);

  const seriesItems = seriesState.status === "ready" ? seriesState.data.items : EMPTY_WORKS;
  const movieItems = movieState.status === "ready" ? movieState.data.items : EMPTY_WORKS;
  const siteItems = siteState.status === "ready" ? siteState.data.items : EMPTY_WORKS;
  const items = useMemo(
    () => mergeRecent(seriesItems, movieItems, siteItems),
    [seriesItems, movieItems, siteItems]
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
      {
        id: "new-movies",
        title: t("pages.home.rail.newMovies"),
        items: takeUnused(movieItems, 12),
      },
      {
        id: "new-series",
        title: t("pages.home.rail.newSeries"),
        items: takeUnused(seriesItems, 12),
      },
      {
        id: "new-sites",
        title: t("pages.home.rail.newSites"),
        items: takeUnused(siteItems, 12),
      },
      {
        id: "more-movies",
        title: t("pages.home.rail.moreMovies"),
        items: takeUnused(movieItems, 12),
      },
      {
        id: "more-series",
        title: t("pages.home.rail.moreSeries"),
        items: takeUnused(seriesItems, 12),
      },
      {
        id: "more-sites",
        title: t("pages.home.rail.moreSites"),
        items: takeUnused(siteItems, 12),
      },
    ];
    return definitions.filter((rail) => rail.items.length > 0);
  }, [items, movieItems, onDeckItems, seriesItems, siteItems, t]);
  const progressByWork = useMemo(
    () => indexWatchProgressByWork(watchProgress ?? []),
    [watchProgress]
  );
  const railsKey = useMemo(() => rails.map((rail) => rail.id).join(":"), [rails]);
  const navigationLayer = useNavigationLayer(
    rails
      .map((rail) => `${rail.id}:${rail.items.map((item) => item.id).join(",")}`)
      .join("|"),
    onDeckSettled &&
      seriesState.status === "ready" &&
      movieState.status === "ready" &&
      siteState.status === "ready",
    onDeckSettled &&
      seriesState.status === "ready" &&
      movieState.status === "ready" &&
      siteState.status === "ready"
  );

  useLayoutEffect(() => {
    if (navigationLayer.hasSnapshot) return;
    const container = railsRef.current;
    const firstSection = container?.querySelector<HTMLElement>(".tv-media-track");
    if (!container || !firstSection) return;
    centreHomeRail(container, firstSection, "auto");
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
    seriesState.status === "idle" ||
    seriesState.status === "loading" ||
    movieState.status === "idle" ||
    movieState.status === "loading" ||
    siteState.status === "idle" ||
    siteState.status === "loading";
  const error =
    seriesState.status === "error"
      ? seriesState.message
      : movieState.status === "error"
        ? movieState.message
        : siteState.status === "error"
          ? siteState.message
        : null;

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
    selectFromRail(rail, id);
    if (!enteredNewRail || isNavigationLayerRestoring()) return;

    window.requestAnimationFrame(() => {
      const container = railsRef.current;
      if (container && section.isConnected) {
        centreHomeRail(container, section, "smooth");
      }
    });
  }

  return (
    <TvStageShell
      className="tv-home"
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
            onSelect={selectFromRail}
            onFocusItem={focusFromRail}
            progressByWork={progressByWork}
            progressReady={watchProgress !== null}
            onDeckByWork={rail.id === "primary" ? onDeckByWork : undefined}
            onProgressChanged={handleProgressChanged}
            navigationOrigin={navigationLayer.origin}
            onNavigate={navigationLayer.captureLink}
          />
        ))}
      </TvRailSurface>
    </TvStageShell>
  );
}

function HomeRailArtwork({
  work,
  mediaFileId,
  title,
  children,
}: {
  work: Work;
  mediaFileId?: string | null;
  title: string;
  children: ReactNode;
}) {
  const fallback = useCachedArtwork(work, ["backdrop", "poster"]).url;
  if (mediaFileId) {
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
        kinds={["backdrop", "poster"]}
        alt=""
        loading="lazy"
        fallback={<span>{title}</span>}
      />
      {children}
    </span>
  );
}

function HomeRail({
  railId,
  title,
  items,
  selectedId,
  isActive,
  onSelect,
  onFocusItem,
  progressByWork = new Map(),
  progressReady,
  onDeckByWork = new Map(),
  onProgressChanged,
  navigationOrigin,
  onNavigate,
}: {
  railId: HomeRailId;
  title: string;
  items: Work[];
  selectedId: string | null;
  isActive: boolean;
  onSelect: (rail: HomeRailId, id: string) => void;
  onFocusItem: (
    rail: HomeRailId,
    id: string,
    section: HTMLElement
  ) => void;
  progressByWork?: Map<string, WatchProgress>;
  progressReady: boolean;
  onDeckByWork?: Map<string, OnDeckEntry>;
  onProgressChanged: (workId: string, progress: WatchProgress[]) => void;
  navigationOrigin: ReturnType<typeof useNavigationLayer>["origin"];
  onNavigate: ReturnType<typeof useNavigationLayer>["captureLink"];
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
                ? onDeckEntry?.progress.media_file_id
                : undefined);
            const progress = onDeckEntry?.progress ?? progressByWork.get(work.id);
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
                }`}
                data-tv-focus-default={
                  railId === "primary" && work.id === items[0]?.id ? true : undefined
                }
                data-navigation-focus-key={`home:${railId}:${work.id}`}
                onClick={onNavigate}
                onFocus={(event) => {
                  const section = event.currentTarget.closest<HTMLElement>(
                    ".tv-media-track"
                  );
                  if (section) onFocusItem(railId, work.id, section);
                }}
                onMouseEnter={() => onSelect(railId, work.id)}
                {...mediaContext.itemProps({
                  work,
                  detailRoute: detailRoute(work),
                  parentRoute: "/",
                  progress,
                  preferredMediaFileId: mediaFileId,
                  preferredEpisodeId: episode?.detail.episode.id,
                })}
              >
                <HomeRailArtwork
                  work={work}
                  mediaFileId={mediaFileId}
                  title={title}
                >
                  <WatchStateOverlay progress={progress} showUnwatched={progressReady} />
                </HomeRailArtwork>
                <strong>{title}</strong>
                <small>{subtitle}</small>
              </Link>
            );
      })}
    </TvMediaTrack>
  );
}

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
