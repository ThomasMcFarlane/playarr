import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  describeApiError,
  type FolderBrowseResponse,
  type FolderEntry,
  type FolderRoot,
} from "@playarr-tv/api-client";
import { MediaThumbnailArtwork } from "../components/MediaThumbnailArtwork";
import { Button } from "../components/ui";
import { EmptyState, ErrorState, FilterSection, FiltersDrawer, LoadingState, PageLayout, ScrollArea, ViewToggle } from "../components/shell";
import { useApiClient } from "../lib/ApiClientProvider";
import { formatBytes } from "../lib/formatBytes";
import {
  activeFolderFilterCount,
  applyFolderUrl,
  folderAncestors,
  folderPlaybackQueue,
  folderProgress,
  formatFolderDuration,
  parentFolderPath,
  parseFolderUrl,
  type FolderUrlState,
} from "../lib/folderView";
import { useLiveSubscription } from "../lib/liveEvents";
import { useLanguage } from "../lib/i18n/LanguageProvider";
import type { TranslationKey } from "../lib/i18n/translations";
import { captureNavigationLayer } from "../lib/navigationLayer";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import { usePanelParam } from "../lib/usePanelParam";
import "./Folders.css";

const PAGE_SIZE = 200;
const SEARCH_DEBOUNCE_MS = 250;

type RootsState =
  | { status: "loading" }
  | { status: "ready"; roots: FolderRoot[] }
  | { status: "error"; message: string };

type ListingState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: FolderBrowseResponse; entries: FolderEntry[] }
  | { status: "missing" }
  | { status: "error"; message: string };

function errorStatus(error: unknown): number | null {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: unknown }).status;
    return typeof status === "number" ? status : null;
  }
  return null;
}

function FolderGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="folders-glyph">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

function FileGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="folders-glyph">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

/**
 * Folders library view: browse the root folders an administrator enabled as a
 * directory tree, play and resume files. All state that defines what is on
 * screen (root, path, view, size, sort, order, search, type) lives in the URL
 * (`lib/folderView.ts`), so refresh, back/forward and deep links restore it.
 */
