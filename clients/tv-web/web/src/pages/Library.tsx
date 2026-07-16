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
import { useNavigationLayer } from "../lib/navigationLayer";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import { useScrollEdges } from "../lib/useScrollEdges";
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
type LibraryView = "list" | "screen" | "cover";
type ArtworkSize = "small" | "medium" | "large";
type LibrarySort = "title" | "date_added";
type SortOrder = "asc" | "desc";

function storedView(kind: LibraryKind): LibraryView {
  const value = window.localStorage.getItem(`playarr.libraryView.${kind}`);
  return value === "list" || value === "cover" ? value : "screen";
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
  const singular =
    kind === "series"
      ? "Series"
      : kind === "site"
        ? "Site"
        : kind === "artist"
          ? "Artist"
          : "Movie";
  const plural =
    kind === "series"
      ? "Series"
      : kind === "site"
        ? "Sites"
        : kind === "artist"
          ? "Music"
          : "Movies";
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
  const collectionNoun = kind === "artist" ? "artists" : "titles";
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
    "vertical",
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
    const trackingLine = gridRect.top + Math.min(64, grid.clientHeight * 0.1);
    const firstVisibleCard = Array.from(
      grid.querySelectorAll<HTMLElement>(".tv-title-card")
    ).find((card) => card.getBoundingClientRect().bottom > trackingLine);
    const visibleLetter = firstVisibleCard?.dataset.libraryLetter;
    if (visibleLetter) setActiveLetter(visibleLetter);
  }, []);

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
      { root: grid, rootMargin: "0px 0px 800px 0px", threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [appendNextPage, hasMore]);

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
          title={`The ${plural.toLowerCase()} library could not be loaded`}
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
          title={`No playable ${plural.toLowerCase()} yet`}
          description={`Available ${collectionNoun} will appear here after your library is updated.`}
        />
      </div>
    );
  }

  const alphabet = order === "desc" ? [...ALPHABET].reverse() : [...ALPHABET];

  return (
    <TvStageShell
      className={`tv-library tv-directory tv-directory-${view} tv-artwork-${artworkSize}`}
      ariaLabel={`${plural} library`}
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
        <Link to="/" className="tv-page-back" aria-label="Back to Home">
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
          {selected.overview ?? "No synopsis is available."}
        </p>
      </aside>

      <TvRailSurface
        className={`tv-rail-panel tv-library-grid-panel is-${view} artwork-${artworkSize}${
          scrollEdges.start ? " can-scroll-up" : ""
        }${scrollEdges.end ? " can-scroll-down" : ""}`}
        mode="content"
        ariaLabel={`${plural} ${collectionNoun}`}
      >
        {refreshing ? (
          <span className="tv-library-refreshing" role="status" aria-label="Updating library">
            <span className="tv-mini-loader" aria-hidden="true" />
          </span>
        ) : null}
        <div
          className="tv-title-grid"
          ref={gridRef}
          onScroll={updateActiveLetter}
          data-tv-scroll-container
          data-tv-scroll-axis="vertical"
          data-navigation-scroll-key={`library:${kind}:grid`}
          aria-busy={refreshing}
        >
          <div className="tv-title-grid-content">
            {items.map((work, index) => {
              const imageKinds =
                view === "cover"
                  ? (["poster", "backdrop"] as const)
                  : (["backdrop", "poster"] as const);
              const letter = workLetter(work);
              const isFirstForLetter = index === 0 || workLetter(items[index - 1]!) !== letter;
              const isSelected = work.id === selected.id;

              return (
                <Link
                  key={work.id}
                  to={`${routeBase}/${work.id}`}
                  state={{ backTo: routeBase, navigationOrigin: navigationLayer.origin }}
                  className={`tv-title-card${isSelected ? " is-selected" : ""}`}
                  ref={(element) => {
                    if (isFirstForLetter) {
                      if (element) letterRefs.current.set(letter, element);
                      else letterRefs.current.delete(letter);
                    }
                  }}
                  onFocus={() => {
                    setSelectedId(work.id);
                    if (index >= items.length - 12 && hasMore) {
                      void appendNextPage().catch(() => undefined);
                    }
                  }}
                  onMouseEnter={() => setSelectedId(work.id)}
                  data-library-letter={letter}
                  data-tv-focus-default={index === 0 ? true : undefined}
                  data-navigation-focus-key={`library:${kind}:${work.id}`}
                  onClick={navigationLayer.captureLink}
                  aria-label={`Open ${work.title}`}
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
                <span className="tv-mini-loader" aria-label="Loading more titles" />
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
            More titles could not be loaded. Press to retry.
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
        <span>Filters</span>
      </button>

      {filtersOpen ? (
        <aside
          id={`${kind}-library-filters`}
          className="tv-filter-drawer"
          aria-label={`${plural} display filters`}
        >
          <header>
            <div>
              <p>Library controls</p>
              <h2>Filters</h2>
            </div>
            <button type="button" onClick={() => setFiltersOpen(false)} aria-label="Close filters">
              ×
            </button>
          </header>

          <section>
            <h3>View</h3>
            <div className="tv-filter-choice-grid tv-filter-view-options">
              {(["list", "screen", "cover"] as LibraryView[]).map((option) => (
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
                  <strong>{option}</strong>
                </button>
              ))}
            </div>
          </section>

          <section>
            <h3>Artwork size</h3>
            <div className="tv-filter-choice-grid">
              {(["small", "medium", "large"] as ArtworkSize[]).map((size) => (
                <button
                  key={size}
                  type="button"
                  className={artworkSize === size ? "is-active" : ""}
                  onClick={() => changeArtworkSize(size)}
                  aria-pressed={artworkSize === size}
                >
                  {size}
                </button>
              ))}
            </div>
          </section>

          <section>
            <h3>Sort by</h3>
            <div className="tv-filter-choice-grid tv-filter-choice-grid-wide">
              <button
                type="button"
                className={sort === "title" ? "is-active" : ""}
                onClick={() => changeSort("title")}
                aria-pressed={sort === "title"}
              >
                Title
              </button>
              <button
                type="button"
                className={sort === "date_added" ? "is-active" : ""}
                onClick={() => changeSort("date_added")}
                aria-pressed={sort === "date_added"}
              >
                Date added
              </button>
            </div>
          </section>

          <section>
            <h3>Order</h3>
            <div className="tv-filter-choice-grid tv-filter-choice-grid-wide">
              <button
                type="button"
                className={order === "asc" ? "is-active" : ""}
                onClick={() => changeOrder("asc")}
                aria-pressed={order === "asc"}
              >
                {sort === "title" ? "A–Z" : "Oldest first"}
              </button>
              <button
                type="button"
                className={order === "desc" ? "is-active" : ""}
                onClick={() => changeOrder("desc")}
                aria-pressed={order === "desc"}
              >
                {sort === "title" ? "Z–A" : "Newest first"}
              </button>
            </div>
          </section>
        </aside>
      ) : null}

      {sort === "title" ? (
        <nav className="tv-alphabet" aria-label={`Jump through ${plural.toLowerCase()}`}>
          {alphabet.map((letter) => (
            <button
              key={letter}
              type="button"
              className={activeLetter === letter ? "is-active" : ""}
              onClick={() => void jumpToLetter(letter)}
              aria-current={activeLetter === letter ? "true" : undefined}
              aria-label={letter === "#" ? "Numbers and symbols" : letter}
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
  return (
    <div className="tv-library tv-compact-loading" aria-label={`Loading ${label}`} role="status">
      <div className="tv-orbit-loader" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <p>Preparing {label.toLowerCase()}</p>
    </div>
  );
}
