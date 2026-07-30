import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  describeApiError,
  type FolderBrowseResponse,
  type FolderEntry,
  type FolderRoot,
  type FolderRootError,
  type WorkKind,
} from "@playarr-tv/api-client";
import { MediaThumbnailArtwork } from "../components/MediaThumbnailArtwork";
import { TvEmptyState } from "../components/tv/TvEmptyState";
import { TvStageShell } from "../components/tv/TvStage";
import { useApiClient } from "../lib/ApiClientProvider";
import {
  folderEntryKey,
  formatFolderDuration,
  formatFolderFileSize,
  mergeFolderBrowsePages,
} from "../lib/folderBrowser";
import { useLanguage } from "../lib/i18n/LanguageProvider";
import { getJoinedFolderRootServerUrl } from "../lib/joinedServers";
import type { NavigationOrigin } from "../lib/navigationLayer";

const FOLDER_PAGE_SIZE = 200;

type LibraryKind = Extract<WorkKind, "movie" | "series" | "site" | "artist">;

interface LibraryFoldersProps {
  kind: LibraryKind;
  plural: string;
  routeBase: string;
  filterControls: ReactNode;
  navigationOrigin: NavigationOrigin;
  onNavigate: (event: ReactMouseEvent<HTMLElement>) => void;
}

function folderEntryMetadata(entry: FolderEntry): string[] {
  const dimensions =
    entry.width && entry.height ? `${entry.width}×${entry.height}` : null;
  const codecs = [entry.video_codec, entry.audio_codec]
    .filter((value): value is string => Boolean(value))
    .join(" / ");
  const bitrate =
    entry.bitrate_bps && entry.bitrate_bps > 0
      ? `${(entry.bitrate_bps / 1_000_000).toFixed(1)} Mbps`
      : null;
  return [
    entry.artist,
    entry.album,
    entry.container?.toUpperCase(),
    codecs || null,
    dimensions,
    formatFolderDuration(entry.duration_ms),
    bitrate,
    formatFolderFileSize(entry.size_bytes),
  ].filter((value): value is string => Boolean(value));
}

function rootIdentity(root: FolderRoot): string {
  return `${root.source_name}:${root.id}`;
}

