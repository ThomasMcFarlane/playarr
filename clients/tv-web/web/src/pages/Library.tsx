import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  describeApiError,
  type WatchProgress,
  type Work,
  type WorkKind,
} from "@streamarr-tv/api-client";
import {
  indexWatchProgressByWork,
  WatchStateOverlay,
} from "../components/WatchStateOverlay";
import { useMediaContextMenu } from "../components/MediaContextMenu";
import { useApiClient } from "../lib/ApiClientProvider";
import { CachedArtworkImage } from "../lib/artwork";
import {
  isNavigationLayerRestoring,
  useNavigationLayer,
} from "../lib/navigationLayer";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import { useScrollEdges } from "../lib/useScrollEdges";
import { useLanguage } from "../lib/i18n/LanguageProvider";
import { TvRailSurface, TvStageShell } from "../components/tv/TvStage";
import { TvEmptyState } from "../components/tv/TvEmptyState";

const PAGE_SIZE = 200;
const ALPHABET = ["#", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"] as const;

function titleLetter(title: string): string {
  const first = title
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .charAt(0)
    .toUpperCase();
  return /^[A-Z]$/.test(first) ? first : "#";
}

function workLetter(work: Work): string {
  return titleLetter(work.sort_title || work.title);
}

function orderWorks(items: Work[], sort: LibrarySort, order: SortOrder): Work[] {
  const direction = order === "asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    if (sort === "date_added") {
      return (new Date(a.added_at).getTime() - new Date(b.added_at).getTime()) * direction;
    }
    return (
      (a.sort_title || a.title).localeCompare(b.sort_title || b.title, undefined, {
        numeric: true,
        sensitivity: "base",
      }) * direction
    );
  });
}

function afterTwoFrames(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
  });
}

type LibraryKind = Extract<WorkKind, "movie" | "series" | "site" | "artist">;
type LibraryView = "list" | "screen" | "cover" | "cover-flow";
type ArtworkSize = "small" | "medium" | "large";
type LibrarySort = "title" | "date_added";
type SortOrder = "asc" | "desc";

function storedView(kind: LibraryKind): LibraryView {
  const value = window.localStorage.getItem(`playarr.libraryView.${kind}`);
  return value === "list" || value === "cover" || value === "cover-flow"
    ? value
    : "screen";
}

function storedArtworkSize(kind: LibraryKind): ArtworkSize {
  const value = window.localStorage.getItem(`playarr.artworkSize.${kind}`);
  return value === "small" || value === "large" ? value : "medium";
}

function storedSort(kind: LibraryKind): LibrarySort {
  return window.localStorage.getItem(`playarr.librarySort.${kind}`) === "date_added"
    ? "date_added"
    : "title";
}

function storedOrder(kind: LibraryKind): SortOrder {
  return window.localStorage.getItem(`playarr.libraryOrder.${kind}`) === "desc" ? "desc" : "asc";
}

/**
 * Remote-first Movies/Series/Sites/Music library. Titles live in a large, vertically
 * scrolling TV rail; focus reveals the selected title on the left and
 * activation opens its detail page. Playback never starts from this view.
 */
