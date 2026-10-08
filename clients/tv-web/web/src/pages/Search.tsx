import { smoothScrollIntoView } from "../lib/smoothScroll";
import {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Link, useOutletContext, useSearchParams } from "react-router-dom";
import {
  describeApiError,
  type PlaylistResponse,
  type ViewSummary,
  type WatchProgress,
  type Work,
  type WorkKind,
} from "@playarr-tv/api-client";
import type { AppShellOutletContext } from "../App";
import { DiscoveryExtras } from "../components/DiscoveryExtras";
import { useMediaContextMenu } from "../components/MediaContextMenu";
import {
  indexWatchProgressByWork,
  WatchStateOverlay,
} from "../components/WatchStateOverlay";
import { TvEmptyState } from "../components/tv/TvEmptyState";
import { PageLayout, ScrollArea } from "../components/shell";
import { TvRailSurface } from "../components/tv/TvStage";
import { useApiClient } from "../lib/ApiClientProvider";
import { useLiveRevision } from "../lib/liveEvents";
import { CachedArtworkImage } from "../lib/artwork";
import { labelWithYear, releaseYear } from "../lib/workYear";
import { useLanguage } from "../lib/i18n/LanguageProvider";
import type { TranslationKey } from "../lib/i18n/translations";
import { useNavigationLayer } from "../lib/navigationLayer";
import { useDocumentTitle } from "../lib/useDocumentTitle";

const SEARCH_LIMIT = 60;
const SEARCH_DEBOUNCE_MS = 320;

type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; results: SearchResult[] }
  | { status: "error"; message: string };

type SearchMediaType =
  | "all"
  | "movie"
  | "series"
  | "site"
  | "artist"
  | "playlist"
  | "game";

type SearchResult =
  | { type: "work"; id: string; work: Work }
  | { type: "playlist"; id: string; playlist: PlaylistResponse };

const SEARCH_TYPES: ReadonlyArray<{
  value: SearchMediaType;
  labelKey: TranslationKey;
  workKind?: WorkKind;
}> = [
  { value: "all", labelKey: "pages.search.all" },
  { value: "movie", labelKey: "pages.search.filterTypeMovies", workKind: "movie" },
  { value: "series", labelKey: "pages.search.filterTypeSeries", workKind: "series" },
  { value: "site", labelKey: "pages.search.filterTypeSites", workKind: "site" },
  { value: "artist", labelKey: "pages.search.filterTypeMusic", workKind: "artist" },
  { value: "playlist", labelKey: "pages.search.filterTypePlaylists" },
  { value: "game", labelKey: "pages.search.filterTypeGames" },
];

function isSupportedWork(work: Work): boolean {
  return (
    work.kind === "movie" ||
    work.kind === "series" ||
    work.kind === "site" ||
    work.kind === "artist"
  );
}

function parseMediaType(value: string | null): SearchMediaType {
  return SEARCH_TYPES.some((option) => option.value === value)
    ? (value as SearchMediaType)
    : "all";
}

function resultKey(result: SearchResult): string {
  return `${result.type}:${result.id}`;
}

function searchRoute(
  query: string,
  mediaType: SearchMediaType,
  libraryId: string | null,
  focus?: string
): string {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (mediaType !== "all") params.set("type", mediaType);
  if (libraryId) params.set("library", libraryId);
  if (focus) params.set("focus", focus);
  return `/search?${params.toString()}`;
}

function resultDetailRoute(
  query: string,
  mediaType: SearchMediaType,
  libraryId: string | null,
  workId: string,
  focus: string
): string {
  const params = new URLSearchParams({ q: query, focus });
  if (mediaType !== "all") params.set("type", mediaType);
  if (libraryId) params.set("library", libraryId);
  return `/search/${workId}?${params.toString()}`;
}