export function LibraryFolders({
  kind,
  plural,
  routeBase,
  filterControls,
  navigationOrigin,
  onNavigate,
}: LibraryFoldersProps) {
  const client = useApiClient();
  const { t } = useLanguage();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialSelectionRef = useRef({
    rootId: searchParams.get("folderRoot"),
    path: searchParams.get("folderPath") ?? "",
  });
  const [roots, setRoots] = useState<FolderRoot[] | null>(null);
  const [rootWarnings, setRootWarnings] = useState<FolderRootError[]>([]);
  const [selectedRootId, setSelectedRootId] = useState<string | null>(null);
  const [path, setPath] = useState("");
  const [rootError, setRootError] = useState<string | null>(null);
  const [browse, setBrowse] = useState<FolderBrowseResponse | null>(null);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [rootRetry, setRootRetry] = useState(0);
  const [browseRetry, setBrowseRetry] = useState(0);
  const browseGenerationRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const entryScrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setRoots(null);
    setRootWarnings([]);
    setRootError(null);
    setBrowse(null);
    client
      .listFolderRoots(kind)
      .then((response) => {
        if (cancelled) return;
        setRoots(response.roots);
        setRootWarnings(response.errors);
        const initial = initialSelectionRef.current;
        const selected =
          response.roots.find(
            (root) => root.id === initial.rootId && root.available
          ) ??
          response.roots.find((root) => root.available) ??
          response.roots[0] ??
          null;
        setSelectedRootId(selected?.id ?? null);
        setPath(
          selected?.available && selected.id === initial.rootId
            ? initial.path
            : ""
        );
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setRoots([]);
          setRootWarnings([]);
          setRootError(describeApiError(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, kind, rootRetry]);

  const selectedRoot =
    roots?.find((root) => root.id === selectedRootId) ?? null;

  useEffect(() => {
    if (!selectedRootId) return;
    const next = new URLSearchParams(searchParams);
    next.set("folderRoot", selectedRootId);
    if (path) next.set("folderPath", path);
    else next.delete("folderPath");
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [path, searchParams, selectedRootId, setSearchParams]);

  useEffect(() => {
    const generation = browseGenerationRef.current + 1;
    browseGenerationRef.current = generation;
    loadingMoreRef.current = false;
    setLoadingMore(false);
    setBrowse(null);
    setBrowseError(null);
    if (!selectedRoot?.available) return;

    let cancelled = false;
    client
      .browseFolder(selectedRoot.id, {
        path: path || undefined,
        limit: FOLDER_PAGE_SIZE,
        offset: 0,
      })
      .then((response) => {
        if (!cancelled && generation === browseGenerationRef.current) {
          setBrowse(response);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled && generation === browseGenerationRef.current) {
          setBrowseError(describeApiError(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [browseRetry, client, path, selectedRoot?.available, selectedRoot?.id]);

  const appendNextPage = useCallback(async () => {
    if (
      !browse ||
      !selectedRoot ||
      loadingMoreRef.current ||
      browse.entries.length >= browse.total
    ) {
      return;
    }
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const generation = browseGenerationRef.current;
    try {
      const next = await client.browseFolder(selectedRoot.id, {
        path: path || undefined,
        limit: FOLDER_PAGE_SIZE,
        offset: browse.entries.length,
      });
      if (generation === browseGenerationRef.current) {
        setBrowse((current) =>
          current ? mergeFolderBrowsePages(current, next) : next
        );
      }
    } catch (error: unknown) {
      if (generation === browseGenerationRef.current) {
        setBrowseError(describeApiError(error));
      }
    } finally {
      if (generation === browseGenerationRef.current) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [browse, client, path, selectedRoot]);

  const hasMore = Boolean(
    browse && browse.entries.length < browse.total && !browseError
  );

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const scrollRoot = entryScrollRef.current;
    if (!sentinel || !scrollRoot || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void appendNextPage();
        }
      },
      { root: scrollRoot, rootMargin: "0px 0px 600px", threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [appendNextPage, hasMore]);

  const playableItems = useMemo(
    () =>
      (browse?.entries ?? []).flatMap((entry) =>
        entry.entry_type === "media" && entry.media_file_id
          ? [
              {
                mediaFileId: entry.media_file_id,
                title: entry.title || entry.name,
                subtitle:
                  [entry.artist, entry.album].filter(Boolean).join(" · ") ||
                  entry.path,
              },
            ]
          : []
      ),
    [browse?.entries]
  );

  const folderBackTo = useMemo(() => {
    if (!selectedRootId) return routeBase;
    const query = new URLSearchParams({ folderRoot: selectedRootId });
    if (path) query.set("folderPath", path);
    return `${routeBase}?${query.toString()}`;
  }, [path, routeBase, selectedRootId]);

  const graphic =
    kind === "artist" ? "music" : kind === "movie" ? "movies" : "series";

  function selectRoot(root: FolderRoot) {
    if (!root.available) return;
    setSelectedRootId(root.id);
    setPath("");
  }

  function folderContents() {
    if (roots === null) {
      return (
        <div className="tv-folder-loading" role="status">
          <span className="tv-mini-loader" aria-hidden="true" />
          <span>{t("pages.library.folderLoadingRoots")}</span>
        </div>
      );
    }
    if (rootError) {
      return (
        <TvEmptyState
          graphic={graphic}
          tone="error"
          variant="rail"
          title={t("pages.library.folderRootsErrorTitle")}
          description={rootError}
        >
          <button
            type="button"
            className="tv-folder-retry"
            onClick={() => setRootRetry((value) => value + 1)}
          >
            {t("pages.library.folderRetry")}
          </button>
        </TvEmptyState>
      );
    }
    if (roots.length === 0) {
      return (
        <TvEmptyState
          graphic={graphic}
          tone={rootWarnings.length > 0 ? "error" : "empty"}
          variant="rail"
          title={
            rootWarnings.length > 0
              ? t("pages.library.folderRootsErrorTitle")
              : t("pages.library.folderEmptyRootsTitle")
          }
          description={
            rootWarnings.length > 0
              ? rootWarnings
                  .map((warning) => `${warning.source_name}: ${warning.message}`)
                  .join(" · ")
              : t("pages.library.folderEmptyRootsDescription")
          }
        />
      );
    }
    if (!selectedRoot?.available) {
      return (
        <TvEmptyState
          graphic={graphic}
          variant="rail"
          title={t("pages.library.folderUnavailableTitle")}
          description={
            selectedRoot?.unavailable_reason ??
            t("pages.library.folderUnavailableDescription")
          }
        />
      );
    }
    if (browseError && !browse) {
      return (
        <TvEmptyState
          graphic={graphic}
          tone="error"
          variant="rail"
          title={t("pages.library.folderBrowseErrorTitle")}
          description={browseError}
        >
          <button
            type="button"
            className="tv-folder-retry"
            onClick={() => setBrowseRetry((value) => value + 1)}
          >
            {t("pages.library.folderRetry")}
          </button>
        </TvEmptyState>
      );
    }
    if (!browse) {
      return (
        <div className="tv-folder-loading" role="status">
          <span className="tv-mini-loader" aria-hidden="true" />
          <span>{t("pages.library.folderLoading")}</span>
        </div>
      );
    }
    if (browse.entries.length === 0) {
      return (
        <TvEmptyState
          graphic={graphic}
          variant="rail"
          title={t("pages.library.folderEmptyTitle")}
          description={t("pages.library.folderEmptyDescription")}
        />
      );
    }

    return (
      <div
        ref={entryScrollRef}
        className="tv-folder-entry-scroll"
        data-tv-scroll-container
        data-tv-scroll-axis="vertical"
        data-navigation-scroll-key={`library:${kind}:folders:${selectedRoot.id}:${path || "/"}`}
      >
        <div className="tv-folder-entry-list">
          {browse.entries.map((entry, index) => {
            const entryKey = folderEntryKey(entry);
            const title = entry.title || entry.name;
            const metadata = folderEntryMetadata(entry);
            const commonProps = {
              className: `tv-folder-entry is-${entry.entry_type}`,
              "data-navigation-focus-key": `library:${kind}:folder-entry:${selectedRoot.id}:${entryKey}`,
              "data-tv-focus-default": index === 0 ? true : undefined,
            };
            if (entry.entry_type === "directory") {
              return (
                <button
                  {...commonProps}
                  key={entryKey}
                  type="button"
                  onClick={() => setPath(entry.path)}
                  aria-label={t("pages.library.folderOpen", {
                    name: entry.name,
                  })}
                >
                  <span className="tv-folder-entry-art tv-folder-directory-icon" aria-hidden="true">
                    <i />
                  </span>
                  <span className="tv-folder-entry-copy">
                    <strong>{entry.name}</strong>
                    <small>{t("pages.library.folderDirectory")}</small>
                  </span>
                  <span className="tv-folder-entry-action" aria-hidden="true">
                    →
                  </span>
                </button>
              );
            }

            const entryBody = (
              <>
                {entry.media_file_id && entry.thumbnail_url ? (
                  <MediaThumbnailArtwork
                    mediaFileId={entry.media_file_id}
                    fallback={null}
                    className="tv-folder-entry-art"
                    intersectionRootSelector=".tv-folder-entry-scroll"
                    rootMargin="0px 0px 480px"
                  >
                    <span className="tv-folder-media-fallback" aria-hidden="true">
                      ▶
                    </span>
                  </MediaThumbnailArtwork>
                ) : (
                  <span className="tv-folder-entry-art">
                    <span className="tv-folder-media-fallback" aria-hidden="true">
                      ▶
                    </span>
                  </span>
                )}
                <span className="tv-folder-entry-copy">
                  <strong>{title}</strong>
                  <small>
                    {metadata.join(" · ") ||
                      entry.media_kind ||
                      t("pages.library.folderMedia")}
                  </small>
                  <span>{entry.path}</span>
                </span>
                <span className="tv-folder-entry-action" aria-hidden="true">
                  ▶
                </span>
              </>
            );

            return entry.media_file_id ? (
              <Link
                {...commonProps}
                key={entryKey}
                to={`/player/${encodeURIComponent(entry.media_file_id)}`}
                state={{
                  title,
                  backTo: folderBackTo,
                  navigationOrigin,
                  playlistItems: playableItems,
                  mediaFileId: entry.media_file_id,
                  serverUrl: getJoinedFolderRootServerUrl(selectedRoot.id),
                }}
                onClick={onNavigate}
                aria-label={t("pages.library.folderPlay", { title })}
              >
                {entryBody}
              </Link>
            ) : (
              <div
                {...commonProps}
                key={entryKey}
                aria-disabled="true"
                title={t("pages.library.folderMediaUnavailable")}
              >
                {entryBody}
              </div>
            );
          })}
          <div ref={sentinelRef} className="tv-folder-sentinel" aria-live="polite">
            {loadingMore ? (
              <>
                <span className="tv-mini-loader" aria-hidden="true" />
                <span>{t("pages.library.folderLoadingMore")}</span>
              </>
            ) : browseError ? (
              <button
                type="button"
                className="tv-folder-retry"
                onClick={() => {
                  setBrowseError(null);
                  void appendNextPage();
                }}
              >
                {t("pages.library.folderRetryMore")}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <TvStageShell
      className="tv-library tv-directory tv-folder-library"
      ariaLabel={t("pages.library.folderStageAriaLabel", { plural })}
    >
      <header className="tv-library-heading">
        <Link
          to="/"
          className="tv-page-back"
          aria-label={t("pages.library.backToHome")}
        >
          <span aria-hidden="true">←</span>
        </Link>
        <h1>{plural}</h1>
        <span>{t("pages.library.viewFolders")}</span>
      </header>

      {filterControls}

      {roots && roots.length > 0 ? (
        <div
          className="tv-folder-root-scroll"
          role="tablist"
          aria-label={t("pages.library.folderRootsAriaLabel")}
          data-tv-scroll-container
          data-tv-scroll-axis="horizontal"
          data-navigation-scroll-key={`library:${kind}:folder-roots`}
        >
          {roots.map((root) => (
            <button
              key={rootIdentity(root)}
              type="button"
              role="tab"
              className={root.id === selectedRootId ? "is-active" : ""}
              disabled={!root.available}
              aria-selected={root.id === selectedRootId}
              aria-label={
                root.available
                  ? root.name
                  : t("pages.library.folderRootUnavailable", {
                      name: root.name,
                      reason:
                        root.unavailable_reason ??
                        t("pages.library.folderUnavailableDescription"),
                    })
              }
              title={root.unavailable_reason ?? undefined}
              data-tv-focus-default={
                root.id === selectedRootId ? true : undefined
              }
              data-navigation-focus-key={`library:${kind}:folder-root:${root.id}`}
              onClick={() => selectRoot(root)}
            >
              <strong>{root.name}</strong>
              <small>{root.source_name}</small>
            </button>
          ))}
        </div>
      ) : null}

      {selectedRoot?.available && browse ? (
        <nav
          className="tv-folder-breadcrumb-scroll"
          aria-label={t("pages.library.folderBreadcrumbsAriaLabel")}
          data-tv-scroll-container
          data-tv-scroll-axis="horizontal"
          data-navigation-scroll-key={`library:${kind}:folder-breadcrumbs:${selectedRoot.id}`}
        >
          {browse.breadcrumbs.map((breadcrumb, index) => (
            <span key={breadcrumb.path}>
              {index > 0 ? <i aria-hidden="true">/</i> : null}
              <button
                type="button"
                className={breadcrumb.path === browse.path ? "is-current" : ""}
                onClick={() => setPath(breadcrumb.path)}
                aria-current={
                  breadcrumb.path === browse.path ? "page" : undefined
                }
              >
                {breadcrumb.name}
              </button>
            </span>
          ))}
        </nav>
      ) : null}

      <section
        className="tv-folder-panel"
        aria-label={t("pages.library.folderBrowseAriaLabel")}
      >
        {rootWarnings.length > 0 && roots && roots.length > 0 ? (
          <div className="tv-folder-warning" role="status">
            <strong>{t("pages.library.folderRootWarnings")}</strong>
            <span>
              {rootWarnings
                .map((warning) => `${warning.source_name}: ${warning.message}`)
                .join(" · ")}
            </span>
          </div>
        ) : null}
        {folderContents()}
      </section>
    </TvStageShell>
  );
}
