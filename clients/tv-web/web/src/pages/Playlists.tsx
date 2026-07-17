import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import {
  describeApiError,
  type PlaylistResponse,
  type WatchProgress,
  type Work,
  type WorkDetail,
} from "@streamarr-tv/api-client";
import { useApiClient } from "../lib/ApiClientProvider";
import { CachedArtworkImage } from "../lib/artwork";
import {
  isNavigationLayerRestoring,
  navigationOriginFromState,
  useNavigationLayer,
} from "../lib/navigationLayer";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import { useScrollEdges } from "../lib/useScrollEdges";
import { useToast } from "../lib/toast";
import {
  useMediaContextMenu,
  type PlaylistMembershipChange,
} from "../components/MediaContextMenu";
import {
  indexWatchProgressByWork,
  WatchStateOverlay,
} from "../components/WatchStateOverlay";
import {
  TvMediaTrack,
  TvRailSurface,
  TvStageShell,
} from "../components/tv/TvStage";
import { TvEmptyState } from "../components/tv/TvEmptyState";

interface ResolvedPlaylistItem {
  id: string;
  work: Work;
}

interface PlaylistTrack {
  playlist: PlaylistResponse;
  items: ResolvedPlaylistItem[];
}

type PageState =
  | { status: "loading" }
  | { status: "ready"; tracks: PlaylistTrack[] }
  | { status: "error"; message: string };

type PlaylistVisibility = "all" | "personal" | "shared";
type PlaylistOrder = "asc" | "desc";
type PlaylistDrawer = "create" | "filters" | null;
type CreateState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "error"; message: string };

function detailRoute(work: Work): string {
  return `/playlists/${work.id}`;
}

function orderPlaylistTracks(
  tracks: PlaylistTrack[],
  order: PlaylistOrder
): PlaylistTrack[] {
  return [...tracks].sort((left, right) => {
    const comparison = left.playlist.name.localeCompare(
      right.playlist.name,
      undefined,
      { numeric: true, sensitivity: "base" }
    );
    return order === "asc" ? comparison : -comparison;
  });
}

function centreTrack(
  container: HTMLElement,
  section: HTMLElement,
  behaviour: ScrollBehavior
): void {
  const target =
    section.offsetTop + section.offsetHeight / 2 - container.clientHeight / 2;
  const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
  container.scrollTo({
    top: Math.max(0, Math.min(maxScrollTop, target)),
    behavior: behaviour,
  });
}

function playlistRoute(
  playlistId: string,
  visibility: PlaylistVisibility,
  order: PlaylistOrder
): string {
  const params = new URLSearchParams({ playlist: playlistId });
  if (visibility !== "all") params.set("visibility", visibility);
  if (order !== "asc") params.set("order", order);
  return `/playlists?${params.toString()}`;
}

function parentOptionLabel(
  track: PlaylistTrack,
  tracksById: Map<string, PlaylistTrack>
): string {
  const names = [track.playlist.name];
  const visited = new Set([track.playlist.id]);
  let parentId = track.playlist.parent_playlist_id;
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = tracksById.get(parentId);
    if (!parent) break;
    names.unshift(parent.playlist.name);
    parentId = parent.playlist.parent_playlist_id;
  }
  return names.join(" › ");
}

function rootPlaylistTrack(
  track: PlaylistTrack,
  tracksById: Map<string, PlaylistTrack>
): PlaylistTrack {
  let current = track;
  const visited = new Set([track.playlist.id]);
  while (current.playlist.parent_playlist_id) {
    const parentId = current.playlist.parent_playlist_id;
    if (visited.has(parentId)) break;
    const parent = tracksById.get(parentId);
    if (!parent) break;
    visited.add(parentId);
    current = parent;
  }
  return current;
}

function descendantPlaylistTracks(
  playlistId: string,
  childrenByParent: Map<string, PlaylistTrack[]>
): PlaylistTrack[] {
  const descendants: PlaylistTrack[] = [];
  const visited = new Set([playlistId]);
  const visit = (parentId: string) => {
    for (const child of childrenByParent.get(parentId) ?? []) {
      if (visited.has(child.playlist.id)) continue;
      visited.add(child.playlist.id);
      descendants.push(child);
      visit(child.playlist.id);
    }
  };
  visit(playlistId);
  return descendants;
}

