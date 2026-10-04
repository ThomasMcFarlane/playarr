import {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { flushSync } from "react-dom";
import { Link, useSearchParams } from "react-router-dom";
import {
  describeApiError,
  type LanguageFacets,
  type WatchProgress,
  type Work,
  type WorkKind,
} from "@playarr-tv/api-client";
import {
  indexWatchProgressByWork,
  WatchStateOverlay,
} from "../components/WatchStateOverlay";
import { useMediaContextMenu } from "../components/MediaContextMenu";
import { useApiClient } from "../lib/ApiClientProvider";
import { useLiveRevision, useLiveSubscription } from "../lib/liveEvents";
import { CachedArtworkImage } from "../lib/artwork";
import {
  libraryChunkRanges,
  sameLibraryChunkItems,
} from "../lib/libraryChunks";
import { whenNavigationIdle } from "../lib/navigationActivity";
import {
  libraryExpandMountedEnd,
  libraryWindowContains,
} from "../lib/focusGeometry";
import {
  isNavigationLayerRestoring,
  useNavigationLayer,
} from "../lib/navigationLayer";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import { useScrollEdges } from "../lib/useScrollEdges";
import { useLanguage } from "../lib/i18n/LanguageProvider";
import {
  formatLanguageParam,
  languageDisplayName,
  parseLanguageParam,
  toggleLanguage,
} from "../lib/languageFilters";
import { TvRailSurface, TvStageShell } from "../components/tv/TvStage";
import { usePanelParam } from "../lib/usePanelParam";
import { FiltersDrawer, PageHeader, ViewToggle } from "../components/shell";
import { TvEmptyState } from "../components/tv/TvEmptyState";

/** Initial DOM mount for dense grids — enough for a full 4K viewport + headroom. */
const INITIAL_MOUNTED = 48;

/** Rows kept mounted ahead of the settled selection (filled while idle). */
const PREMOUNT_AHEAD_ROWS = 70;
/** Rows above and below the viewport whose artwork is kept loaded. */
const ARTWORK_MARGIN_ROWS = 2;
/** Rows mounted per idle task, and the pause between tasks. */
const PREMOUNT_SLICE_ROWS = 2;
const PREMOUNT_GAP_MS = 24;

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

// One collator for every comparison: `localeCompare(..., options)` builds a new
// collator per call, which made re-sorting a few hundred titles when a
// catalogue page arrived a visible main-thread stall on TV-class CPUs.
const TITLE_COLLATOR = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

function orderWorks(items: Work[], sort: LibrarySort, order: SortOrder): Work[] {
  const direction = order === "asc" ? 1 : -1;
  if (sort === "date_added") {
    const added = new Map(items.map((work) => [work.id, new Date(work.added_at).getTime()]));
    return [...items].sort((a, b) => (added.get(a.id)! - added.get(b.id)!) * direction);
  }
  return [...items].sort(
    (a, b) => TITLE_COLLATOR.compare(a.sort_title || a.title, b.sort_title || b.title) * direction
  );
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
  if (value === "cover-flow") return kind === "artist" ? "cover-flow" : "screen";
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
  const { t, language: uiLanguage } = useLanguage();
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
  // The open Filters panel lives in the URL (`?panel=filters`) so refresh and deep links restore it.
  const [panel, setPanel] = usePanelParam(["filters"] as const);
  const filtersOpen = panel === "filters";
  const setFiltersOpen = (next: boolean | ((open: boolean) => boolean)) =>
    setPanel((typeof next === "function" ? next(filtersOpen) : next) ? "filters" : null);
  const previousKind = useRef(kind);
  // Audio/subtitle language filters live in the URL (`?audio=en,ja&subs=fr`)
  // so they survive reloads and can be shared or bookmarked.
  const [searchParams, setSearchParams] = useSearchParams();
  const audioKey = searchParams.get("audio") ?? "";
  const subtitleKey = searchParams.get("subs") ?? "";
  const audioLangs = useMemo(() => parseLanguageParam(audioKey), [audioKey]);
  const subtitleLangs = useMemo(() => parseLanguageParam(subtitleKey), [subtitleKey]);
  const languageParams = useMemo(
    () => ({
      audio_lang: formatLanguageParam(audioLangs),
      subtitle_lang: formatLanguageParam(subtitleLangs),
    }),
    [audioLangs, subtitleLangs]
  );
  const [languageFacets, setLanguageFacets] = useState<LanguageFacets | null>(null);
  const [watchProgress, setWatchProgress] = useState<WatchProgress[] | null>(null);
  // Expand-only virtual mount: grow DOM prefix as focus moves, never shrink.
  const [mountedEnd, setMountedEnd] = useState(INITIAL_MOUNTED);

  const gridRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<Work[]>([]);
  const totalRef = useRef<number | null>(null);
  const requestRef = useRef<Promise<Work[]> | null>(null);
  const generationRef = useRef(0);
  const loadedKindRef = useRef(kind);
  const selectTimerRef = useRef(0);
  const pendingSelectIdRef = useRef<string | null>(null);
  const gridMetricsRef = useRef({ cols: 3, rowHeight: 180 });
  const mountedEndRef = useRef(mountedEnd);
  mountedEndRef.current = mountedEnd;
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
        ...languageParams,
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
  }, [client, kind, languageParams, order, sort]);

  useEffect(() => {
    setView(storedView(kind));
    setArtworkSize(storedArtworkSize(kind));
    setSort(storedSort(kind));
    setOrder(storedOrder(kind));
    if (previousKind.current !== kind) {
      previousKind.current = kind;
      setPanel(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const liveProgressRevision = useLiveRevision({ areas: ["progress"] });
  useEffect(() => {
    let cancelled = false;
    // A live refresh keeps the current badges until the new rows arrive.
    if (liveProgressRevision === 0) setWatchProgress(null);
    client
      .listWatchProgress()
      .then((rows) => {
        if (!cancelled) setWatchProgress(rows);
      })
      .catch(() => {
        if (!cancelled && liveProgressRevision === 0) setWatchProgress(null);
      });

    return () => {
      cancelled = true;
    };
  }, [client, liveProgressRevision]);

  // Live catalogue changes refresh the first page in place: the grid keeps its
  // items, selection and focus, and only changed works are swapped.
  const liveCatalog = useLiveSubscription({ areas: ["catalog"] });
  useEffect(
    () =>
      liveCatalog(() => {
        const generation = generationRef.current;
        client
          .browseCatalog({
            kind,
            available_only: true,
            sort,
            order,
            limit: PAGE_SIZE,
            offset: 0,
            ...languageParams,
          })
          .then((page) => {
            if (generation !== generationRef.current || itemsRef.current.length === 0) return;
            const head = orderWorks(page.items, sort, order);
            const headIds = new Set(head.map((work) => work.id));
            const tail = itemsRef.current.slice(PAGE_SIZE).filter((work) => !headIds.has(work.id));
            const merged = orderWorks([...head, ...tail], sort, order);
            const nextTotal = page.total ?? merged.length;
            if (
              nextTotal === totalRef.current &&
              JSON.stringify(merged) === JSON.stringify(itemsRef.current)
            ) {
              return;
            }
            itemsRef.current = merged;
            totalRef.current = nextTotal;
            setItems(merged);
            setTotal(nextTotal);
          })
          .catch(() => undefined);
      }),
    [client, kind, languageParams, liveCatalog, order, sort]
  );

  // Facets follow the other active filters, so only offer languages that
  // still match something. Fetched while the drawer is open.
  useEffect(() => {
    if (!filtersOpen) return;
    let cancelled = false;
    client
      .catalogLanguages({ kind, available_only: true, ...languageParams })
      .then((facets) => {
        if (!cancelled) setLanguageFacets(facets);
      })
      .catch(() => {
        if (!cancelled) setLanguageFacets(null);
      });
    return () => {
      cancelled = true;
    };
  }, [client, filtersOpen, kind, languageParams]);

  function changeLanguages(which: "audio" | "subs", next: string[]) {
    setSearchParams(
      (current) => {
        const params = new URLSearchParams(current);
        const value = formatLanguageParam(next);
        if (value) params.set(which, value);
        else params.delete(which);
        return params;
      },
      { replace: true }
    );
  }

  function clearLanguages() {
    setSearchParams(
      (current) => {
        const params = new URLSearchParams(current);
        params.delete("audio");
        params.delete("subs");
        return params;
      },
      { replace: true }
    );
  }

  function languageOptions(
    facets: LanguageFacets["audio"] | undefined,
    selected: string[]
  ): { code: string; name: string; count: number | null }[] {
    const rows = (facets ?? []).map((facet) => ({
      code: facet.code,
      name: languageDisplayName(facet.code, uiLanguage, facet.name),
      count: facet.count as number | null,
    }));
    for (const code of selected) {
      if (!rows.some((row) => row.code === code)) {
        rows.push({ code, name: languageDisplayName(code, uiLanguage), count: null });
      }
    }
    return rows;
  }

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

  const itemCount = items?.length ?? 0;
  // Expand-only: start fixed at 0 so we never remount sliding windows mid-hold.
  const renderWindow = useMemo(() => {
    if (view === "cover-flow") return { start: 0, end: itemCount };
    return {
      start: 0,
      end: Math.min(itemCount, Math.max(mountedEnd, INITIAL_MOUNTED)),
    };
  }, [itemCount, mountedEnd, view]);
  const renderWindowRef = useRef(renderWindow);
  renderWindowRef.current = renderWindow;

  // Publish grid metrics for O(1) remote title-grid nav. Columns and row pitch
  // do not change when more rows mount, so measure only when the layout can
  // change (first items, view/size change, resize) -- never per expansion,
  // which would force a full style+layout of every mounted card.
  const hasItems = itemCount > 0;
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid || view === "cover-flow" || !hasItems) return;
    const measure = () => {
      const content = grid.querySelector<HTMLElement>(".tv-title-grid-content");
      const sample = content?.querySelector<HTMLElement>(".tv-title-card");
      if (!content || !sample) return;
      const styles = window.getComputedStyle(content);
      const colCount = Math.max(
        1,
        styles.gridTemplateColumns.split(" ").filter(Boolean).length
      );
      const gap = Number.parseFloat(styles.rowGap || styles.gap || "0") || 0;
      const rowHeight = Math.max(120, sample.offsetHeight + gap);
      gridMetricsRef.current = { cols: colCount, rowHeight };
      grid.dataset.libraryCols = String(colCount);
      grid.dataset.libraryRowHeight = String(rowHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [view, artworkSize, hasItems]);

  // Grow mount prefix when remote nav leaves the mounted set.
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid || view === "cover-flow") return;
    const ensure = (index: number) => {
      const totalItems = itemsRef.current.length;
      if (index < 0 || index >= totalItems) return;
      if (libraryWindowContains(renderWindowRef.current, index)) return;
      const cols = Math.max(1, gridMetricsRef.current.cols);
      const nextEnd = libraryExpandMountedEnd(
        mountedEndRef.current,
        index,
        totalItems,
        cols,
        18
      );
      if (nextEnd <= mountedEndRef.current) return;
      flushSync(() => {
        setMountedEnd(nextEnd);
      });
    };
    (
      grid as HTMLElement & {
        __tvEnsureLibraryIndex?: (index: number) => void;
      }
    ).__tvEnsureLibraryIndex = ensure;
    return () => {
      delete (
        grid as HTMLElement & {
          __tvEnsureLibraryIndex?: (index: number) => void;
        }
      ).__tvEnsureLibraryIndex;
    };
  }, [view, kind, itemCount]);

  // Cards near the viewport get artwork; everything else (pre-mounted rows,
  // rows scrolled past) stays unloaded and unobserved. Driven by scroll position
  // at idle instead of one IntersectionObserver target per mounted card, which
  // cost a per-frame intersection pass over every card.
  const [artworkRange, setArtworkRange] = useState({ start: 0, end: 36 });
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid || view === "cover-flow" || itemCount === 0) return;
    let frame = 0;
    let cancelIdle = () => {};
    const update = () => {
      const cards = grid.querySelectorAll<HTMLElement>(".tv-title-card");
      if (cards.length === 0) return;
      const cols = Math.max(1, gridMetricsRef.current.cols);
      const gridRect = grid.getBoundingClientRect();
      let first = -1;
      let last = -1;
      for (let i = 0; i < cards.length; i += 1) {
        const rect = cards[i]!.getBoundingClientRect();
        if (rect.bottom < gridRect.top || rect.top > gridRect.bottom) continue;
        const index = Number.parseInt(cards[i]!.dataset.libraryIndex ?? "", 10);
        if (!Number.isFinite(index)) continue;
        if (first < 0) first = index;
        last = index;
      }
      if (first < 0) return;
      const start = Math.max(0, first - ARTWORK_MARGIN_ROWS * cols);
      const end = last + 1 + ARTWORK_MARGIN_ROWS * cols;
      setArtworkRange((current) =>
        current.start === start && current.end === end ? current : { start, end }
      );
    };
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        cancelIdle();
        cancelIdle = whenNavigationIdle(update);
      });
    };
    schedule();
    grid.addEventListener("scroll", schedule, { passive: true });
    return () => {
      grid.removeEventListener("scroll", schedule);
      window.cancelAnimationFrame(frame);
      cancelIdle();
    };
  }, [itemCount, view, mountedEnd]);

  // Pre-mount rows ahead of the settled selection while the user is idle, a
  // couple of rows per task with a gap between, so a later hold scrolls over
  // rows that already exist instead of mounting them on the keypress path and
  // a key pressed mid-way only ever waits for one small slice.
  useEffect(() => {
    if (view === "cover-flow" || itemCount === 0) return;
    const cols = Math.max(1, gridMetricsRef.current.cols);
    const settledIndex = selectedId
      ? Math.max(0, itemsRef.current.findIndex((work) => work.id === selectedId))
      : 0;
    const desired = Math.min(
      itemCount,
      settledIndex + (PREMOUNT_AHEAD_ROWS + 1) * cols
    );
    let cursor = mountedEndRef.current;
    if (desired <= cursor) return;
    let cancelIdle = () => {};
    let gap = 0;
    const step = () => {
      cursor = Math.min(desired, cursor + cols * PREMOUNT_SLICE_ROWS);
      const next = cursor;
      startTransition(() => setMountedEnd((current) => Math.max(current, next)));
      if (cursor < desired) {
        gap = window.setTimeout(() => {
          cancelIdle = whenNavigationIdle(step);
        }, PREMOUNT_GAP_MS);
      }
    };
    cancelIdle = whenNavigationIdle(step);
    return () => {
      cancelIdle();
      window.clearTimeout(gap);
    };
  }, [itemCount, selectedId, view]);

  // Reset mount prefix when the catalogue kind changes.
  useEffect(() => {
    setMountedEnd(INITIAL_MOUNTED);
  }, [kind]);

  useEffect(() => {
    return () => {
      window.clearTimeout(selectTimerRef.current);
    };
  }, []);

  const updateActiveLetter = useCallback(() => {
    // Alphabet chrome re-renders the filter strip — skip mid remote hold.
    if (document.body.dataset.inputMode === "remote") return;
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
        ...languageParams,
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
  }, [client, kind, languageParams, order, sort]);

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
  const itemIdsKey = useMemo(
    () => items?.map((work) => work.id).join(",") ?? "loading",
    [items]
  );
  const letters = useMemo(() => items?.map(workLetter) ?? [], [items]);
  const navigationLayer = useNavigationLayer(
    `${kind}:${view}:${artworkSize}:${sort}:${order}:${itemIdsKey}`,
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

  // Returning from a detail page restores focus to a specific title; rows are
  // mounted on demand, so mount up to it before the restore looks for it.
  useLayoutEffect(() => {
    if (!restoreWorkId || view === "cover-flow") return;
    const index = itemsRef.current.findIndex((work) => work.id === restoreWorkId);
    if (index < 0) return;
    setMountedEnd((current) => Math.max(current, index + PREMOUNT_AHEAD_ROWS * 3));
  }, [restoreWorkId, items, view]);

  async function jumpToLetter(letter: string) {
    setJumpingLetter(letter);
    try {
      const letters = order === "desc" ? [...ALPHABET].reverse() : [...ALPHABET];
      const targetPosition = letters.indexOf(letter as (typeof ALPHABET)[number]);
      // First title at or after the letter in the current sort order (a letter
      // with no titles lands on the next one that has some).
      const findIndex = () => {
        const list = itemsRef.current;
        for (let i = 0; i < list.length; i += 1) {
          const position = letters.indexOf(
            workLetter(list[i]!) as (typeof ALPHABET)[number]
          );
          if (position >= targetPosition) return i;
        }
        return -1;
      };
      let index = findIndex();
      while (
        index < 0 &&
        (totalRef.current === null || itemsRef.current.length < totalRef.current)
      ) {
        const added = await appendNextPage();
        if (added.length === 0) break;
        index = findIndex();
      }
      if (index < 0) index = itemsRef.current.length - 1;
      if (index < 0) return;

      const grid = gridRef.current as
        | (HTMLDivElement & { __tvEnsureLibraryIndex?: (index: number) => void })
        | null;
      // Rows are mounted on demand; make sure the destination exists first.
      grid?.__tvEnsureLibraryIndex?.(index);
      await afterTwoFrames();
      const destination = grid?.querySelector<HTMLElement>(
        `[data-library-index="${index}"]`
      );
      if (!grid || !destination) return;
      destination.focus({ preventScroll: true });
      // A jump can cross hundreds of unmounted rows: scroll instantly.
      grid.style.scrollBehavior = "auto";
      destination.scrollIntoView({ block: "center", inline: "nearest" });
      window.requestAnimationFrame(() => {
        grid.style.scrollBehavior = "";
      });
    } finally {
      setJumpingLetter(null);
    }
  }

  // One delegated focus handler for the whole grid keeps every card free of
  // per-render closures, so `LibraryTitleCard` can be memoised.
  const focusStateRef = useRef({ items, hasMore, view, appendNextPage });
  focusStateRef.current = { items, hasMore, view, appendNextPage };
  const handleGridFocus = useCallback((event: React.FocusEvent<HTMLElement>) => {
    const card = (event.target as Element | null)?.closest<HTMLElement>(
      ".tv-title-card"
    );
    if (!card) return;
    const index = Number.parseInt(card.dataset.libraryIndex ?? "", 10);
    const state = focusStateRef.current;
    const work = state.items?.[index];
    if (!work) return;
    const remote = document.body.dataset.inputMode === "remote";
    // Remote: debounce stage React work so holds stay lag-free.
    // Card chrome uses :focus-visible; preview settles after idle.
    pendingSelectIdRef.current = work.id;
    window.clearTimeout(selectTimerRef.current);
    selectTimerRef.current = window.setTimeout(() => {
      const id = pendingSelectIdRef.current;
      if (!id) return;
      startTransition(() => {
        setSelectedId(id);
      });
    }, remote ? 280 : 0);
    if (state.view === "cover-flow" && !isNavigationLayerRestoring()) {
      const grid = gridRef.current;
      if (grid) {
        const targetLeft =
          card.offsetLeft + card.offsetWidth / 2 - grid.clientWidth / 2;
        grid.scrollTo({
          left: Math.max(0, targetLeft),
          behavior: remote ? "auto" : "smooth",
        });
      }
    }
    if (state.items && index >= state.items.length - 12 && state.hasMore) {
      void state.appendNextPage().catch(() => undefined);
    }
  }, []);

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
      <PageHeader
        title={plural}
        backLabel={t("pages.library.backToHome")}
        detail={`${(total ?? items.length).toLocaleString()} ${collectionNoun}`}
        filters={{
          label: t("pages.library.filters"),
          open: filtersOpen,
          onToggle: () => setFiltersOpen((open) => !open),
          controls: `${kind}-library-filters`,
          activeCount: audioLangs.length + subtitleLangs.length,
        }}
      />

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
          onFocus={handleGridFocus}
          data-tv-scroll-container
          data-tv-scroll-axis={view === "cover-flow" ? "horizontal" : "vertical"}
          data-navigation-scroll-key={`library:${kind}:grid`}
          data-library-count={items.length}
          aria-busy={refreshing}
        >
          <div
            className="tv-title-grid-content"
            style={(() => {
              // Only additive bottom spacer when more rows exist off-mount.
              // Never write paddingTop: 0 — that wipes --library-rail-top.
              if (view === "cover-flow") return undefined;
              const cols = Math.max(1, gridMetricsRef.current.cols);
              const rowHeight = gridMetricsRef.current.rowHeight;
              const spacerBottom = Math.max(
                0,
                (Math.ceil(items.length / cols) -
                  Math.ceil(renderWindow.end / cols)) *
                  rowHeight
              );
              if (spacerBottom <= 0) return undefined;
              const style: CSSProperties = {
                paddingBottom: `calc(var(--library-rail-bottom) + ${spacerBottom}px)`,
              };
              return style;
            })()}
          >
            {view === "cover-flow"
              ? items.map((work, index) => {
                  const letter = letters[index] ?? workLetter(work);
                  return (
                    <LibraryTitleCard
                      key={work.id}
                      work={work}
                      index={index}
                      routeBase={routeBase}
                      kind={kind}
                      view={view}
                      imageKinds={COVER_KINDS}
                      letter={letter}
                      isSelected={work.id === selected.id}
                      coverFlowOffset={Math.max(-4, Math.min(4, index - selectedIndex))}
                      progress={progressByWork.get(work.id)}
                      showUnwatched={watchProgress !== null}
                      singular={singular}
                      navigationOrigin={navigationLayer.origin}
                      onCapture={navigationLayer.captureLink}
                      itemProps={mediaContext.itemProps}
                      artworkEnabled
                    />
                  );
                })
              : libraryChunkRanges(renderWindow.end).map(({ chunk, start, end }) => (
                  <LibraryChunk
                    key={chunk}
                    items={items}
                    start={start}
                    end={end}
                    selectedId={
                      selectedIndex >= start && selectedIndex < end ? selected.id : null
                    }
                    routeBase={routeBase}
                    kind={kind}
                    view={view}
                    progressByWork={progressByWork}
                    showUnwatched={watchProgress !== null}
                    singular={singular}
                    navigationOrigin={navigationLayer.origin}
                    onCapture={navigationLayer.captureLink}
                    itemProps={mediaContext.itemProps}
                    artworkFrom={Math.min(end, Math.max(start, artworkRange.start))}
                    artworkTo={Math.max(start, Math.min(end, artworkRange.end))}
                  />
                ))}

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

      <FiltersDrawer
        id={`${kind}-library-filters`}
        open={filtersOpen}
        kicker={t("pages.library.libraryControls")}
        title={t("pages.library.filters")}
        ariaLabel={t("pages.library.filterDrawerAriaLabel", { plural })}
        closeLabel={t("pages.library.closeFilters")}
        onClose={() => setFiltersOpen(false)}
      >
          <section>
            <h3>{t("pages.library.view")}</h3>
            <ViewToggle
              ariaLabel={t("pages.library.view")}
              value={view}
              onChange={changeView}
              options={(
                (kind === "artist"
                  ? (["list", "screen", "cover", "cover-flow"] as LibraryView[])
                  : (["list", "screen", "cover"] as LibraryView[])
                ).map((option) => ({
                  value: option,
                  icon: option,
                  label:
                    option === "cover-flow"
                      ? t("pages.library.viewCoverFlow")
                      : option === "list"
                        ? t("pages.library.viewList")
                        : option === "screen"
                          ? t("pages.library.viewScreen")
                          : t("pages.library.viewCover"),
                }))
              )}
            />
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

          {(
            [
              ["audio", t("pages.library.audioLanguage"), languageFacets?.audio, audioLangs],
              ["subs", t("pages.library.subtitleLanguage"), languageFacets?.subtitle, subtitleLangs],
            ] as const
          ).map(([which, heading, facets, selected]) => {
            const options = languageOptions(facets, [...selected]);
            return (
              <section key={which} data-language-filter={which}>
                <h3>{heading}</h3>
                {options.length === 0 ? (
                  <p>{t("pages.library.noLanguages")}</p>
                ) : (
                  <div className="tv-filter-choice-grid">
                    {options.map((option) => (
                      <button
                        key={option.code}
                        type="button"
                        className={selected.includes(option.code) ? "is-active" : ""}
                        onClick={() => changeLanguages(which, toggleLanguage(selected, option.code))}
                        aria-pressed={selected.includes(option.code)}
                      >
                        {option.count === null ? option.name : `${option.name} · ${option.count}`}
                      </button>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
          {audioLangs.length + subtitleLangs.length > 0 ? (
            <section>
              <div className="tv-filter-choice-grid">
                <button type="button" onClick={clearLanguages}>
                  {t("pages.library.clearLanguages")}
                </button>
              </div>
            </section>
          ) : null}
      </FiltersDrawer>

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

type MediaItemProps = ReturnType<typeof useMediaContextMenu>["itemProps"];

interface LibraryTitleCardProps {
  work: Work;
  index: number;
  routeBase: string;
  kind: LibraryKind;
  view: LibraryView;
  imageKinds: readonly ("poster" | "backdrop")[];
  letter: string;
  isSelected: boolean;
  coverFlowOffset: number;
  progress: WatchProgress | undefined;
  showUnwatched: boolean;
  singular: string;
  navigationOrigin: ReturnType<typeof useNavigationLayer>["origin"];
  onCapture: ReturnType<typeof useNavigationLayer>["captureLink"];
  itemProps: MediaItemProps;
  artworkEnabled: boolean;
}

const COVER_KINDS = ["poster", "backdrop"] as const;
const SCREEN_KINDS = ["backdrop", "poster"] as const;

interface LibraryChunkProps {
  items: Work[];
  start: number;
  end: number;
  /** Selected work id when it lives in this chunk, otherwise null, so a selection change re-renders at most two chunks. */
  selectedId: string | null;
  routeBase: string;
  kind: LibraryKind;
  view: LibraryView;
  progressByWork: Map<string, WatchProgress>;
  showUnwatched: boolean;
  singular: string;
  navigationOrigin: ReturnType<typeof useNavigationLayer>["origin"];
  onCapture: ReturnType<typeof useNavigationLayer>["captureLink"];
  itemProps: MediaItemProps;
  /** Cards in `[artworkFrom, artworkTo)` load artwork (already clamped to this chunk). */
  artworkFrom: number;
  artworkTo: number;
}

/**
 * A fixed-size run of library cards. Appending a catalogue page or mounting
 * more rows only renders the chunks whose items changed, so cost per keypress
 * no longer grows with how far down the list the user has travelled.
 */
const LibraryChunk = memo(
  function LibraryChunk({
    items,
    start,
    end,
    selectedId,
    routeBase,
    kind,
    view,
    progressByWork,
    showUnwatched,
    singular,
    navigationOrigin,
    onCapture,
    itemProps,
    artworkFrom,
    artworkTo,
  }: LibraryChunkProps) {
    const imageKinds = view === "cover" ? COVER_KINDS : SCREEN_KINDS;
    const cards = [];
    for (let index = start; index < end; index += 1) {
      const work = items[index]!;
      const letter = workLetter(work);
      cards.push(
        <LibraryTitleCard
          key={work.id}
          work={work}
          index={index}
          routeBase={routeBase}
          kind={kind}
          view={view}
          imageKinds={imageKinds}
          letter={letter}
          isSelected={work.id === selectedId}
          coverFlowOffset={0}
          progress={progressByWork.get(work.id)}
          showUnwatched={showUnwatched}
          singular={singular}
          navigationOrigin={navigationOrigin}
          onCapture={onCapture}
          itemProps={itemProps}
          artworkEnabled={index >= artworkFrom && index < artworkTo}
        />
      );
    }
    return <>{cards}</>;
  },
  (prev, next) =>
    sameLibraryChunkItems(prev, next) &&
    prev.selectedId === next.selectedId &&
    prev.routeBase === next.routeBase &&
    prev.kind === next.kind &&
    prev.view === next.view &&
    prev.progressByWork === next.progressByWork &&
    prev.showUnwatched === next.showUnwatched &&
    prev.singular === next.singular &&
    prev.navigationOrigin === next.navigationOrigin &&
    prev.onCapture === next.onCapture &&
    prev.itemProps === next.itemProps &&
    prev.artworkFrom === next.artworkFrom &&
    prev.artworkTo === next.artworkTo
);

/**
 * One library title. Memoised: a selection change or a newly mounted row must
 * only render the cards whose props actually changed, never the whole grid.
 */
const LibraryTitleCard = memo(function LibraryTitleCard({
  work,
  index,
  routeBase,
  kind,
  view,
  imageKinds,
  letter,
  isSelected,
  coverFlowOffset,
  progress,
  showUnwatched,
  singular,
  navigationOrigin,
  onCapture,
  itemProps,
  artworkEnabled,
}: LibraryTitleCardProps) {
  const { t } = useLanguage();
  const contextProps = itemProps({
    work,
    detailRoute: `${routeBase}/${work.id}`,
    parentRoute: routeBase,
    progress,
  });
  const linkState = useMemo(
    () => ({ backTo: routeBase, navigationOrigin }),
    [routeBase, navigationOrigin]
  );
  return (
    <Link
      to={`${routeBase}/${work.id}`}
      state={linkState}
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
      {...contextProps}
      data-library-letter={letter}
      data-library-index={index}
      data-tv-focus-default={index === 0 ? true : undefined}
      data-navigation-focus-key={`library:${kind}:${work.id}`}
      onClick={onCapture}
      aria-label={t("pages.library.openWork", { title: work.title })}
    >
      <span className="tv-title-card-art">
        <CachedArtworkImage
          work={work}
          kinds={imageKinds}
          alt=""
          loading={view === "cover-flow" ? "lazy" : undefined}
          enabled={artworkEnabled}
          decoding="async"
          fallback={<span>{work.title}</span>}
        />
        <WatchStateOverlay progress={progress} showUnwatched={showUnwatched} />
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
});

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