function playlistMatches(playlist: PlaylistResponse, query: string): boolean {
  return playlist.name.toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

function playlistPageTarget(
  playlist: PlaylistResponse,
  playlists: PlaylistResponse[]
): string {
  const byId = new Map(playlists.map((candidate) => [candidate.id, candidate]));
  let root = playlist;
  const visited = new Set([playlist.id]);
  while (root.parent_playlist_id) {
    if (visited.has(root.parent_playlist_id)) break;
    const parent = byId.get(root.parent_playlist_id);
    if (!parent) break;
    visited.add(parent.id);
    root = parent;
  }
  const params = new URLSearchParams({ playlist: root.id });
  if (root.id !== playlist.id) params.set("track", playlist.id);
  return `/playlists?${params.toString()}`;
}

function workMatchesType(work: Work, mediaType: SearchMediaType): boolean {
  return (
    mediaType === "all" ||
    (mediaType === "movie" && work.kind === "movie") ||
    (mediaType === "series" && work.kind === "series") ||
    (mediaType === "site" && work.kind === "site") ||
    (mediaType === "artist" && work.kind === "artist")
  );
}

function workTypeLabel(
  work: Work,
  t: ReturnType<typeof useLanguage>["t"]
): string {
  return work.kind === "series"
    ? t("pages.search.kindSeries")
    : work.kind === "site"
      ? t("pages.search.kindSite")
      : work.kind === "artist"
        ? t("pages.search.kindArtist")
        : t("pages.search.kindMovie");
}

type MediaItemProps = ReturnType<typeof useMediaContextMenu>["itemProps"];

interface SearchResultCardProps {
  result: SearchResult;
  isFirst: boolean;
  isSelected: boolean;
  requestedQuery: string;
  requestedMediaType: SearchMediaType;
  requestedLibraryId: string | null;
  requestedFocusId: string | null;
  playlists: PlaylistResponse[] | null;
  progress: WatchProgress | undefined;
  showUnwatched: boolean;
  navigationOrigin: ReturnType<typeof useNavigationLayer>["origin"];
  onCapture: ReturnType<typeof useNavigationLayer>["captureLink"];
  itemProps: MediaItemProps;
  registerRef: (key: string, element: HTMLAnchorElement | null) => void;
}

/** One search hit; memoised so a selection change renders two cards, not all. */
const SearchResultCard = memo(function SearchResultCard({
  result,
  isFirst,
  isSelected,
  requestedQuery,
  requestedMediaType,
  requestedLibraryId,
  requestedFocusId,
  playlists,
  progress,
  showUnwatched,
  navigationOrigin,
  onCapture,
  itemProps,
  registerRef,
}: SearchResultCardProps) {
  const { t } = useLanguage();
  const key = resultKey(result);
  const setRef = useCallback(
    (element: HTMLAnchorElement | null) => registerRef(key, element),
    [key, registerRef]
  );
  const backTo = searchRoute(requestedQuery, requestedMediaType, requestedLibraryId, key);
  const linkState = useMemo(
    () => ({ backTo, navigationOrigin }),
    [backTo, navigationOrigin]
  );
  const isDefaultFocus = requestedFocusId === key || (!requestedFocusId && isFirst);

  if (result.type === "playlist") {
    const playlist = result.playlist;
    return (
      <Link
        ref={setRef}
        to={playlistPageTarget(playlist, playlists ?? [])}
        state={linkState}
        className={`tv-search-result is-playlist${isSelected ? " is-selected" : ""}`}
        data-search-key={key}
        onClick={onCapture}
        data-navigation-focus-key={`search:${key}`}
        data-tv-focus-default={isDefaultFocus ? true : undefined}
      >
        <span className="tv-search-result-art tv-search-playlist-art">
          <svg viewBox="0 0 48 48" aria-hidden="true">
            <path d="M8 11h23M8 20h23M8 29h14" />
            <path d="m29 28 11 7-11 7Z" />
          </svg>
        </span>
        <span className="tv-search-result-copy">
          <strong>{playlist.name}</strong>
          <small>
            {playlist.is_system
              ? t("pages.search.systemPlaylist")
              : t("pages.search.playlist")}
          </small>
        </span>
      </Link>
    );
  }

  const work = result.work;
  const detailRoute =
    work.kind === "artist"
      ? `/music/${work.id}`
      : resultDetailRoute(requestedQuery, requestedMediaType, requestedLibraryId, work.id, key);
  const contextProps = itemProps({
    work,
    detailRoute,
    parentRoute: backTo,
    progress,
  });
  return (
    <Link
      ref={setRef}
      to={detailRoute}
      state={linkState}
      className={`tv-search-result${isSelected ? " is-selected" : ""}`}
      {...contextProps}
      data-search-key={key}
      onClick={onCapture}
      data-navigation-focus-key={`search:${key}`}
      data-tv-focus-default={isDefaultFocus ? true : undefined}
    >
      <span className="tv-search-result-art">
        <CachedArtworkImage
          work={work}
          kinds={["backdrop", "poster"]}
          alt=""
          loading="lazy"
          fallback={<span>{work.title}</span>}
        />
        <WatchStateOverlay progress={progress} showUnwatched={showUnwatched} />
      </span>
      <span className="tv-search-result-copy">
        <strong>{work.title}</strong>
        <small>{labelWithYear(workTypeLabel(work, t), work)}</small>
      </span>
    </Link>
  );
});

export function SearchPage() {
  const { t } = useLanguage();
  useDocumentTitle(t("pages.search.title"));
  const client = useApiClient();
  const { availableWorkKinds } =
    useOutletContext<AppShellOutletContext>();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedQuery = searchParams.get("q")?.trim() ?? "";
  const requestedFocusId = searchParams.get("focus");
  const requestedMediaType = parseMediaType(searchParams.get("type"));
  const requestedLibraryId = searchParams.get("library");
  const [query, setQuery] = useState(requestedQuery);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [views, setViews] = useState<ViewSummary[]>([]);
  const [playlists, setPlaylists] = useState<PlaylistResponse[] | null>(null);
  const [playlistError, setPlaylistError] = useState<string | null>(null);
  const [availableWorkIds, setAvailableWorkIds] = useState<Set<string> | null>(
    null
  );
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [state, setState] = useState<SearchState>(
    requestedQuery ? { status: "loading" } : { status: "idle" }
  );
  const [selectedId, setSelectedId] = useState<string | null>(requestedFocusId);
  const [watchProgress, setWatchProgress] = useState<WatchProgress[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const backButtonRef = useRef<HTMLAnchorElement>(null);
  const filterButtonRef = useRef<HTMLButtonElement>(null);
  const resultRefs = useRef(new Map<string, HTMLAnchorElement>());
  const requestGenerationRef = useRef(0);
  const focusResultsAfterSearchRef = useRef(false);
  const enterReleasedRef = useRef(true);
  const visibleSearchTypes = useMemo(
    () =>
      SEARCH_TYPES.filter(
        (option) =>
          !option.workKind || availableWorkKinds?.has(option.workKind)
      ),
    [availableWorkKinds]
  );

  useEffect(() => {
    setQuery(requestedQuery);
  }, [requestedQuery]);

  useEffect(() => {
    if (
      availableWorkKinds === null ||
      requestedMediaType === "all" ||
      requestedMediaType === "playlist" ||
      requestedMediaType === "game"
    ) {
      return;
    }
    const requestedType = SEARCH_TYPES.find(
      (option) => option.value === requestedMediaType
    );
    if (
      requestedType?.workKind &&
      availableWorkKinds.has(requestedType.workKind)
    ) {
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.delete("type");
    next.delete("focus");
    setSearchParams(next, { replace: true });
  }, [
    availableWorkKinds,
    requestedMediaType,
    searchParams,
    setSearchParams,
  ]);

  useEffect(() => {
    if (query.trim() === requestedQuery) return;
    const timer = window.setTimeout(() => {
      const trimmed = query.trim();
      const next = new URLSearchParams(searchParams);
      if (trimmed) next.set("q", trimmed);
      else next.delete("q");
      next.delete("focus");
      setSearchParams(next, { replace: true });
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query, requestedQuery, searchParams, setSearchParams]);

  useEffect(() => {
    let cancelled = false;
    void client
      .listViews()
      .then((rows) => {
        if (!cancelled) setViews(rows);
      })
      .catch(() => {
        if (!cancelled) setViews([]);
      });
    void client
      .listPlaylists()
      .then((rows) => {
        if (cancelled) return;
        setPlaylists(rows);
        setPlaylistError(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setPlaylists([]);
        setPlaylistError(describeApiError(error));
      });
    void (async () => {
      const ids = new Set<string>();
      let offset = 0;
      const limit = 500;
      while (true) {
        const page = await client.browseCatalog({
          available_only: true,
          limit,
          offset,
        });
        for (const work of page.items) ids.add(work.id);
        offset += page.items.length;
        if (
          page.items.length === 0 ||
          (page.total !== null && page.total !== undefined && offset >= page.total)
        ) {
          break;
        }
      }
      if (!cancelled) {
        setAvailableWorkIds(ids);
        setAvailabilityError(null);
      }
    })().catch((error: unknown) => {
      if (cancelled) return;
      setAvailableWorkIds(new Set());
      setAvailabilityError(describeApiError(error));
    });
    return () => {
      cancelled = true;
    };
  }, [client]);

  useEffect(() => {
    const generation = ++requestGenerationRef.current;
    resultRefs.current.clear();
    if (!requestedQuery) {
      setState({ status: "idle" });
      setSelectedId(null);
      return;
    }

    const includesWorks =
      requestedMediaType !== "playlist" && requestedMediaType !== "game";
    const includesPlaylists =
      !requestedLibraryId &&
      (requestedMediaType === "all" || requestedMediaType === "playlist");
    if (includesPlaylists && playlists === null) {
      setState({ status: "loading" });
      return;
    }
    if (requestedMediaType === "playlist" && playlistError) {
      setState({ status: "error", message: playlistError });
      return;
    }
    if (includesWorks && availableWorkIds === null) {
      setState({ status: "loading" });
      return;
    }
    if (includesWorks && availabilityError) {
      setState({ status: "error", message: availabilityError });
      return;
    }

    setState({ status: "loading" });
    const workRequest = includesWorks
      ? client.searchCatalog(requestedQuery, SEARCH_LIMIT)
      : Promise.resolve<Work[]>([]);
    const libraryRequest =
      includesWorks && requestedLibraryId
        ? client.resolveView(requestedLibraryId, { limit: 500 }).then((page) => page.items)
        : Promise.resolve<Work[] | null>(null);

    void Promise.all([workRequest, libraryRequest])
      .then(([workResults, libraryWorks]) => {
        if (requestGenerationRef.current !== generation) return;
        const libraryWorkIds = libraryWorks
          ? new Set(libraryWorks.map((work) => work.id))
          : null;
        const resultRows: SearchResult[] = workResults
          .filter(isSupportedWork)
          .filter((work) => availableWorkIds?.has(work.id))
          .filter((work) => workMatchesType(work, requestedMediaType))
          .filter((work) => !libraryWorkIds || libraryWorkIds.has(work.id))
          .map((work) => ({ type: "work" as const, id: work.id, work }));
        if (includesPlaylists) {
          resultRows.push(
            ...(playlists ?? [])
              .filter((playlist) => playlistMatches(playlist, requestedQuery))
              .map((playlist) => ({
                type: "playlist" as const,
                id: playlist.id,
                playlist,
              }))
          );
        }
        setState({ status: "ready", results: resultRows });
        setSelectedId((current) => {
          if (current && resultRows.some((result) => resultKey(result) === current)) {
            return current;
          }
          if (
            requestedFocusId &&
            resultRows.some((result) => resultKey(result) === requestedFocusId)
          ) {
            return requestedFocusId;
          }
          return resultRows[0] ? resultKey(resultRows[0]) : null;
        });
        if (
          focusResultsAfterSearchRef.current &&
          enterReleasedRef.current &&
          resultRows[0]
        ) {
          focusResultsAfterSearchRef.current = false;
          const firstKey = resultKey(resultRows[0]);
          window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
              resultRefs.current.get(firstKey)?.focus({ preventScroll: true });
            });
          });
        } else if (focusResultsAfterSearchRef.current && resultRows.length === 0) {
          focusResultsAfterSearchRef.current = false;
        }
      })
      .catch((error: unknown) => {
        if (requestGenerationRef.current !== generation) return;
        focusResultsAfterSearchRef.current = false;
        setState({ status: "error", message: describeApiError(error) });
      });
  }, [
    client,
    availabilityError,
    availableWorkIds,
    playlistError,
    playlists,
    requestedFocusId,
    requestedLibraryId,
    requestedMediaType,
    requestedQuery,
  ]);

  const liveProgressRevision = useLiveRevision({ areas: ["progress"] });
  useEffect(() => {
    let cancelled = false;
    void client
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

  const results = state.status === "ready" ? state.results : [];
  const selected = useMemo(
    () => results.find((result) => resultKey(result) === selectedId) ?? results[0] ?? null,
    [results, selectedId]
  );
  const progressByWork = useMemo(
    () => indexWatchProgressByWork(watchProgress ?? []),
    [watchProgress]
  );
  const handleProgressChanged = useCallback(
    (_workId: string, updated: WatchProgress[]) => {
      const updatedIds = new Set(updated.map((progress) => progress.media_file_id));
      setWatchProgress((current) => [
        ...(current ?? []).filter((progress) => !updatedIds.has(progress.media_file_id)),
        ...updated,
      ]);
    },
    []
  );
  const mediaContext = useMediaContextMenu({
    onProgressChanged: handleProgressChanged,
  });
  const navigationLayer = useNavigationLayer(
    `${requestedQuery}:${requestedMediaType}:${requestedLibraryId ?? "all"}:${
      results.map(resultKey).join(",") || state.status
    }`,
    true
  );

  useEffect(() => {
    if (
      state.status !== "ready" ||
      !requestedFocusId ||
      navigationLayer.hasSnapshot
    ) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const result = resultRefs.current.get(requestedFocusId);
        result?.focus({ preventScroll: true });
        if (result) smoothScrollIntoView(result, { block: "center" });
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [navigationLayer.hasSnapshot, requestedFocusId, state]);

  const activeLibrary = useMemo(
    () => views.find((view) => view.id === requestedLibraryId) ?? null,
    [requestedLibraryId, views]
  );

  function updateFilters(next: {
    mediaType?: SearchMediaType;
    libraryId?: string | null;
  }) {
    const params = new URLSearchParams(searchParams);
    let mediaType = next.mediaType ?? requestedMediaType;
    let libraryId =
      next.libraryId === undefined ? requestedLibraryId : next.libraryId;
    if (next.libraryId && requestedMediaType === "playlist") {
      mediaType = "all";
    }
    if (mediaType === "playlist") libraryId = null;
    if (mediaType === "all") params.delete("type");
    else params.set("type", mediaType);
    if (libraryId) params.set("library", libraryId);
    else params.delete("library");
    params.delete("focus");
    setSearchParams(params, { replace: true });
  }

  function clearSearch() {
    setQuery("");
    const next = new URLSearchParams(searchParams);
    next.delete("q");
    next.delete("focus");
    setSearchParams(next, { replace: true });
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const isEnter =
      event.key === "Enter" ||
      event.key === "Go" ||
      event.keyCode === 13;
    if (isEnter) {
      event.preventDefault();
      event.stopPropagation();
      enterReleasedRef.current = false;
      const trimmed = query.trim();
      focusResultsAfterSearchRef.current = Boolean(trimmed);
      const next = new URLSearchParams(searchParams);
      if (trimmed) next.set("q", trimmed);
      else next.delete("q");
      next.delete("focus");
      if (trimmed === requestedQuery) {
        return;
      } else {
        setSearchParams(next, { replace: true });
      }
      return;
    }
    if (event.key !== "ArrowDown") return;
    event.preventDefault();
    event.stopPropagation();
    filterButtonRef.current?.focus({ preventScroll: true });
  }

  function handleClearKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowDown") return;
    event.preventDefault();
    event.stopPropagation();
    filterButtonRef.current?.focus({ preventScroll: true });
  }

  function handleBackKeyDown(event: KeyboardEvent<HTMLAnchorElement>) {
    if (event.key !== "ArrowDown") return;
    event.preventDefault();
    event.stopPropagation();
    inputRef.current?.focus({ preventScroll: true });
  }

  function handleFilterKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowUp") return;
    event.preventDefault();
    event.stopPropagation();
    inputRef.current?.focus({ preventScroll: true });
  }

  function handleInputKeyUp(event: KeyboardEvent<HTMLInputElement>) {
    const isEnter =
      event.key === "Enter" ||
      event.key === "Go" ||
      event.keyCode === 13;
    if (!isEnter) return;
    event.preventDefault();
    event.stopPropagation();
    enterReleasedRef.current = true;
    if (query.trim() !== requestedQuery) return;
    if (!focusResultsAfterSearchRef.current || !results[0]) return;
    focusResultsAfterSearchRef.current = false;
    const firstKey = resultKey(results[0]);
    window.requestAnimationFrame(() => {
      resultRefs.current.get(firstKey)?.focus({ preventScroll: true });
    });
  }

  const registerResultRef = useCallback(
    (key: string, element: HTMLAnchorElement | null) => {
      if (element) resultRefs.current.set(key, element);
      else resultRefs.current.delete(key);
    },
    []
  );

  // Delegated focus: one handler for the grid, selection debounced under a
  // remote hold so the preview/stage re-render never runs per key.
  const selectTimerRef = useRef(0);
  const handleResultsFocus = useCallback((event: React.FocusEvent<HTMLElement>) => {
    const card = (event.target as Element | null)?.closest<HTMLElement>(
      "[data-search-key]"
    );
    const key = card?.dataset.searchKey;
    if (!key) return;
    window.clearTimeout(selectTimerRef.current);
    const remote = document.body.dataset.inputMode === "remote";
    selectTimerRef.current = window.setTimeout(() => {
      startTransition(() => setSelectedId(key));
    }, remote ? 280 : 0);
  }, []);
  useEffect(() => () => window.clearTimeout(selectTimerRef.current), []);

  const selectedWork = selected?.type === "work" ? selected.work : null;
  const selectedPlaylist =
    selected?.type === "playlist" ? selected.playlist : null;

  return (
    <PageLayout
      pageId="search"
      className="tv-search"
      ariaLabel={t("pages.search.ariaSearchPlayarr")}
      backdrop={{
        artKey: selectedWork?.id,
        art: selectedWork ? (
          <CachedArtworkImage
            work={selectedWork}
            kinds={["backdrop", "poster"]}
            alt=""
            fallback={<span>{selectedWork.title}</span>}
          />
        ) : undefined,
      }}
      header={{
        title: t("pages.search.title"),
        back: { label: t("pages.search.backToHome"), to: "/" },
        backRef: backButtonRef,
        backProps: { onKeyDown: handleBackKeyDown },
        detail: requestedQuery
          ? state.status === "ready"
            ? t(
                results.length === 1
                  ? "pages.search.resultCountOne"
                  : "pages.search.resultCountOther",
                { count: results.length.toLocaleString() }
              )
            : state.status === "loading"
              ? t("pages.search.searching")
              : t("pages.search.zeroResults")
          : null,
      }}
    >
      <div className="tv-search-copy">
        <div className="tv-search-form" role="search">
          <span className="tv-search-input-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <circle cx="10.5" cy="10.5" r="6.5" />
              <path d="m15.5 15.5 4.5 4.5" />
            </svg>
          </span>
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => {
              focusResultsAfterSearchRef.current = false;
              setQuery(event.target.value);
            }}
            onKeyDown={handleInputKeyDown}
            onKeyUp={handleInputKeyUp}
            placeholder={t("pages.search.searchPlaceholder")}
            autoComplete="off"
            aria-label={t("pages.search.searchPlaceholder")}
            data-tv-focus-default={
              !navigationLayer.hasSnapshot &&
              !requestedFocusId &&
              state.status !== "loading" &&
              results.length === 0
                ? true
                : undefined
            }
          />
          {query ? (
            <button
              type="button"
              className="tv-search-clear"
              onClick={clearSearch}
              onKeyDown={handleClearKeyDown}
            >
              {t("pages.search.clear")}
            </button>
          ) : null}
        </div>

        <div className="tv-search-filter-control">
          <button
            ref={filterButtonRef}
            type="button"
            className={`tv-search-filter-toggle${filtersOpen ? " is-open" : ""}`}
            aria-expanded={filtersOpen}
            aria-controls="search-filters"
            onClick={() => setFiltersOpen((current) => !current)}
            onKeyDown={handleFilterKeyDown}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M7 14v6" />
            </svg>
            <span>{t("pages.search.filters")}</span>
            <small>
              {t(
                visibleSearchTypes.find(
                  (option) => option.value === requestedMediaType
                )?.labelKey ?? "pages.search.all"
              )}
              {activeLibrary
                ? t("pages.search.libraryFilterNamed", { name: activeLibrary.name })
                : t("pages.search.libraryFilterAll")}
            </small>
          </button>

          <div
            id="search-filters"
            className={`tv-search-filters${filtersOpen ? " is-open" : ""}`}
            aria-hidden={!filtersOpen}
          >
            <div
              className="tv-search-filter-row"
              aria-label={t("pages.search.filterByType")}
            >
              <p>{t("pages.search.typeLabel")}</p>
              <div>
                {visibleSearchTypes.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={requestedMediaType === option.value ? "is-active" : ""}
                    aria-pressed={requestedMediaType === option.value}
                    tabIndex={filtersOpen ? 0 : -1}
                    onClick={() => updateFilters({ mediaType: option.value })}
                  >
                    {t(option.labelKey)}
                  </button>
                ))}
              </div>
            </div>

            <div
              className="tv-search-filter-row"
              aria-label={t("pages.search.filterByLibrary")}
            >
              <p>{t("pages.search.libraryLabel")}</p>
              <div>
                <button
                  type="button"
                  className={!requestedLibraryId ? "is-active" : ""}
                  aria-pressed={!requestedLibraryId}
                  tabIndex={filtersOpen ? 0 : -1}
                  onClick={() => updateFilters({ libraryId: null })}
                >
                  {t("pages.search.all")}
                </button>
                {views.map((view) => (
                  <button
                    key={view.id}
                    type="button"
                    className={requestedLibraryId === view.id ? "is-active" : ""}
                    aria-pressed={requestedLibraryId === view.id}
                    tabIndex={filtersOpen ? 0 : -1}
                    onClick={() => updateFilters({ libraryId: view.id })}
                  >
                    {view.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {selectedWork ? (
          <aside className="tv-search-preview" key={`search-preview-${selectedWork.id}`}>
            <p>{labelWithYear(workTypeLabel(selectedWork, t), selectedWork)}</p>
            <h2>{selectedWork.title}</h2>
            <div>
              {releaseYear(selectedWork) !== null ? <span>{releaseYear(selectedWork)}</span> : null}
              <span>
                {selectedWork.genres.slice(0, 2).join(" · ") ||
                  t("pages.search.availableToPlay")}
              </span>
            </div>
            <p>{selectedWork.overview ?? t("pages.search.noSynopsis")}</p>
          </aside>
        ) : selectedPlaylist ? (
          <aside
            className="tv-search-preview is-playlist"
            key={`search-preview-playlist-${selectedPlaylist.id}`}
          >
            <p>
              {selectedPlaylist.is_system
                ? t("pages.search.systemPlaylist")
                : t("pages.search.playlist")}
            </p>
            <h2>{selectedPlaylist.name}</h2>
          </aside>
        ) : (
          <p className="tv-search-prompt">
            {requestedQuery
              ? t("pages.search.choosePrompt")
              : t("pages.search.emptyPrompt")}
          </p>
        )}
      </div>

      <TvRailSurface
        mode="content"
        ariaLabel={t("pages.search.resultsAriaLabel")}
        className="tv-search-rail-surface"
      >
        <ScrollArea
          axis="vertical"
          scrollKey="search:results"
          className="tv-search-results tv-search-rail-scroll"
          refreshKey={`${requestedQuery}:${requestedMediaType}:${requestedLibraryId ?? "all"}:${
            state.status === "ready" ? state.results.length : 0
          }`}
          viewportProps={{ "aria-live": "polite", "aria-busy": state.status === "loading" }}
        >
          {state.status === "loading" ? (
            <div className="tv-search-state" role="status">
              <span className="tv-mini-loader" aria-hidden="true" />
              <p>{t("pages.search.loadingEllipsis")}</p>
            </div>
          ) : state.status === "error" ? (
            <TvEmptyState
              announce={false}
              graphic="search"
              tone="error"
              variant="rail"
              title={t("pages.search.errorTitle")}
              description={state.message}
            />
          ) : state.status === "idle" ? (
            <TvEmptyState
              announce={false}
              graphic="search"
              title={t("pages.search.idleTitle")}
              variant="rail"
            />
          ) : results.length === 0 && requestedMediaType === "game" ? null : results.length === 0 ? (
            <TvEmptyState
              announce={false}
              graphic="search"
              title={t("pages.search.noResultsTitle")}
              description={t("pages.search.noResultsDescription")}
              variant="rail"
            />
          ) : (
            <div
              className="tv-search-results-grid tv-search-rail-grid"
              onFocus={handleResultsFocus}
              data-tv-grid
              data-tv-grid-edge-left=".tv-search input"
            >
              {results.map((result, index) => (
                <SearchResultCard
                  key={resultKey(result)}
                  result={result}
                  isFirst={index === 0}
                  isSelected={selectedId === resultKey(result)}
                  requestedQuery={requestedQuery}
                  requestedMediaType={requestedMediaType}
                  requestedLibraryId={requestedLibraryId}
                  requestedFocusId={requestedFocusId}
                  playlists={playlists}
                  progress={
                    result.type === "work" ? progressByWork.get(result.work.id) : undefined
                  }
                  showUnwatched={watchProgress !== null}
                  navigationOrigin={navigationLayer.origin}
                  onCapture={navigationLayer.captureLink}
                  itemProps={mediaContext.itemProps}
                  registerRef={registerResultRef}
                />
              ))}
            </div>
          )}
          {state.status === "ready" &&
          (requestedMediaType === "game" ||
            (!requestedLibraryId &&
              (requestedMediaType === "all" ||
                requestedMediaType === "movie" ||
                requestedMediaType === "series"))) ? (
            <DiscoveryExtras
              query={requestedQuery}
              gamesOnly={requestedMediaType === "game"}
            />
          ) : null}
        </ScrollArea>
      </TvRailSurface>

      {mediaContext.contextMenu}
    </PageLayout>
  );
}