/** Playlist directory plus an in-route playlist detail surface. */
export function PlaylistsPage() {
  const { showToast } = useToast();
  const client = useApiClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedPlaylistId = searchParams.get("playlist");
  const requestedTrackId = searchParams.get("track");
  const returnOrigin = navigationOriginFromState(location.state);
  const [pageState, setPageState] = useState<PageState>({ status: "loading" });
  const [selectedDirectoryId, setSelectedDirectoryId] = useState<string | null>(
    null
  );
  const [activeTrackId, setActiveTrackId] = useState<string | null>(null);
  const [selectedByTrack, setSelectedByTrack] = useState<
    Record<string, string | null>
  >({});
  const [watchProgress, setWatchProgress] = useState<WatchProgress[] | null>(null);
  const [visibility, setVisibility] = useState<PlaylistVisibility>(() => {
    const value = searchParams.get("visibility");
    return value === "personal" || value === "shared" ? value : "all";
  });
  const [order, setOrder] = useState<PlaylistOrder>(() =>
    searchParams.get("order") === "desc" ? "desc" : "asc"
  );
  const [drawer, setDrawer] = useState<PlaylistDrawer>(null);
  const [playlistName, setPlaylistName] = useState("");
  const [parentPlaylistId, setParentPlaylistId] = useState("");
  const [createState, setCreateState] = useState<CreateState>({ status: "idle" });
  const gridRef = useRef<HTMLDivElement>(null);
  const tracksRef = useRef<HTMLDivElement>(null);
  const focusedTrackRef = useRef<string | null>(null);
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const filterButtonRef = useRef<HTMLButtonElement>(null);
  const filterDrawerRef = useRef<HTMLElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const playlists = await client.listPlaylists();
        const itemGroups = await Promise.all(
          playlists.map(async (playlist) => {
            try {
              return await client.listPlaylistItems(playlist.id);
            } catch {
              return [];
            }
          })
        );
        const workIds = [
          ...new Set(itemGroups.flat().map((item) => item.work_id)),
        ];
        const details = await Promise.all(
          workIds.map(async (workId): Promise<WorkDetail | null> => {
            try {
              return await client.getWork(workId);
            } catch {
              return null;
            }
          })
        );
        const workById = new Map(
          details
            .filter((detail): detail is WorkDetail => detail !== null)
            .map((detail) => [detail.work.id, detail.work])
        );
        const tracks = playlists.map((playlist, index) => ({
          playlist,
          items: [...(itemGroups[index] ?? [])]
            .sort((left, right) => left.position - right.position)
            .flatMap((item) => {
              const work = workById.get(item.work_id);
              return work ? [{ id: item.id, work }] : [];
            }),
        }));
        if (cancelled) return;
        setSelectedByTrack(
          Object.fromEntries(
            tracks.map((track) => [
              track.playlist.id,
              track.items[0]?.id ?? null,
            ])
          )
        );
        setPageState({ status: "ready", tracks });
      } catch (error: unknown) {
        if (!cancelled) {
          setPageState({ status: "error", message: describeApiError(error) });
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [client]);

  useEffect(() => {
    let cancelled = false;
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

  const tracks = pageState.status === "ready" ? pageState.tracks : [];
  const tracksById = useMemo(
    () => new Map(tracks.map((track) => [track.playlist.id, track])),
    [tracks]
  );
  const childrenByParent = useMemo(() => {
    const children = new Map<string, PlaylistTrack[]>();
    for (const track of tracks) {
      const parentId = track.playlist.parent_playlist_id;
      if (!parentId) continue;
      const siblings = children.get(parentId) ?? [];
      siblings.push(track);
      children.set(parentId, siblings);
    }
    for (const siblings of children.values()) {
      siblings.sort((left, right) =>
        left.playlist.name.localeCompare(right.playlist.name, undefined, {
          numeric: true,
          sensitivity: "base",
        })
      );
    }
    return children;
  }, [tracks]);
  const requestedPlaylist = requestedPlaylistId
    ? tracksById.get(requestedPlaylistId) ?? null
    : null;
  const selectedPlaylist = requestedPlaylist
    ? rootPlaylistTrack(requestedPlaylist, tracksById)
    : null;
  const fixedParentPlaylist =
    selectedPlaylist && !selectedPlaylist.playlist.is_system
      ? selectedPlaylist
      : null;
  useDocumentTitle(
    selectedPlaylist
      ? `${selectedPlaylist.playlist.name} · Playlists`
      : "Playlists"
  );

  const rootTracks = useMemo(
    () =>
      orderPlaylistTracks(
        tracks.filter((track) => {
          if (
            track.playlist.parent_playlist_id &&
            tracksById.has(track.playlist.parent_playlist_id)
          ) {
            return false;
          }
          if (visibility === "personal") return !track.playlist.is_system;
          if (visibility === "shared") return track.playlist.is_system;
          return true;
        }),
        order
      ),
    [order, tracks, tracksById, visibility]
  );
  const detailTracks = useMemo(
    () =>
      selectedPlaylist
        ? [
            selectedPlaylist,
            ...descendantPlaylistTracks(
              selectedPlaylist.playlist.id,
              childrenByParent
            ),
          ]
        : [],
    [childrenByParent, selectedPlaylist]
  );
  const coverWorksByPlaylist = useMemo(() => {
    const cache = new Map<string, Work[]>();
    const collect = (playlistId: string, visiting: Set<string>): Work[] => {
      const cached = cache.get(playlistId);
      if (cached) return cached;
      if (visiting.has(playlistId)) return [];
      const nextVisiting = new Set(visiting).add(playlistId);
      const unique = new Map<string, Work>();
      const track = tracksById.get(playlistId);
      for (const item of track?.items ?? []) {
        if (!item.work.images.length) continue;
        unique.set(item.work.id, item.work);
        if (unique.size >= 3) break;
      }
      if (unique.size < 3) {
        for (const child of childrenByParent.get(playlistId) ?? []) {
          for (const work of collect(child.playlist.id, nextVisiting)) {
            unique.set(work.id, work);
            if (unique.size >= 3) break;
          }
          if (unique.size >= 3) break;
        }
      }
      const works = [...unique.values()].slice(0, 3);
      cache.set(playlistId, works);
      return works;
    };
    for (const track of tracks) collect(track.playlist.id, new Set());
    return cache;
  }, [childrenByParent, tracks, tracksById]);

  useEffect(() => {
    if (requestedPlaylistId) {
      setActiveTrackId((current) => {
        const requestedTrack = requestedTrackId
          ? detailTracks.find(
              (track) => track.playlist.id === requestedTrackId
            )
          : null;
        if (requestedTrack) return requestedTrack.playlist.id;
        if (
          current &&
          detailTracks.some((track) => track.playlist.id === current)
        ) {
          return current;
        }
        const firstTrackWithItems =
          detailTracks.find((track) => track.items.length > 0) ?? detailTracks[0];
        return firstTrackWithItems?.playlist.id ?? null;
      });
      return;
    }
    setSelectedDirectoryId((current) =>
      current && rootTracks.some((track) => track.playlist.id === current)
        ? current
        : rootTracks[0]?.playlist.id ?? null
    );
  }, [detailTracks, requestedPlaylistId, requestedTrackId, rootTracks]);

  useEffect(() => {
    if (
      !requestedPlaylist ||
      !selectedPlaylist ||
      requestedPlaylist.playlist.id === selectedPlaylist.playlist.id
    ) {
      return;
    }
    const params = new URLSearchParams(searchParams);
    params.set("playlist", selectedPlaylist.playlist.id);
    params.set("track", requestedPlaylist.playlist.id);
    setSearchParams(params, { replace: true });
  }, [
    requestedPlaylist,
    searchParams,
    selectedPlaylist,
    setSearchParams,
  ]);

  const activeDetailTrack =
    detailTracks.find((track) => track.playlist.id === activeTrackId) ??
    detailTracks.find((track) => track.items.length > 0) ??
    detailTracks[0];
  const selectedDetailItem =
    activeDetailTrack?.items.find(
      (item) => item.id === selectedByTrack[activeDetailTrack.playlist.id]
    ) ?? activeDetailTrack?.items[0];
  const selectedDirectoryTrack =
    rootTracks.find((track) => track.playlist.id === selectedDirectoryId) ??
    rootTracks[0];
  const selectedWork =
    selectedDetailItem?.work ??
    (selectedDirectoryTrack
      ? coverWorksByPlaylist.get(selectedDirectoryTrack.playlist.id)?.[0]
      : undefined);

  const restoreKey = useMemo(
    () =>
      requestedPlaylistId
        ? `detail:${requestedPlaylistId}:${detailTracks
            .map(
              (track) =>
                `${track.playlist.id}:${track.items
                  .map((item) => item.id)
                  .join(",")}`
            )
            .join("|")}`
        : `directory:${visibility}:${order}:${rootTracks
            .map((track) => track.playlist.id)
            .join(",")}`,
    [detailTracks, order, requestedPlaylistId, rootTracks, visibility]
  );
  const navigationLayer = useNavigationLayer(
    restoreKey || pageState.status,
    pageState.status === "ready",
    pageState.status === "ready"
  );
  const gridEdges = useScrollEdges(
    gridRef,
    "vertical",
    rootTracks.map((track) => track.playlist.id).join(":")
  );
  const progressByWork = useMemo(
    () => indexWatchProgressByWork(watchProgress ?? []),
    [watchProgress]
  );

  useLayoutEffect(() => {
    if (
      navigationLayer.hasSnapshot ||
      pageState.status !== "ready" ||
      !requestedPlaylistId
    ) {
      return;
    }
    const container = tracksRef.current;
    const sections = Array.from(
      container?.querySelectorAll<HTMLElement>(".tv-media-track") ?? []
    );
    const targetSection =
      sections.find(
        (section) =>
          section.dataset.tvTrackId === activeTrackId &&
          section.querySelector(".tv-home-card")
      ) ?? sections.find((section) => section.querySelector(".tv-home-card"));
    if (!container || !targetSection) return;
    centreTrack(container, targetSection, "auto");
    focusedTrackRef.current = targetSection.dataset.tvTrackId ?? null;
  }, [
    activeTrackId,
    navigationLayer.hasSnapshot,
    pageState.status,
    requestedPlaylistId,
    restoreKey,
  ]);

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

  const handlePlaylistMembershipChanged = useCallback(
    (change: PlaylistMembershipChange, work: Work) => {
      setPageState((current) => {
        if (current.status !== "ready") return current;
        return {
          status: "ready",
          tracks: current.tracks.map((track) => {
            let items =
              track.playlist.id === change.playlistId
                ? track.items.filter((item) => item.id !== change.itemId)
                : track.items;
            if (
              change.type === "moved" &&
              track.playlist.id === change.destinationPlaylistId
            ) {
              items = [
                ...items,
                { id: change.destinationItemId, work },
              ];
            }
            return items === track.items ? track : { ...track, items };
          }),
        };
      });
      setSelectedByTrack((current) => {
        const next = { ...current };
        if (next[change.playlistId] === change.itemId) {
          next[change.playlistId] = null;
        }
        if (change.type === "moved") {
          next[change.destinationPlaylistId] = change.destinationItemId;
        }
        return next;
      });
      setActiveTrackId(
        change.type === "moved"
          ? change.destinationPlaylistId
          : change.playlistId
      );
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          const target =
            change.type === "moved"
              ? document.querySelector<HTMLElement>(
                  `[data-navigation-focus-key="playlists:${change.destinationPlaylistId}:${change.destinationItemId}"]`
                )
              : document.querySelector<HTMLElement>(
                  `[data-tv-track-id="${change.playlistId}"] .tv-home-card`
                );
          target?.focus({ preventScroll: true });
        });
      });
    },
    []
  );

  function selectFromTrack(trackId: string, itemId: string) {
    setActiveTrackId(trackId);
    setSelectedByTrack((current) =>
      current[trackId] === itemId
        ? current
        : { ...current, [trackId]: itemId }
    );
  }

  function focusFromTrack(
    trackId: string,
    itemId: string,
    section: HTMLElement
  ) {
    const enteredNewTrack = focusedTrackRef.current !== trackId;
    focusedTrackRef.current = trackId;
    selectFromTrack(trackId, itemId);
    if (!enteredNewTrack || isNavigationLayerRestoring()) return;
    window.requestAnimationFrame(() => {
      const container = tracksRef.current;
      if (container && section.isConnected) {
        centreTrack(container, section, "smooth");
      }
    });
  }

  function updatePlaylistFilters(
    nextVisibility: PlaylistVisibility,
    nextOrder: PlaylistOrder
  ) {
    setVisibility(nextVisibility);
    setOrder(nextOrder);
    const params = new URLSearchParams(searchParams);
    params.delete("playlist");
    if (nextVisibility === "all") params.delete("visibility");
    else params.set("visibility", nextVisibility);
    if (nextOrder === "asc") params.delete("order");
    else params.set("order", nextOrder);
    setSearchParams(params, { replace: true });
  }

  function openDrawer(nextDrawer: Exclude<PlaylistDrawer, null>) {
    setDrawer(nextDrawer);
    setCreateState({ status: "idle" });
    if (nextDrawer === "create") {
      setParentPlaylistId(
        fixedParentPlaylist ? fixedParentPlaylist.playlist.id : ""
      );
    }
  }

  function closeDrawer(origin: Exclude<PlaylistDrawer, null>) {
    setDrawer(null);
    setCreateState({ status: "idle" });
    window.requestAnimationFrame(() => {
      const target =
        origin === "create" ? createButtonRef.current : filterButtonRef.current;
      target?.focus({ preventScroll: true });
    });
  }

  useEffect(() => {
    if (drawer !== "create") return;
    const frame = window.requestAnimationFrame(() => {
      nameInputRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [drawer]);

  useEffect(() => {
    if (drawer !== "filters") return;
    const frame = window.requestAnimationFrame(() => {
      filterDrawerRef.current
        ?.querySelector<HTMLButtonElement>(".is-active")
        ?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [drawer]);

  function handleDrawerKeyDown(event: KeyboardEvent<HTMLElement>) {
    const isBack =
      event.key === "Escape" ||
      event.key === "BrowserBack" ||
      event.key === "GoBack" ||
      event.keyCode === 10009 ||
      event.keyCode === 461;
    if (isBack) {
      event.preventDefault();
      event.stopPropagation();
      if (drawer) closeDrawer(drawer);
      return;
    }
    const nativeControl =
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLSelectElement;
    if (event.key === "ArrowLeft" && !nativeControl) {
      event.preventDefault();
      event.stopPropagation();
      if (drawer) closeDrawer(drawer);
      return;
    }
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
      if (event.key === "ArrowRight" && !nativeControl) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    if (event.target instanceof HTMLSelectElement) return;
    const controls = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled)'
      )
    );
    const currentIndex = controls.indexOf(document.activeElement as HTMLElement);
    if (currentIndex < 0 || controls.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const direction = event.key === "ArrowDown" ? 1 : -1;
    controls[
      (currentIndex + direction + controls.length) % controls.length
    ]?.focus({ preventScroll: true });
  }

  async function createPlaylist(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = playlistName.trim();
    if (!name) {
      setCreateState({
        status: "error",
        message: "Enter a name for the playlist.",
      });
      nameInputRef.current?.focus({ preventScroll: true });
      return;
    }
    setCreateState({ status: "submitting" });
    try {
      const createdParentId =
        fixedParentPlaylist?.playlist.id ?? (parentPlaylistId || null);
      const created = await client.createPlaylist({
        name,
        parent_playlist_id: createdParentId,
      });
      setPageState((current) =>
        current.status === "ready"
          ? {
              status: "ready",
              tracks: [...current.tracks, { playlist: created, items: [] }],
            }
          : current
      );
      setSelectedByTrack((current) => ({ ...current, [created.id]: null }));
      setPlaylistName("");
      setParentPlaylistId("");
      if (createdParentId) {
        setActiveTrackId(created.id);
        if (!fixedParentPlaylist) {
          const rootParent = tracksById.get(createdParentId);
          const root = rootParent
            ? rootPlaylistTrack(rootParent, tracksById)
            : null;
          const params = new URLSearchParams(searchParams);
          params.set("playlist", root?.playlist.id ?? createdParentId);
          params.set("track", created.id);
          navigate(`/playlists?${params.toString()}`);
        }
      } else {
        const navigationOrigin = navigationLayer.capture(createButtonRef.current);
        const params = new URLSearchParams(searchParams);
        params.set("playlist", created.id);
        params.delete("track");
        navigate(`/playlists?${params.toString()}`, {
          state: { navigationOrigin },
        });
      }
      closeDrawer("create");
      showToast(`Playlist ${created.name} created.`);
    } catch (error: unknown) {
      setCreateState({
        status: "error",
        message: describeApiError(error),
      });
    }
  }

  function leavePlaylistDetail() {
    if (returnOrigin) {
      navigate(-1);
      return;
    }
    const params = new URLSearchParams(searchParams);
    params.delete("playlist");
    setSearchParams(params);
  }

  if (pageState.status === "loading") {
    return (
      <div
        className="tv-home tv-compact-loading"
        aria-label="Loading playlists"
        role="status"
      >
        <div className="tv-orbit-loader" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <p>Preparing playlists</p>
      </div>
    );
  }

  if (pageState.status === "error") {
    return (
      <div className="page tv-state-page">
        <TvEmptyState
          graphic="playlist"
          tone="error"
          variant="page"
          title="Playlists could not be loaded"
          description={pageState.message}
        />
      </div>
    );
  }

  const isDetail = Boolean(requestedPlaylistId);
  const personalParentOptions = orderPlaylistTracks(
    rootTracks.filter((track) => !track.playlist.is_system),
    "asc"
  );
  const featureTrack = isDetail ? activeDetailTrack : selectedDirectoryTrack;
  const featureTitle =
    selectedDetailItem?.work.title ??
    featureTrack?.playlist.name ??
    (isDetail ? "Playlist unavailable" : "Playlists");
  const featureOverview =
    selectedDetailItem?.work.overview ??
    (featureTrack
      ? `${featureTrack.items.length} ${
          featureTrack.items.length === 1 ? "title" : "titles"
        }`
      : isDetail
        ? "This playlist is no longer available."
        : rootTracks.length
          ? "Choose a playlist to open it."
          : tracks.length
            ? "No top-level playlists match the current filters."
            : "Create a playlist to organise films and series.");
  const activeContentFocusKey =
    isDetail && activeDetailTrack && selectedDetailItem
      ? `playlists:${activeDetailTrack.playlist.id}:${selectedDetailItem.id}`
      : !isDetail && selectedDirectoryTrack
        ? `playlists:directory:${selectedDirectoryTrack.playlist.id}`
        : null;
  const activeContentSelector = activeContentFocusKey
    ? `[data-navigation-focus-key="${activeContentFocusKey}"]`
    : isDetail
      ? ".tv-playlist-media-track .tv-home-card"
      : ".tv-playlist-directory-card";

  return (
    <TvStageShell
      className={`tv-home tv-playlists${
        isDetail ? " is-playlist-detail" : " is-playlist-directory"
      }`}
      ariaLabel={isDetail ? selectedPlaylist?.playlist.name ?? "Playlist" : "Playlists"}
      artworkKey={selectedWork?.id}
      artwork={
        selectedWork ? (
          <CachedArtworkImage
            work={selectedWork}
            kinds={["backdrop", "poster"]}
            alt=""
            fallback={<span>{selectedWork.title}</span>}
          />
        ) : undefined
      }
    >
      <header className="tv-library-heading tv-playlists-heading">
        {isDetail ? (
          <button
            type="button"
            className="tv-page-back"
            aria-label="Back to playlists"
            onClick={leavePlaylistDetail}
            data-tv-focus-default={!selectedPlaylist ? true : undefined}
            data-tv-edge-target-right={activeContentSelector}
          >
            <span aria-hidden="true">←</span>
          </button>
        ) : (
          <Link to="/" className="tv-page-back" aria-label="Back to Home">
            <span aria-hidden="true">←</span>
          </Link>
        )}
        <h1>{selectedPlaylist?.playlist.name ?? "Playlists"}</h1>
        <span>
          {isDetail
            ? `${detailTracks.length} ${
                detailTracks.length === 1 ? "track" : "tracks"
              }`
            : `${rootTracks.length.toLocaleString()} ${
                rootTracks.length === 1 ? "playlist" : "playlists"
              }`}
        </span>
      </header>

      <aside
        className="tv-home-feature tv-playlist-feature"
        key={`playlist-feature-${selectedDetailItem?.id ?? featureTrack?.playlist.id}`}
        aria-hidden={drawer ? true : undefined}
      >
        <p className="tv-provider">
          {featureTrack
            ? featureTrack.playlist.is_system
              ? "Shared playlist"
              : "Your playlist"
            : "Your collection"}
        </p>
        <h2>{featureTitle}</h2>
        <p>{featureOverview}</p>
      </aside>

      {isDetail ? (
        <TvRailSurface
          ref={tracksRef}
          mode="vertical-tracks"
          scrollKey={`playlists:detail:${selectedPlaylist?.playlist.id ?? requestedPlaylistId}`}
          ariaLabel={`${selectedPlaylist?.playlist.name ?? "Playlist"} tracks`}
        >
          {selectedPlaylist ? (
            detailTracks.map((track, index) => (
              <PlaylistMediaTrack
                key={track.playlist.id}
                track={track}
                title={
                  index === 0
                    ? selectedPlaylist.playlist.name
                    : track.playlist.name
                }
                isRootTrack={index === 0}
                selectedId={
                  selectedByTrack[track.playlist.id] ??
                  track.items[0]?.id ??
                  null
                }
                isActive={activeDetailTrack?.playlist.id === track.playlist.id}
                progressByWork={progressByWork}
                progressReady={watchProgress !== null}
                onSelect={selectFromTrack}
                onFocusItem={focusFromTrack}
                onProgressChanged={handleProgressChanged}
                onPlaylistItemChanged={handlePlaylistMembershipChanged}
                navigationOrigin={navigationLayer.origin}
                onNavigate={navigationLayer.captureLink}
                parentRoute={playlistRoute(
                  selectedPlaylist.playlist.id,
                  visibility,
                  order
                )}
              />
            ))
          ) : (
            <TvEmptyState
              graphic="playlist"
              variant="rail"
              className="tv-playlist-empty-state"
              title="Playlist unavailable"
              description="Return to the playlist directory and choose another playlist."
            />
          )}
        </TvRailSurface>
      ) : (
        <TvRailSurface
          className={`tv-rail-panel tv-library-grid-panel is-screen artwork-medium tv-playlist-directory-panel${
            gridEdges.start ? " can-scroll-up" : ""
          }${gridEdges.end ? " can-scroll-down" : ""}`}
          mode="content"
          ariaLabel="Playlist directory"
        >
          <div
            className="tv-title-grid tv-playlist-directory-grid"
            ref={gridRef}
            data-tv-scroll-container
            data-tv-scroll-axis="vertical"
            data-navigation-scroll-key="playlists:directory"
            aria-hidden={drawer ? true : undefined}
          >
            <div className="tv-title-grid-content">
              {rootTracks.map((track, index) => {
                const selected =
                  track.playlist.id === selectedDirectoryTrack?.playlist.id;
                return (
                  <PlaylistDirectoryCard
                    key={track.playlist.id}
                    track={track}
                    coverWorks={
                      coverWorksByPlaylist.get(track.playlist.id) ?? []
                    }
                    childCount={
                      childrenByParent.get(track.playlist.id)?.length ?? 0
                    }
                    selected={selected}
                    to={playlistRoute(track.playlist.id, visibility, order)}
                    navigationOrigin={navigationLayer.origin}
                    onNavigate={navigationLayer.captureLink}
                    onFocus={() => setSelectedDirectoryId(track.playlist.id)}
                    defaultFocus={index === 0}
                  />
                );
              })}
              {!rootTracks.length ? (
                <TvEmptyState
                  graphic="playlist"
                  variant="rail"
                  className="tv-playlist-empty-state"
                  title={
                    tracks.length
                      ? "No matching top-level playlists"
                      : "No playlists yet"
                  }
                  description={
                    tracks.length
                      ? "Change the filters or open a nested playlist from Search."
                      : "Create a playlist to begin building your collection."
                  }
                />
              ) : null}
            </div>
          </div>
        </TvRailSurface>
      )}

      <div className="tv-playlist-controls" aria-hidden={drawer ? true : undefined}>
        {!isDetail || fixedParentPlaylist ? (
          <button
            ref={createButtonRef}
            type="button"
            className={`tv-filter-launcher${
              drawer === "create" ? " is-active" : ""
            }`}
            onClick={() => openDrawer("create")}
            data-navigation-focus-key="playlists:create"
            data-tv-edge-target-left={activeContentSelector}
            data-tv-focus-default={
              (!isDetail && !rootTracks.length) ||
              (isDetail && detailTracks.every((track) => !track.items.length))
                ? true
                : undefined
            }
            aria-expanded={drawer === "create"}
            aria-controls="playlist-create-drawer"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            <span>Create</span>
          </button>
        ) : null}
        {!isDetail ? (
          <button
            ref={filterButtonRef}
            type="button"
            className={`tv-filter-launcher${
              drawer === "filters" ? " is-active" : ""
            }`}
            onClick={() => openDrawer("filters")}
            data-navigation-focus-key="playlists:filters"
            aria-expanded={drawer === "filters"}
            aria-controls="playlist-filter-drawer"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 6h16M7 12h10m-7 6h4" />
              <circle cx="8" cy="6" r="1.5" />
              <circle cx="15" cy="12" r="1.5" />
              <circle cx="12" cy="18" r="1.5" />
            </svg>
            <span>Filters</span>
          </button>
        ) : null}
      </div>

      {drawer === "create" ? (
        <aside
          id="playlist-create-drawer"
          className="tv-filter-drawer tv-playlist-drawer"
          role="dialog"
          aria-modal="true"
          aria-labelledby="playlist-create-title"
          onKeyDown={handleDrawerKeyDown}
        >
          <header>
            <div>
              <p>
                {fixedParentPlaylist
                  ? `Inside ${fixedParentPlaylist.playlist.name}`
                  : "Personal playlist"}
              </p>
              <h2 id="playlist-create-title">
                {fixedParentPlaylist ? "Create sub-playlist" : "Create playlist"}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => closeDrawer("create")}
              aria-label="Close create playlist"
            >
              ×
            </button>
          </header>
          <form className="tv-playlist-create-form" onSubmit={createPlaylist}>
            <label htmlFor="playlist-name">Name</label>
            <input
              ref={nameInputRef}
              id="playlist-name"
              type="text"
              value={playlistName}
              onChange={(event) => {
                setPlaylistName(event.target.value);
                if (createState.status === "error") {
                  setCreateState({ status: "idle" });
                }
              }}
              placeholder="Playlist name"
              autoComplete="off"
            />
            {!fixedParentPlaylist ? (
              <>
                <label htmlFor="playlist-parent">Parent playlist</label>
                <select
                  id="playlist-parent"
                  className="tv-playlist-parent-select"
                  value={parentPlaylistId}
                  onChange={(event) => setParentPlaylistId(event.target.value)}
                >
                  <option value="">None — top level</option>
                  {personalParentOptions.map((track) => (
                    <option key={track.playlist.id} value={track.playlist.id}>
                      {parentOptionLabel(track, tracksById)}
                    </option>
                  ))}
                </select>
              </>
            ) : null}
            {createState.status === "error" ? (
              <p className="tv-playlist-form-error" role="alert">
                {createState.message}
              </p>
            ) : null}
            <button
              type="submit"
              className="btn btn-primary"
              disabled={
                !playlistName.trim() || createState.status === "submitting"
              }
            >
              {createState.status === "submitting" ? "Creating…" : "Create"}
            </button>
          </form>
        </aside>
      ) : null}

      {drawer === "filters" ? (
        <aside
          ref={filterDrawerRef}
          id="playlist-filter-drawer"
          className="tv-filter-drawer tv-playlist-drawer"
          role="dialog"
          aria-modal="true"
          aria-labelledby="playlist-filter-title"
          onKeyDown={handleDrawerKeyDown}
        >
          <header>
            <div>
              <p>Playlist controls</p>
              <h2 id="playlist-filter-title">Filters</h2>
            </div>
            <button
              type="button"
              onClick={() => closeDrawer("filters")}
              aria-label="Close playlist filters"
            >
              ×
            </button>
          </header>
          <section>
            <h3>Show</h3>
            <div className="tv-filter-choice-grid">
              {(["all", "personal", "shared"] as PlaylistVisibility[]).map(
                (option) => (
                  <button
                    key={option}
                    type="button"
                    className={visibility === option ? "is-active" : ""}
                    aria-pressed={visibility === option}
                    onClick={() => updatePlaylistFilters(option, order)}
                  >
                    {option === "personal" ? "Mine" : option}
                  </button>
                )
              )}
            </div>
          </section>
          <section>
            <h3>Order</h3>
            <div className="tv-filter-choice-grid tv-filter-choice-grid-wide">
              <button
                type="button"
                className={order === "asc" ? "is-active" : ""}
                aria-pressed={order === "asc"}
                onClick={() => updatePlaylistFilters(visibility, "asc")}
              >
                A–Z
              </button>
              <button
                type="button"
                className={order === "desc" ? "is-active" : ""}
                aria-pressed={order === "desc"}
                onClick={() => updatePlaylistFilters(visibility, "desc")}
              >
                Z–A
              </button>
            </div>
          </section>
        </aside>
      ) : null}
    </TvStageShell>
  );
}

function PlaylistDirectoryCard({
  track,
  coverWorks,
  childCount,
  selected,
  to,
  navigationOrigin,
  onNavigate,
  onFocus,
  defaultFocus,
}: {
  track: PlaylistTrack;
  coverWorks: Work[];
  childCount: number;
  selected: boolean;
  to: string;
  navigationOrigin: ReturnType<typeof useNavigationLayer>["origin"];
  onNavigate: ReturnType<typeof useNavigationLayer>["captureLink"];
  onFocus: () => void;
  defaultFocus: boolean;
}) {
  return (
    <Link
      to={to}
      state={{ navigationOrigin }}
      className={`tv-title-card tv-playlist-directory-card${
        selected ? " is-selected" : ""
      }`}
      onClick={onNavigate}
      onFocus={onFocus}
      onMouseEnter={onFocus}
      data-tv-focus-default={defaultFocus ? true : undefined}
      data-navigation-focus-key={`playlists:directory:${track.playlist.id}`}
      aria-label={`Open ${track.playlist.name}`}
    >
      <PlaylistCoverStack
        name={track.playlist.name}
        works={coverWorks}
      />
      <span className="tv-title-card-copy tv-playlist-directory-card-copy">
        <strong>{track.playlist.name}</strong>
        <small>
          {track.playlist.is_system ? "Shared" : "Personal"}
          {" · "}
          {track.items.length} {track.items.length === 1 ? "title" : "titles"}
          {childCount
            ? ` · ${childCount} ${childCount === 1 ? "folder" : "folders"}`
            : ""}
        </small>
      </span>
    </Link>
  );
}

function PlaylistCoverStack({
  name,
  works,
}: {
  name: string;
  works: Work[];
}) {
  if (!works.length) {
    return (
      <span className="tv-title-card-art tv-playlist-card-art is-empty">
        <span>{name}</span>
      </span>
    );
  }

  return (
    <span className="tv-title-card-art tv-playlist-card-art">
      {works.slice(0, 3).map((work, index) => {
        const inset = index * 5;
        const style: CSSProperties = {
          position: "absolute",
          zIndex: works.length - index,
          top: `${inset}%`,
          right: `${inset * 0.7}%`,
          bottom: 0,
          left: `${inset * 0.7}%`,
          display: "block",
          overflow: "hidden",
          borderRadius: "inherit",
          transform: `rotate(${(index - (works.length - 1) / 2) * -1.5}deg)`,
          transformOrigin: "center bottom",
          background: "var(--surface-soft)",
          boxShadow: "0 10px 28px rgba(31, 14, 20, 0.18)",
        };
        return (
          <i
            key={work.id}
            className="tv-playlist-card-cover"
            style={style}
            aria-hidden="true"
          >
            <CachedArtworkImage
              work={work}
              kinds={["poster", "backdrop"]}
              alt=""
              loading="lazy"
            />
          </i>
        );
      })}
    </span>
  );
}

function PlaylistMediaTrack({
  track,
  title,
  isRootTrack,
  selectedId,
  isActive,
  progressByWork,
  progressReady,
  onSelect,
  onFocusItem,
  onProgressChanged,
  onPlaylistItemChanged,
  navigationOrigin,
  onNavigate,
  parentRoute,
}: {
  track: PlaylistTrack;
  title: string;
  isRootTrack: boolean;
  selectedId: string | null;
  isActive: boolean;
  progressByWork: Map<string, WatchProgress>;
  progressReady: boolean;
  onSelect: (trackId: string, itemId: string) => void;
  onFocusItem: (
    trackId: string,
    itemId: string,
    section: HTMLElement
  ) => void;
  onProgressChanged: (workId: string, progress: WatchProgress[]) => void;
  onPlaylistItemChanged: (
    change: PlaylistMembershipChange,
    work: Work
  ) => void;
  navigationOrigin: ReturnType<typeof useNavigationLayer>["origin"];
  onNavigate: ReturnType<typeof useNavigationLayer>["captureLink"];
  parentRoute: string;
}) {
  const mediaContext = useMediaContextMenu({ onProgressChanged });

  return (
    <TvMediaTrack
      title={title}
      meta={
        track.items.length
          ? `${isRootTrack ? "Direct items · " : ""}${track.items.length} ${
              track.items.length === 1 ? "title" : "titles"
            }`
          : undefined
      }
      active={isActive}
      ariaLabel={title}
      dataTrackId={track.playlist.id}
      scrollKey={`playlists:track:${track.playlist.id}`}
      itemsKey={track.items.map((item) => item.id).join(":")}
      className="tv-playlist-media-track"
      rightEdgeTarget='[data-navigation-focus-key="playlists:create"]'
      overlay={mediaContext.contextMenu}
    >
      {!track.items.length ? (
        <TvEmptyState
          graphic="playlist"
          variant="track"
          title="Nothing here yet"
          description="Move a movie or series into this track from its context menu."
        />
      ) : null}
      {track.items.map((item, index) => {
        const work = item.work;
        const progress = progressByWork.get(work.id);
        const route = detailRoute(work);
        return (
          <Link
            key={item.id}
            to={route}
            state={{
              backTo: parentRoute,
              navigationOrigin,
            }}
            className={`tv-home-card${
              isActive && item.id === selectedId ? " is-selected" : ""
            }`}
            data-tv-focus-default={index === 0 && isActive ? true : undefined}
            data-navigation-focus-key={`playlists:${track.playlist.id}:${item.id}`}
            onClick={onNavigate}
            onFocus={(event) => {
              const section =
                event.currentTarget.closest<HTMLElement>(".tv-media-track");
              if (section) {
                onFocusItem(track.playlist.id, item.id, section);
              }
            }}
            onMouseEnter={() => onSelect(track.playlist.id, item.id)}
            {...mediaContext.itemProps({
              work,
              detailRoute: route,
              parentRoute,
              progress,
              playlistMembership: {
                playlistId: track.playlist.id,
                itemId: item.id,
                onChanged: (change) =>
                  onPlaylistItemChanged(change, work),
              },
            })}
          >
            <span className="tv-home-card-art">
              <CachedArtworkImage
                work={work}
                kinds={["backdrop", "poster"]}
                alt=""
                loading="lazy"
                fallback={<span>{work.title}</span>}
              />
              <WatchStateOverlay
                progress={progress}
                showUnwatched={progressReady}
              />
            </span>
            <strong>{work.title}</strong>
            <small>
              {work.kind === "site"
                ? "Site"
                : work.kind === "series"
                  ? "Series"
                  : "Movie"}
            </small>
          </Link>
        );
      })}
    </TvMediaTrack>
  );
}