export function FoldersPage() {
  const { t } = useLanguage();
  const client = useApiClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const url = useMemo(() => parseFolderUrl(params), [params]);
  const [panel, setPanel] = usePanelParam(["filters"] as const);
  useDocumentTitle(t("pages.folders.title"));

  const [rootsState, setRootsState] = useState<RootsState>({ status: "loading" });
  const [listing, setListing] = useState<ListingState>({ status: "idle" });
  const [loadingMore, setLoadingMore] = useState(false);
  const [revision, setRevision] = useState(0);
  const openerRef = useRef<HTMLElement | null>(null);

  const liveCatalog = useLiveSubscription({ areas: ["catalog", "progress", "account"] });
  useEffect(() => liveCatalog(() => setRevision((value) => value + 1)), [liveCatalog]);

  const update = useCallback(
    (patch: Partial<FolderUrlState>, options: { replace?: boolean } = {}) => {
      setParams((current) => applyFolderUrl(current, patch), { replace: options.replace ?? false });
    },
    [setParams]
  );

  // Roots the caller may browse (optionally for one library kind).
  useEffect(() => {
    let cancelled = false;
    void client
      .listFolderRoots(url.kind ?? undefined)
      .then((roots) => {
        if (!cancelled) setRootsState({ status: "ready", roots });
      })
      .catch((error: unknown) => {
        if (!cancelled) setRootsState({ status: "error", message: describeApiError(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [client, url.kind, revision]);

  const roots = rootsState.status === "ready" ? rootsState.roots : null;
  const currentRoot = roots?.find((root) => root.id === url.root) ?? null;

  // With exactly one root there is nothing to choose: open it.
  useEffect(() => {
    if (roots && roots.length === 1 && url.root === null) update({ root: roots[0]!.id }, { replace: true });
  }, [roots, url.root, update]);

  // One directory level of the open root.
  useEffect(() => {
    if (!currentRoot) {
      setListing({ status: "idle" });
      return;
    }
    let cancelled = false;
    setListing((previous) => (previous.status === "ready" ? previous : { status: "loading" }));
    void client
      .browseFolder(currentRoot.id, {
        path: url.path,
        q: url.q,
        sort: url.sort,
        order: url.order,
        type: url.type,
        limit: PAGE_SIZE,
      })
      .then((data) => {
        if (!cancelled) setListing({ status: "ready", data, entries: data.entries });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (errorStatus(error) === 404) setListing({ status: "missing" });
        else setListing({ status: "error", message: describeApiError(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [client, currentRoot?.id, url.path, url.q, url.sort, url.order, url.type, revision]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadMore() {
    if (listing.status !== "ready" || !currentRoot || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await client.browseFolder(currentRoot.id, {
        path: url.path,
        q: url.q,
        sort: url.sort,
        order: url.order,
        type: url.type,
        limit: PAGE_SIZE,
        offset: listing.entries.length,
      });
      setListing((previous) =>
        previous.status === "ready"
          ? { status: "ready", data: next, entries: [...previous.entries, ...next.entries] }
          : previous
      );
    } catch (error: unknown) {
      setListing({ status: "error", message: describeApiError(error) });
    } finally {
      setLoadingMore(false);
    }
  }

  // Search text is local until it settles, so typing never reloads per key.
  const [searchText, setSearchText] = useState(url.q);
  useEffect(() => setSearchText(url.q), [url.q]);
  useEffect(() => {
    if (searchText.trim() === url.q) return;
    const timer = window.setTimeout(() => update({ q: searchText }, { replace: true }), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchText, url.q, update]);

  function openDirectory(path: string) {
    update({ path });
  }

  function play(entry: FolderEntry, element: HTMLElement | null) {
    if (!entry.media_file_id || listing.status !== "ready") return;
    const queue = folderPlaybackQueue(listing.entries);
    const origin = captureNavigationLayer(location.pathname, location.key, element ?? openerRef.current);
    navigate(`/player/${entry.media_file_id}`, {
      state: {
        title: entry.title || entry.name,
        backTo: `/folders${location.search}`,
        navigationOrigin: origin,
        mediaFileId: entry.media_file_id,
        playlistItems: queue.length > 1 ? queue : undefined,
      },
    });
  }

  function goBack() {
    if (url.root && url.path) {
      update({ path: parentFolderPath(url.path) });
    } else if (url.root && roots && roots.length > 1) {
      update({ root: null });
    } else {
      navigate(url.kind ? kindRoute(url.kind) : "/");
    }
  }

  const filterCount = activeFolderFilterCount(url);
  const sizeClass = `is-size-${url.size}`;
  const rootName = currentRoot?.name ?? null;
  const detail = rootName ?? (roots && roots.length > 1 ? t("pages.folders.chooseRoot") : null);

  return (
    <PageLayout
      pageId="folders"
      body="bleed"
      className={`folders-page folders-view-${url.view} ${sizeClass}`}
      ariaLabel={t("pages.folders.title")}
      header={{
        title: t("pages.folders.title"),
        detail: detail ?? undefined,
        back: {
          label: url.root && url.path ? t("pages.folders.backToParent") : t("pages.folders.backToHome"),
          onBack: goBack,
        },
        actions: currentRoot
          ? [
              {
                kind: "filters",
                label: t("pages.folders.filters"),
                open: panel === "filters",
                onToggle: () => setPanel(panel === "filters" ? null : "filters"),
                controls: "folders-filters-drawer",
                activeCount: filterCount,
              },
            ]
          : [],
      }}
      state={
        rootsState.status === "loading"
          ? { kind: "loading", label: t("pages.folders.loading") }
          : rootsState.status === "error"
            ? { kind: "error", props: { graphic: "details", title: t("pages.folders.errorTitle"), description: rootsState.message } }
            : rootsState.roots.length === 0
              ? {
                  kind: "empty",
                  props: { graphic: "details", title: t("pages.folders.noRootsTitle"), description: t("pages.folders.noRootsDescription") },
                }
              : undefined
      }
    >
      {!currentRoot ? (
        <RootChooser roots={rootsState.status === "ready" ? rootsState.roots : []} t={t} onChoose={(id) => update({ root: id })} />
      ) : (
        <>
          <nav className="folders-breadcrumbs" aria-label={t("pages.folders.breadcrumbs")}>
            <Button
              variant="ghost"
              size="sm"
              className="folders-crumb"
              aria-current={url.path === "" ? "page" : undefined}
              onClick={() => openDirectory("")}
            >
              {currentRoot.name}
            </Button>
            {folderAncestors(url.path).map((path) => (
              <span className="folders-crumb-item" key={path}>
                <span className="folders-crumb-sep" aria-hidden="true">
                  /
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="folders-crumb"
                  aria-current={path === url.path ? "page" : undefined}
                  onClick={() => openDirectory(path)}
                >
                  {path.split("/").pop()}
                </Button>
              </span>
            ))}
            {listing.status === "ready" ? (
              <span className="folders-count" role="status">
                {listing.entries.length < listing.data.total
                  ? t("pages.folders.shown", { shown: listing.entries.length, total: listing.data.total })
                  : t("pages.folders.items", { count: listing.data.total })}
              </span>
            ) : null}
          </nav>
          <ScrollArea
            axis="vertical"
            scrollKey="folders:body"
            className="folders-scroll"
            refreshKey={listing.status === "ready" ? `${listing.entries.length}:${url.view}` : listing.status}
          >
            {listing.status === "loading" || listing.status === "idle" ? (
              <LoadingState size="inline" label={t("pages.folders.loading")} />
            ) : listing.status === "error" ? (
              <ErrorState graphic="details" title={t("pages.folders.errorTitle")} description={listing.message} />
            ) : listing.status === "missing" ? (
              <>
                <EmptyState
                  graphic="details"
                  title={t("pages.folders.notFoundTitle")}
                  description={t("pages.folders.notFoundDescription")}
                />
                <div className="folders-more">
                  <Button variant="primary" onClick={() => openDirectory(parentFolderPath(url.path))}>
                    {t("pages.folders.backToParent")}
                  </Button>
                </div>
              </>
            ) : listing.entries.length === 0 ? (
              <EmptyState
                graphic="details"
                title={filterCount > 0 ? t("pages.folders.noMatchTitle") : t("pages.folders.emptyTitle")}
                description={filterCount > 0 ? t("pages.folders.noMatchDescription") : t("pages.folders.emptyDescription")}
              />
            ) : (
              <>
                <ul className={`folders-list ${url.view === "list" ? "folders-rows" : "folders-cover"}`} role="list">
                  {listing.entries.map((entry) => (
                    <li key={`${entry.entry_type}:${entry.path}`}>
                      <EntryCard
                        entry={entry}
                        view={url.view}
                        t={t}
                        onOpen={(element) =>
                          entry.entry_type === "directory" ? openDirectory(entry.path) : play(entry, element)
                        }
                      />
                    </li>
                  ))}
                </ul>
                {listing.entries.length < listing.data.total ? (
                  <div className="folders-more">
                    <Button variant="secondary" disabled={loadingMore} onClick={() => void loadMore()}>
                      {t("pages.folders.loadMore")}
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </ScrollArea>
        </>
      )}

      <FiltersDrawer
        id="folders-filters-drawer"
        open={panel === "filters" && currentRoot !== null}
        kicker={t("pages.folders.title")}
        title={t("pages.folders.filters")}
        closeLabel={t("pages.folders.closeFilters")}
        onClose={() => setPanel(null)}
        footer={
          filterCount > 0 ? (
            <Button variant="secondary" onClick={() => update({ q: "", type: "all" }, { replace: true })}>
              {t("pages.folders.clearFilters")}
            </Button>
          ) : undefined
        }
      >
        <FilterSection title={t("pages.folders.search")}>
          <input
            type="search"
            className="folders-search"
            value={searchText}
            placeholder={t("pages.folders.searchPlaceholder")}
            aria-label={t("pages.folders.search")}
            onChange={(event) => setSearchText(event.target.value)}
          />
        </FilterSection>
        <FilterSection title={t("pages.folders.show")}>
          <ChoiceGroup
            ariaLabel={t("pages.folders.show")}
            value={url.type}
            options={[
              { value: "all", label: t("pages.folders.typeAll") },
              { value: "directories", label: t("pages.folders.typeDirectories") },
              { value: "media", label: t("pages.folders.typeMedia") },
            ]}
            onChange={(type) => update({ type }, { replace: true })}
          />
        </FilterSection>
        <FilterSection title={t("pages.folders.view")}>
          <ViewToggle
            ariaLabel={t("pages.folders.view")}
            value={url.view}
            options={[
              { value: "cover", label: t("pages.folders.viewCover"), icon: "cover" },
              { value: "list", label: t("pages.folders.viewList"), icon: "list" },
            ]}
            onChange={(view) => update({ view }, { replace: true })}
          />
        </FilterSection>
        {url.view === "cover" ? (
          <FilterSection title={t("pages.folders.size")}>
            <ChoiceGroup
              ariaLabel={t("pages.folders.size")}
              value={url.size}
              options={[
                { value: "small", label: t("pages.folders.sizeSmall") },
                { value: "medium", label: t("pages.folders.sizeMedium") },
                { value: "large", label: t("pages.folders.sizeLarge") },
              ]}
              onChange={(size) => update({ size }, { replace: true })}
            />
          </FilterSection>
        ) : null}
        <FilterSection title={t("pages.folders.sortBy")}>
          <ChoiceGroup
            ariaLabel={t("pages.folders.sortBy")}
            value={url.sort}
            options={[
              { value: "name", label: t("pages.folders.sortName") },
              { value: "modified", label: t("pages.folders.sortModified") },
              { value: "size", label: t("pages.folders.sortSize") },
              { value: "duration", label: t("pages.folders.sortDuration") },
            ]}
            onChange={(sort) => update({ sort }, { replace: true })}
          />
        </FilterSection>
        <FilterSection title={t("pages.folders.order")}>
          <ChoiceGroup
            ariaLabel={t("pages.folders.order")}
            value={url.order}
            options={[
              { value: "asc", label: t("pages.folders.orderAsc") },
              { value: "desc", label: t("pages.folders.orderDesc") },
            ]}
            onChange={(order) => update({ order }, { replace: true })}
          />
        </FilterSection>
      </FiltersDrawer>
    </PageLayout>
  );
}

function kindRoute(kind: FolderUrlState["kind"]): string {
  switch (kind) {
    case "movie":
      return "/movies";
    case "series":
      return "/series";
    case "site":
      return "/sites";
    case "artist":
    case "author":
      return "/music";
    default:
      return "/";
  }
}

function ChoiceGroup<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="tv-filter-choice-grid" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={value === option.value ? "is-active" : ""}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function RootChooser({
  roots,
  t,
  onChoose,
}: {
  roots: FolderRoot[];
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  onChoose: (id: string) => void;
}) {
  return (
    <ScrollArea axis="vertical" scrollKey="folders:roots" className="folders-scroll" refreshKey={roots.length}>
      <ul className="folders-list folders-cover" role="list" aria-label={t("pages.folders.sources")}>
        {roots.map((root) => (
          <li key={root.id}>
            <button type="button" className="folders-card is-directory" onClick={() => onChoose(root.id)} data-navigation-focus-key={`folders:root:${root.id}`}>
              <span className="folders-thumb">
                <FolderGlyph />
              </span>
              <span className="folders-card-text">
                <strong className="folders-name">{root.name}</strong>
                <span className="folders-meta">
                  {root.source_name} ·{" "}
                  {root.available
                    ? t("pages.folders.rootItems", { count: root.item_count })
                    : root.scan_status === "scanning"
                      ? t("pages.folders.rootScanning")
                      : t("pages.folders.rootUnavailable")}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </ScrollArea>
  );
}

export function EntryCard({
  entry,
  view,
  t,
  onOpen,
}: {
  entry: FolderEntry;
  view: FolderUrlState["view"];
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  onOpen: (element: HTMLElement | null) => void;
}) {
  const isDirectory = entry.entry_type === "directory";
  const name = isDirectory ? entry.name : entry.title || entry.name;
  const progress = folderProgress(entry);
  const resumable = !isDirectory && entry.watch_state === "part_watched";
  const watched = !isDirectory && entry.watch_state === "watched";
  const meta = isDirectory
    ? t("pages.folders.items", { count: entry.item_count ?? 0 })
    : [
        formatFolderDuration(entry.duration_ms),
        entry.height ? `${entry.height}p` : "",
        entry.artist ?? "",
        formatBytes(entry.size_bytes),
      ]
        .filter((part) => part && part !== "--")
        .join(" · ");
  const label = isDirectory
    ? t("pages.folders.openFolder", { name })
    : resumable
      ? t("pages.folders.resumeItem", { name })
      : t("pages.folders.playItem", { name });
  const thumbPosition = thumbnailPosition(entry.thumbnail_url);

  return (
    <button
      type="button"
      className={`folders-card ${isDirectory ? "is-directory" : "is-media"}${watched ? " is-watched" : ""}`}
      aria-label={label}
      data-navigation-focus-key={`folders:${entry.entry_type}:${entry.path}`}
      onClick={(event) => onOpen(event.currentTarget)}
    >
      <span className="folders-thumb">
        {isDirectory ? (
          <FolderGlyph />
        ) : entry.media_file_id && entry.thumbnail_url && view === "cover" ? (
          <MediaThumbnailArtwork
            mediaFileId={entry.media_file_id}
            fallback={null}
            className="folders-thumb-image"
            positionMs={thumbPosition}
            intersectionRootSelector=".folders-scroll"
          />
        ) : (
          <FileGlyph />
        )}
        {progress > 0 ? (
          <span className="folders-progress" aria-hidden="true">
            <i style={{ width: `${Math.round(progress * 100)}%` }} />
          </span>
        ) : null}
      </span>
      <span className="folders-card-text">
        <strong className="folders-name">{name}</strong>
        <span className="folders-meta">{meta}</span>
        {resumable ? <span className="folders-badge">{t("pages.folders.resume")}</span> : null}
        {watched ? <span className="folders-badge is-quiet">{t("pages.folders.watched")}</span> : null}
      </span>
    </button>
  );
}

/** The frame position the server chose for this entry's thumbnail (`?position_ms=`). */
function thumbnailPosition(thumbnailUrl: string | null | undefined): number | undefined {
  if (!thumbnailUrl) return undefined;
  const match = /[?&]position_ms=(\d+)/.exec(thumbnailUrl);
  return match ? Number(match[1]) : undefined;
}