export function LibraryPage({ kind }: { kind: LibraryKind }) {
  const { t } = useLanguage();
  const singular =
    kind === "series"
      ? t("pages.library.singular.series")
      : kind === "site"
        ? t("pages.library.singular.site")
        : kind === "artist"
          ? t("pages.library.singular.artist")
          : t("pages.library.singular.movie");
  const plural =
    kind === "series"
      ? t("pages.library.plural.series")
      : kind === "site"
        ? t("pages.library.plural.sites")
        : kind === "artist"
          ? t("pages.library.plural.music")
          : t("pages.library.plural.movies");
  const routeBase =
    kind === "series"
      ? "/series"
      : kind === "site"
        ? "/sites"
        : kind === "artist"
          ? "/music"
          : "/movies";
  const emptyGraphic =
    kind === "movie" ? "movies" : kind === "artist" ? "music" : "series";
  const collectionNoun =
    kind === "artist" ? t("pages.library.collectionNoun.artists") : t("pages.library.collectionNoun.titles");
  useDocumentTitle(plural);

  const client = useApiClient();
  const [items, setItems] = useState<Work[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [initialError, setInitialError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [activeLetter, setActiveLetter] = useState("#");
  const [jumpingLetter, setJumpingLetter] = useState<string | null>(null);
  const [view, setView] = useState<LibraryView>(() => storedView(kind));
  const [artworkSize, setArtworkSize] = useState<ArtworkSize>(() => storedArtworkSize(kind));
  const [sort, setSort] = useState<LibrarySort>(() => storedSort(kind));
  const [order, setOrder] = useState<SortOrder>(() => storedOrder(kind));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [watchProgress, setWatchProgress] = useState<WatchProgress[] | null>(null);

  const gridRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const letterRefs = useRef(new Map<string, HTMLAnchorElement>());
  const itemsRef = useRef<Work[]>([]);
  const totalRef = useRef<number | null>(null);
  const requestRef = useRef<Promise<Work[]> | null>(null);
  const generationRef = useRef(0);
  const loadedKindRef = useRef(kind);
  const scrollEdges = useScrollEdges(
    gridRef,
    view === "cover-flow" ? "horizontal" : "vertical",
    `${kind}:${view}:${artworkSize}:${items?.length ?? 0}`
  );

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    let cancelled = false;
    const kindChanged = loadedKindRef.current !== kind;
    const hasVisibleItems = !kindChanged && itemsRef.current.length > 0;
    loadedKindRef.current = kind;

    itemsRef.current = [];
    totalRef.current = null;
    requestRef.current = null;
    letterRefs.current.clear();
    if (!hasVisibleItems) setItems(null);
    setTotal(null);
    if (!hasVisibleItems) setSelectedId(null);
    setInitialError(null);
    setLoadMoreError(null);
    setRefreshing(hasVisibleItems);
    if (!hasVisibleItems) setActiveLetter("#");

    client
      .browseCatalog({
        kind,
        available_only: true,
        sort,
        order,
        limit: PAGE_SIZE,
        offset: 0,
      })
      .then((page) => {
        if (cancelled || generation !== generationRef.current) return;
        const orderedItems = orderWorks(page.items, sort, order);
        itemsRef.current = orderedItems;
        totalRef.current = page.total ?? orderedItems.length;
        setItems(orderedItems);
        setTotal(totalRef.current);
        setSelectedId(orderedItems[0]?.id ?? null);
        setActiveLetter(orderedItems[0] ? workLetter(orderedItems[0]) : "#");
        setRefreshing(false);
      })
      .catch((error: unknown) => {
        if (!cancelled && generation === generationRef.current) {
          if (hasVisibleItems) {
            setLoadMoreError(describeApiError(error));
          } else {
            setInitialError(describeApiError(error));
          }
          setRefreshing(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [client, kind, order, sort]);

  useEffect(() => {
    setView(storedView(kind));
    setArtworkSize(storedArtworkSize(kind));
    setSort(storedSort(kind));
    setOrder(storedOrder(kind));
    setFiltersOpen(false);
  }, [kind]);

  useEffect(() => {
    let cancelled = false;
    setWatchProgress(null);
    client
      .listWatchProgress()
      .then((rows) => {
        if (!cancelled) setWatchProgress(rows);
      })
      .catch(() => {
        if (!cancelled) setWatchProgress(null);
      });

    return () => {
      cancelled = true;
    };
  }, [client]);

  function changeView(nextView: LibraryView) {
    window.localStorage.setItem(`playarr.libraryView.${kind}`, nextView);
    setView(nextView);
  }

  function changeArtworkSize(nextSize: ArtworkSize) {
    window.localStorage.setItem(`playarr.artworkSize.${kind}`, nextSize);
    setArtworkSize(nextSize);
  }

  function changeSort(nextSort: LibrarySort) {
    window.localStorage.setItem(`playarr.librarySort.${kind}`, nextSort);
    const reordered = orderWorks(itemsRef.current, nextSort, order);
    itemsRef.current = reordered;
    setItems(reordered);
    setSort(nextSort);
  }

  function changeOrder(nextOrder: SortOrder) {
    window.localStorage.setItem(`playarr.libraryOrder.${kind}`, nextOrder);
    const reordered = orderWorks(itemsRef.current, sort, nextOrder);
    itemsRef.current = reordered;
    setItems(reordered);
    setSelectedId((current) => current ?? reordered[0]?.id ?? null);
    setOrder(nextOrder);
  }

  const updateActiveLetter = useCallback(() => {
    const grid = gridRef.current;
    if (!grid) return;

    const gridRect = grid.getBoundingClientRect();
    if (view === "cover-flow") {
      const trackingLine = gridRect.left + gridRect.width / 2;
      const closestCard = Array.from(
        grid.querySelectorAll<HTMLElement>(".tv-title-card")
      )
        .filter((card) => {
          const rect = card.getBoundingClientRect();
          return rect.right > gridRect.left && rect.left < gridRect.right;
        })
        .sort((a, b) => {
          const aRect = a.getBoundingClientRect();
          const bRect = b.getBoundingClientRect();
          const aDistance = Math.abs(aRect.left + aRect.width / 2 - trackingLine);
          const bDistance = Math.abs(bRect.left + bRect.width / 2 - trackingLine);
          return aDistance - bDistance;
        })[0];
      const visibleLetter = closestCard?.dataset.libraryLetter;
      if (visibleLetter) setActiveLetter(visibleLetter);
      return;
    }

    const trackingLine = gridRect.top + Math.min(64, grid.clientHeight * 0.1);
    const firstVisibleCard = Array.from(
      grid.querySelectorAll<HTMLElement>(".tv-title-card")
    ).find((card) => card.getBoundingClientRect().bottom > trackingLine);
    const visibleLetter = firstVisibleCard?.dataset.libraryLetter;
    if (visibleLetter) setActiveLetter(visibleLetter);
  }, [view]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(updateActiveLetter);
    const grid = gridRef.current;
    if (!grid) return () => window.cancelAnimationFrame(frame);
    const observer = new ResizeObserver(updateActiveLetter);
    observer.observe(grid);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [items, view, updateActiveLetter]);

  const appendNextPage = useCallback((): Promise<Work[]> => {
    if (requestRef.current) return requestRef.current;
    if (totalRef.current !== null && itemsRef.current.length >= totalRef.current) {
      return Promise.resolve([]);
    }

    const generation = generationRef.current;
    const offset = itemsRef.current.length;
    setLoadingMore(true);
    setLoadMoreError(null);

    const request = client
      .browseCatalog({
        kind,
        available_only: true,
        sort,
        order,
        limit: PAGE_SIZE,
        offset,
      })
      .then((page) => {
        if (generation !== generationRef.current) return [];
        const existingIds = new Set(itemsRef.current.map((work) => work.id));
        const uniqueItems = page.items.filter((work) => !existingIds.has(work.id));
        const merged = orderWorks([...itemsRef.current, ...uniqueItems], sort, order);
        itemsRef.current = merged;
        totalRef.current = page.total ?? totalRef.current ?? merged.length;
        setItems(merged);
        setTotal(totalRef.current);
        return uniqueItems;
      })
      .catch((error: unknown) => {
        if (generation === generationRef.current) {
          setLoadMoreError(describeApiError(error));
        }
        throw error;
      })
      .finally(() => {
        if (generation === generationRef.current) setLoadingMore(false);
        requestRef.current = null;
      });

    requestRef.current = request;
    return request;
  }, [client, kind, order, sort]);

  const hasMore =
    !refreshing && items !== null && (total === null || items.length < total);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const grid = gridRef.current;
    if (!sentinel || !grid || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void appendNextPage().catch(() => undefined);
        }
      },
      {
        root: grid,
        rootMargin:
          view === "cover-flow" ? "0px 800px 0px 0px" : "0px 0px 800px 0px",
        threshold: 0,
      }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [appendNextPage, hasMore, view]);

  const selected = useMemo(
    () => items?.find((work) => work.id === selectedId) ?? items?.[0] ?? null,
    [items, selectedId]
  );
  const progressByWork = useMemo(
    () => indexWatchProgressByWork(watchProgress ?? []),
    [watchProgress]
  );
  const handleProgressChanged = useCallback(
    (_workId: string, updated: WatchProgress[]) => {
      const updatedIds = new Set(updated.map((progress) => progress.media_file_id));
      setWatchProgress((current) => [
        ...(current ?? []).filter(
          (progress) => !updatedIds.has(progress.media_file_id)
        ),
        ...updated,
      ]);
    },
    []
  );
  const mediaContext = useMediaContextMenu({
    onProgressChanged: handleProgressChanged,
  });
  const navigationLayer = useNavigationLayer(
    `${kind}:${view}:${artworkSize}:${sort}:${order}:${
      items?.map((work) => work.id).join(",") ?? "loading"
    }`,
    items !== null && !hasMore
  );
  const restoreFocusPrefix = `library:${kind}:`;
  const restoreWorkId = navigationLayer.focusKey?.startsWith(restoreFocusPrefix)
    ? navigationLayer.focusKey.slice(restoreFocusPrefix.length)
    : null;

  useEffect(() => {
    if (
      !navigationLayer.hasSnapshot ||
      !restoreWorkId ||
      items === null ||
      items.some((work) => work.id === restoreWorkId) ||
      !hasMore
    ) {
      return;
    }
    void appendNextPage().catch(() => undefined);
  }, [
    appendNextPage,
    hasMore,
    items,
    navigationLayer.hasSnapshot,
    restoreWorkId,
  ]);

  async function jumpToLetter(letter: string) {
    setJumpingLetter(letter);
    try {
      while (
        !letterRefs.current.has(letter) &&
        (totalRef.current === null || itemsRef.current.length < totalRef.current)
      ) {
        const added = await appendNextPage();
        if (added.length === 0) break;
      }

      await afterTwoFrames();
      const letters = order === "desc" ? [...ALPHABET].reverse() : [...ALPHABET];
      const targetIndex = letters.indexOf(letter as (typeof ALPHABET)[number]);
      const destinationLetter =
        (letterRefs.current.has(letter)
          ? letter
          : letters.slice(targetIndex).find((candidate) => letterRefs.current.has(candidate))) ??
        [...letters.slice(0, targetIndex)]
          .reverse()
          .find((candidate) => letterRefs.current.has(candidate));
      const destination = destinationLetter ? letterRefs.current.get(destinationLetter) : undefined;

      destination?.focus({ preventScroll: true });
      destination?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    } finally {
      setJumpingLetter(null);
    }
  }

  if (items === null && !initialError) {
    return <CompactLibraryLoader label={plural} />;
  }

  if (initialError) {
    return (
      <div className="page tv-state-page">
        <TvEmptyState
          graphic={emptyGraphic}
          tone="error"
          variant="page"
          title={t("pages.library.errorTitle", { plural: plural.toLowerCase() })}
          description={initialError}
        />
      </div>
    );
  }

  if (!items?.length || !selected) {
    return (
      <div className="page tv-state-page">
        <TvEmptyState
          graphic={emptyGraphic}
          variant="page"
          title={t("pages.library.emptyTitle", { plural: plural.toLowerCase() })}
          description={t("pages.library.emptyDescription", { collectionNoun })}
        />
      </div>
    );
  }

  const alphabet = order === "desc" ? [...ALPHABET].reverse() : [...ALPHABET];
  const selectedIndex = Math.max(
    0,
    items.findIndex((item) => item.id === selected.id)
  );

  return (
    <TvStageShell
      className={`tv-library tv-directory tv-directory-${view} tv-artwork-${artworkSize}`}
      ariaLabel={t("pages.library.stageAriaLabel", { plural })}
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
      <header className="tv-library-heading">
        <Link to="/" className="tv-page-back" aria-label={t("pages.library.backToHome")}>
          <span aria-hidden="true">←</span>
        </Link>
        <h1>{plural}</h1>
        <span>
          {(total ?? items.length).toLocaleString()} {collectionNoun}
        </span>
      </header>

      <aside className="tv-library-preview" key={`preview-${selected.id}`}>
        <p className="tv-provider">{selected.genres[0] ?? singular}</p>
        <h2>{selected.title}</h2>
        <p className="tv-preview-meta">
          <span>{new Date(selected.added_at).getFullYear()}</span>
          <span>{selected.genres.slice(0, 2).join(" · ") || singular}</span>
        </p>
        <p className="tv-preview-overview">
          {selected.overview ?? t("pages.library.noSynopsis")}
        </p>
      </aside>

      <TvRailSurface
        className={`tv-rail-panel tv-library-grid-panel is-${view} artwork-${artworkSize}${
          scrollEdges.start
            ? view === "cover-flow"
              ? " can-scroll-left"
              : " can-scroll-up"
            : ""
        }${
          scrollEdges.end
            ? view === "cover-flow"
              ? " can-scroll-right"
              : " can-scroll-down"
            : ""
        }`}
        mode="content"
        ariaLabel={t("pages.library.railAriaLabel", { plural, collectionNoun })}
      >
        {refreshing ? (
          <span className="tv-library-refreshing" role="status" aria-label={t("pages.library.updatingLibrary")}>
            <span className="tv-mini-loader" aria-hidden="true" />
          </span>
        ) : null}
        <div
          className="tv-title-grid"
          ref={gridRef}
          onScroll={updateActiveLetter}
          data-tv-scroll-container
          data-tv-scroll-axis={view === "cover-flow" ? "horizontal" : "vertical"}
          data-navigation-scroll-key={`library:${kind}:grid`}
          aria-busy={refreshing}
        >
          <div className="tv-title-grid-content">
            {items.map((work, index) => {
              const imageKinds =
                view === "cover" || view === "cover-flow"
                  ? (["poster", "backdrop"] as const)
                  : (["backdrop", "poster"] as const);
              const letter = workLetter(work);
              const isFirstForLetter = index === 0 || workLetter(items[index - 1]!) !== letter;
              const isSelected = work.id === selected.id;
              const coverFlowOffset =
                view === "cover-flow"
                  ? Math.max(-4, Math.min(4, index - selectedIndex))
                  : 0;

              return (
                <Link
                  key={work.id}
                  to={`${routeBase}/${work.id}`}
                  state={{ backTo: routeBase, navigationOrigin: navigationLayer.origin }}
                  className={`tv-title-card${isSelected ? " is-selected" : ""}${
                    view === "cover-flow"
                      ? ` cover-flow-offset-${Math.abs(coverFlowOffset)}${
                          coverFlowOffset < 0
                            ? " is-before"
                            : coverFlowOffset > 0
                              ? " is-after"
                              : ""
                        }`
                      : ""
                  }`}
                  ref={(element) => {
                    if (isFirstForLetter) {
                      if (element) letterRefs.current.set(letter, element);
                      else letterRefs.current.delete(letter);
                    }
                  }}
                  onFocus={(event) => {
                    setSelectedId(work.id);
                    if (view === "cover-flow" && !isNavigationLayerRestoring()) {
                      const card = event.currentTarget;
                      const grid = gridRef.current;
                      if (grid) {
                        const targetLeft =
                          card.offsetLeft + card.offsetWidth / 2 - grid.clientWidth / 2;
                        grid.scrollTo({
                          left: Math.max(0, targetLeft),
                          behavior: "smooth",
                        });
                      }
                    }
                    if (index >= items.length - 12 && hasMore) {
                      void appendNextPage().catch(() => undefined);
                    }
                  }}
                  data-library-letter={letter}
                  data-tv-focus-default={index === 0 ? true : undefined}
                  data-navigation-focus-key={`library:${kind}:${work.id}`}
                  onClick={navigationLayer.captureLink}
                  aria-label={t("pages.library.openWork", { title: work.title })}
                  {...mediaContext.itemProps({
                    work,
                    detailRoute: `${routeBase}/${work.id}`,
                    parentRoute: routeBase,
                    progress: progressByWork.get(work.id),
                  })}
                >
                  <span className="tv-title-card-art">
                    <CachedArtworkImage
                      work={work}
                      kinds={imageKinds}
                      alt=""
                      loading="lazy"
                      fallback={<span>{work.title}</span>}
                    />
                    <WatchStateOverlay
                      progress={progressByWork.get(work.id)}
                      showUnwatched={watchProgress !== null}
                    />
                  </span>
                  <span className="tv-title-card-copy">
                    <strong>{work.title}</strong>
                    <span className="tv-list-card-meta">
                      {work.genres.slice(0, 2).join(" · ") || singular}
                      <i aria-hidden="true" />
                      {new Date(work.added_at).getFullYear()}
                    </span>
                  </span>
                </Link>
              );
            })}

            <div ref={sentinelRef} className="tv-grid-sentinel" aria-live="polite">
              {loadingMore ? (
                <span className="tv-mini-loader" aria-label={t("pages.library.loadingMoreTitles")} />
              ) : null}
            </div>
          </div>
        </div>

        {loadMoreError && (
          <button
            type="button"
            className="tv-inline-error"
            onClick={() => void appendNextPage().catch(() => undefined)}
          >
            {t("pages.library.retryLoadMore")}
          </button>
        )}
      </TvRailSurface>

      <button
        type="button"
        className={`tv-filter-launcher${filtersOpen ? " is-active" : ""}`}
        onClick={() => setFiltersOpen((open) => !open)}
        aria-expanded={filtersOpen}
        aria-controls={`${kind}-library-filters`}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 6h16M7 12h10m-7 6h4" />
          <circle cx="8" cy="6" r="1.5" />
          <circle cx="15" cy="12" r="1.5" />
          <circle cx="12" cy="18" r="1.5" />
        </svg>
        <span>{t("pages.library.filters")}</span>
      </button>

      {filtersOpen ? (
        <aside
          id={`${kind}-library-filters`}
          className="tv-filter-drawer"
          aria-label={t("pages.library.filterDrawerAriaLabel", { plural })}
        >
          <header>
            <div>
              <p>{t("pages.library.libraryControls")}</p>
              <h2>{t("pages.library.filters")}</h2>
            </div>
            <button type="button" onClick={() => setFiltersOpen(false)} aria-label={t("pages.library.closeFilters")}>
              ×
            </button>
          </header>

          <section>
            <h3>{t("pages.library.view")}</h3>
            <div className="tv-filter-choice-grid tv-filter-view-options">
              {(["list", "screen", "cover", "cover-flow"] as LibraryView[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={view === option ? "is-active" : ""}
                  onClick={() => changeView(option)}
                  aria-pressed={view === option}
                >
                  <span className={`tv-view-icon tv-view-icon-${option}`} aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  <strong>
                    {option === "cover-flow"
                      ? t("pages.library.viewCoverFlow")
                      : option === "list"
                        ? t("pages.library.viewList")
                        : option === "screen"
                          ? t("pages.library.viewScreen")
                          : t("pages.library.viewCover")}
                  </strong>
                </button>
              ))}
            </div>
          </section>

          <section>
            <h3>{t("pages.library.artworkSize")}</h3>
            <div className="tv-filter-choice-grid">
              {(["small", "medium", "large"] as ArtworkSize[]).map((size) => (
                <button
                  key={size}
                  type="button"
                  className={artworkSize === size ? "is-active" : ""}
                  onClick={() => changeArtworkSize(size)}
                  aria-pressed={artworkSize === size}
                >
                  {size === "small"
                    ? t("pages.library.sizeSmall")
                    : size === "large"
                      ? t("pages.library.sizeLarge")
                      : t("pages.library.sizeMedium")}
                </button>
              ))}
            </div>
          </section>

          <section>
            <h3>{t("pages.library.sortBy")}</h3>
            <div className="tv-filter-choice-grid tv-filter-choice-grid-wide">
              <button
                type="button"
                className={sort === "title" ? "is-active" : ""}
                onClick={() => changeSort("title")}
                aria-pressed={sort === "title"}
              >
                {t("pages.library.sortTitle")}
              </button>
              <button
                type="button"
                className={sort === "date_added" ? "is-active" : ""}
                onClick={() => changeSort("date_added")}
                aria-pressed={sort === "date_added"}
              >
                {t("pages.library.sortDateAdded")}
              </button>
            </div>
          </section>

          <section>
            <h3>{t("pages.library.order")}</h3>
            <div className="tv-filter-choice-grid tv-filter-choice-grid-wide">
              <button
                type="button"
                className={order === "asc" ? "is-active" : ""}
                onClick={() => changeOrder("asc")}
                aria-pressed={order === "asc"}
              >
                {sort === "title" ? t("pages.library.sortAscAlpha") : t("pages.library.sortAscDate")}
              </button>
              <button
                type="button"
                className={order === "desc" ? "is-active" : ""}
                onClick={() => changeOrder("desc")}
                aria-pressed={order === "desc"}
              >
                {sort === "title" ? t("pages.library.sortDescAlpha") : t("pages.library.sortDescDate")}
              </button>
            </div>
          </section>
        </aside>
      ) : null}

      {sort === "title" ? (
        <nav className="tv-alphabet" aria-label={t("pages.library.jumpThrough", { plural: plural.toLowerCase() })}>
          {alphabet.map((letter) => (
            <button
              key={letter}
              type="button"
              className={activeLetter === letter ? "is-active" : ""}
              onClick={() => void jumpToLetter(letter)}
              aria-current={activeLetter === letter ? "true" : undefined}
              aria-label={letter === "#" ? t("pages.library.numbersAndSymbols") : letter}
            >
              <span>{jumpingLetter === letter ? "·" : letter}</span>
            </button>
          ))}
        </nav>
      ) : null}
      {mediaContext.contextMenu}
    </TvStageShell>
  );
}

function CompactLibraryLoader({ label }: { label: string }) {
  const { t } = useLanguage();
  return (
    <div
      className="tv-library tv-compact-loading"
      aria-label={t("pages.library.loadingLabel", { label })}
      role="status"
    >
      <div className="tv-orbit-loader" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <p>{t("pages.library.preparingLabel", { label: label.toLowerCase() })}</p>
    </div>
  );
}
