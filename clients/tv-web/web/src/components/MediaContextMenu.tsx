import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import {
  describeApiError,
  type PlaylistResponse,
  type WatchProgress,
  type Work,
  type WorkDetail,
} from "@streamarr-tv/api-client";
import { useApiClient } from "../lib/ApiClientProvider";
import { captureNavigationLayer } from "../lib/navigationLayer";
import { TvEmptyState } from "./tv/TvEmptyState";

const LONG_PRESS_MS = 650;

type ContextView = "actions" | "playlists" | "playlist-destinations";
type PlaylistPickerState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; playlists: PlaylistResponse[] }
  | { status: "error"; message: string };

function playlistDescendants(
  root: PlaylistResponse,
  playlists: PlaylistResponse[]
): Array<{ playlist: PlaylistResponse; parentPath: string }> {
  const childrenByParent = new Map<string, PlaylistResponse[]>();
  for (const playlist of playlists) {
    if (!playlist.parent_playlist_id) continue;
    const children = childrenByParent.get(playlist.parent_playlist_id) ?? [];
    children.push(playlist);
    childrenByParent.set(playlist.parent_playlist_id, children);
  }
  for (const children of childrenByParent.values()) {
    children.sort((left, right) =>
      left.name.localeCompare(right.name, undefined, {
        numeric: true,
        sensitivity: "base",
      })
    );
  }

  const descendants: Array<{
    playlist: PlaylistResponse;
    parentPath: string;
  }> = [];
  const visited = new Set([root.id]);
  const visit = (parent: PlaylistResponse, path: string[]) => {
    for (const child of childrenByParent.get(parent.id) ?? []) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      descendants.push({
        playlist: child,
        parentPath: path.join(" › "),
      });
      visit(child, [...path, child.name]);
    }
  };
  visit(root, [root.name]);
  return descendants;
}

export interface MediaContextItem {
  work?: Work;
  workId?: string;
  title?: string;
  detailRoute: string;
  parentRoute: string;
  progress?: WatchProgress;
  preferredMediaFileId?: string | null;
  preferredEpisodeId?: string | null;
  /** Exact leaf or leaves represented by this UI item. */
  leaves?: PlayableLeaf[];
  /** Preserve a surface's specialised short action, e.g. chapter offset or playlist selection. */
  onPlay?: () => void;
  activateOrigin?: boolean;
  startPositionSeconds?: number;
  playlistMembership?: {
    playlistId: string;
    itemId: string;
    onChanged?: (change: PlaylistMembershipChange) => void;
  };
}

export type PlaylistMembershipChange =
  | {
      type: "removed";
      playlistId: string;
      itemId: string;
    }
  | {
      type: "moved";
      playlistId: string;
      itemId: string;
      destinationPlaylistId: string;
      destinationItemId: string;
    };

export interface PlayableLeaf {
  mediaFileId: string;
  runtimeMs: number;
  episodeId?: string;
  title: string;
  seriesTitle?: string;
  seasonNumber?: number;
  episodeNumber?: number;
}

interface MediaContextMenuOptions {
  onProgressChanged?: (
    workId: string,
    progress: WatchProgress[]
  ) => void;
}

function playableLeaves(detail: WorkDetail): PlayableLeaf[] {
  if (detail.media_file_id) {
    return [
      {
        mediaFileId: detail.media_file_id,
        runtimeMs: detail.runtime_ms ?? 0,
        title: detail.work.title,
      },
    ];
  }

  if (typeof detail.children !== "object" || detail.children === null) {
    return [];
  }

  if ("Series" in detail.children) {
    return [...detail.children.Series]
      .sort((left, right) => left.season.season_number - right.season.season_number)
      .flatMap((season) =>
        [...season.episodes]
          .sort(
            (left, right) =>
              left.episode.episode_number - right.episode.episode_number
          )
          .flatMap((episode) =>
            episode.media_file_id
              ? [
                  {
                    mediaFileId: episode.media_file_id,
                    runtimeMs: episode.runtime_ms ?? 0,
                    episodeId: episode.episode.id,
                    title:
                      episode.episode.title ??
                      `Episode ${episode.episode.episode_number}`,
                    seriesTitle: detail.work.title,
                    seasonNumber: season.season.season_number,
                    episodeNumber: episode.episode.episode_number,
                  },
                ]
              : []
          )
      );
  }

  if ("Artist" in detail.children) {
    return detail.children.Artist.flatMap((album) =>
      album.tracks.flatMap((track) =>
        track.media_file_id
          ? [
              {
                mediaFileId: track.media_file_id,
                runtimeMs:
                  track.runtime_ms ?? (track.track.duration_seconds ?? 0) * 1_000,
                title: track.track.title,
              },
            ]
          : []
      )
    );
  }

  return [];
}

/**
 * Reusable TV media-item actions. A short Enter remains the element's
 * normal click, while holding Enter or using the browser context-menu
 * gesture opens a remote-friendly action drawer.
 */
export function useMediaContextMenu({
  onProgressChanged,
}: MediaContextMenuOptions = {}) {
  const client = useApiClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [activeItem, setActiveItem] = useState<MediaContextItem | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contextView, setContextView] = useState<ContextView>("actions");
  const [playlistPicker, setPlaylistPicker] = useState<PlaylistPickerState>({
    status: "idle",
  });
  const [selectedPlaylist, setSelectedPlaylist] =
    useState<PlaylistResponse | null>(null);
  const originRef = useRef<HTMLElement | null>(null);
  const firstActionRef = useRef<HTMLButtonElement>(null);
  const addToPlaylistRef = useRef<HTMLButtonElement>(null);
  const firstPlaylistRef = useRef<HTMLButtonElement>(null);
  const playlistBackRef = useRef<HTMLButtonElement>(null);
  const longPressTimerRef = useRef<number | undefined>(undefined);
  const longPressTriggeredRef = useRef(false);
  const confirmHeldRef = useRef(false);
  const suppressNextKeyboardClickRef = useRef(false);
  const suppressClickTimerRef = useRef<number | undefined>(undefined);
  const suppressOriginReleaseRef = useRef(false);
  const playlistActionInFlightRef = useRef(false);
  const detailCacheRef = useRef(new Map<string, Promise<WorkDetail>>());

  const clearLongPress = useCallback(() => {
    window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = undefined;
  }, []);

  const suppressReleaseClick = useCallback(() => {
    window.clearTimeout(suppressClickTimerRef.current);
    suppressNextKeyboardClickRef.current = true;
    suppressClickTimerRef.current = window.setTimeout(() => {
      suppressNextKeyboardClickRef.current = false;
    }, 180);
  }, []);

  const suppressOriginRelease = useCallback(() => {
    suppressOriginReleaseRef.current = true;
  }, []);

  useEffect(() => {
    const consumeOriginRelease = (event: globalThis.KeyboardEvent) => {
      if (
        !suppressOriginReleaseRef.current ||
        (event.key !== "Enter" &&
          event.key !== "Accept" &&
          event.keyCode !== 13)
      ) {
        return;
      }
      suppressOriginReleaseRef.current = false;
      event.preventDefault();
      event.stopImmediatePropagation();
      suppressReleaseClick();
      longPressTriggeredRef.current = false;
    };

    window.addEventListener("keyup", consumeOriginRelease, true);
    return () => window.removeEventListener("keyup", consumeOriginRelease, true);
  }, [suppressReleaseClick]);

  const open = useCallback((item: MediaContextItem, origin: HTMLElement, confirmHeld = false) => {
    clearLongPress();
    originRef.current = origin;
    confirmHeldRef.current = confirmHeld;
    setError(null);
    setBusyAction(null);
    setContextView("actions");
    setPlaylistPicker({ status: "idle" });
    setSelectedPlaylist(null);
    playlistActionInFlightRef.current = false;
    setActiveItem(item);
  }, [clearLongPress]);

  const close = useCallback(() => {
    clearLongPress();
    setActiveItem(null);
    setError(null);
    setBusyAction(null);
    setContextView("actions");
    setPlaylistPicker({ status: "idle" });
    setSelectedPlaylist(null);
    playlistActionInFlightRef.current = false;
    window.requestAnimationFrame(() => originRef.current?.focus({ preventScroll: true }));
  }, [clearLongPress]);

  const focusFirstAction = useCallback(() => {
    if (!activeItem || confirmHeldRef.current) return;
    const frame = window.requestAnimationFrame(() => firstActionRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [activeItem]);

  useEffect(() => focusFirstAction(), [focusFirstAction]);

  useEffect(() => {
    if (
      !activeItem ||
      (contextView !== "playlists" &&
        contextView !== "playlist-destinations")
    ) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      (firstPlaylistRef.current ?? playlistBackRef.current)?.focus({
        preventScroll: true,
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeItem, contextView, playlistPicker]);

  useEffect(
    () => () => {
      clearLongPress();
      window.clearTimeout(suppressClickTimerRef.current);
    },
    [clearLongPress]
  );

  const getDetail = useCallback(
    (workId: string) => {
      const cached = detailCacheRef.current.get(workId);
      if (cached) return cached;
      const request = client.getWork(workId);
      detailCacheRef.current.set(workId, request);
      void request.catch(() => detailCacheRef.current.delete(workId));
      return request;
    },
    [client]
  );

  const play = useCallback(async () => {
    if (!activeItem || busyAction) return;
    setBusyAction("play");
    setError(null);
    try {
      if (activeItem.activateOrigin) {
        originRef.current?.click();
        close();
        return;
      }
      if (activeItem.onPlay) {
        activeItem.onPlay();
        close();
        return;
      }
      const navigationOrigin = captureNavigationLayer(
        location.pathname,
        location.key,
        originRef.current
      );
      const workId = activeItem.work?.id ?? activeItem.workId;
      const leaves =
        activeItem.leaves ??
        (workId ? playableLeaves(await getDetail(workId)) : []);
      const preferredMediaFileId =
        activeItem.preferredMediaFileId ?? activeItem.progress?.media_file_id;
      const leaf =
        leaves.find((candidate) => candidate.mediaFileId === preferredMediaFileId) ??
        leaves[0];
      if (!leaf) throw new Error("No playable media is available for this title.");

      navigate(`/player/${leaf.mediaFileId}`, {
        state: {
          title: leaf.title,
          backTo: activeItem.detailRoute,
          detailParentBackTo: activeItem.parentRoute,
          episodeId: activeItem.preferredEpisodeId ?? leaf.episodeId,
          mediaFileId: leaf.mediaFileId,
          playlistItems: leaves.map((item) => ({
            mediaFileId: item.mediaFileId,
            title: item.title,
            subtitle: item.seriesTitle,
            episodeId: item.episodeId,
            seasonNumber: item.seasonNumber,
            episodeNumber: item.episodeNumber,
          })),
          startPositionSeconds:
            activeItem.startPositionSeconds ??
            (activeItem.progress?.media_file_id === leaf.mediaFileId &&
            activeItem.progress.state === "part_watched"
              ? activeItem.progress.position_ms / 1000
              : undefined),
          navigationOrigin,
        },
      });
    } catch (caught) {
      setBusyAction(null);
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [activeItem, busyAction, close, getDetail, location.key, location.pathname, navigate]);

  const setWatched = useCallback(
    async (watched: boolean) => {
      if (!activeItem || busyAction) return;
      setBusyAction(watched ? "watched" : "unwatched");
      setError(null);
      try {
        const workId = activeItem.work?.id ?? activeItem.workId;
        const [resolvedLeaves, currentProgress] = await Promise.all([
          activeItem.leaves
            ? Promise.resolve(activeItem.leaves)
            : workId
              ? getDetail(workId).then(playableLeaves)
              : Promise.resolve([]),
          client.listWatchProgress(),
        ]);
        const leaves = resolvedLeaves;
        if (leaves.length === 0) {
          throw new Error("No playable media is available for this title.");
        }
        const progressByFile = new Map(
          currentProgress.map((progress) => [progress.media_file_id, progress])
        );
        const updated: WatchProgress[] = [];
        for (let index = 0; index < leaves.length; index += 8) {
          const batch = await Promise.all(
            leaves.slice(index, index + 8).map((leaf) => {
              const previous = progressByFile.get(leaf.mediaFileId);
              const durationMs = leaf.runtimeMs || previous?.duration_ms || 0;
              return client.updateWatchProgress(leaf.mediaFileId, {
                positionMs: watched ? durationMs : 0,
                durationMs,
                completed: watched,
              });
            })
          );
          updated.push(...batch);
        }
        onProgressChanged?.(workId ?? "", updated);
        close();
      } catch (caught) {
        setBusyAction(null);
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    },
    [activeItem, busyAction, client, close, getDetail, onProgressChanged]
  );

  const returnToActions = useCallback(() => {
    setContextView("actions");
    setError(null);
    setBusyAction(null);
    window.requestAnimationFrame(() =>
      addToPlaylistRef.current?.focus({ preventScroll: true })
    );
  }, []);

  const returnToPlaylistRoots = useCallback(() => {
    setContextView("playlists");
    setSelectedPlaylist(null);
    setError(null);
    setBusyAction(null);
  }, []);

  const openPlaylistPicker = useCallback(async () => {
    if (!activeItem?.work || busyAction) return;
    const movingPlaylistItem = Boolean(activeItem.playlistMembership);
    setContextView(
      movingPlaylistItem ? "playlist-destinations" : "playlists"
    );
    setError(null);
    setPlaylistPicker({ status: "loading" });
    try {
      const playlists = (await client.listPlaylists())
        .filter((playlist) => !playlist.is_system)
        .sort((left, right) =>
          left.name.localeCompare(right.name, undefined, {
            numeric: true,
            sensitivity: "base",
          })
        );
      setPlaylistPicker({ status: "ready", playlists });
      if (movingPlaylistItem) {
        const currentPlaylist = playlists.find(
          (playlist) =>
            playlist.id === activeItem.playlistMembership?.playlistId
        );
        let rootPlaylist = currentPlaylist ?? null;
        const byId = new Map(
          playlists.map((playlist) => [playlist.id, playlist])
        );
        const visited = new Set(
          rootPlaylist ? [rootPlaylist.id] : []
        );
        while (rootPlaylist?.parent_playlist_id) {
          const parentId = rootPlaylist.parent_playlist_id;
          if (visited.has(parentId)) break;
          const parent = byId.get(parentId);
          if (!parent) break;
          visited.add(parent.id);
          rootPlaylist = parent;
        }
        setSelectedPlaylist(rootPlaylist);
      } else {
        setSelectedPlaylist(null);
      }
    } catch (caught) {
      setPlaylistPicker({
        status: "error",
        message: describeApiError(caught),
      });
    }
  }, [activeItem, busyAction, client]);

  const addToPlaylist = useCallback(
    async (playlist: PlaylistResponse, keyboardActivation = false) => {
      const work = activeItem?.work;
      if (!work || busyAction || playlistActionInFlightRef.current) return;
      playlistActionInFlightRef.current = true;
      if (keyboardActivation) suppressOriginRelease();
      setBusyAction(`playlist:${playlist.id}`);
      setError(null);
      try {
        const existingItems = await client.listPlaylistItems(playlist.id);
        if (existingItems.some((item) => item.work_id === work.id)) {
          throw new Error(`${work.title} is already in ${playlist.name}.`);
        }
        await client.addPlaylistItem(playlist.id, { work_id: work.id });
        close();
      } catch (caught) {
        playlistActionInFlightRef.current = false;
        setBusyAction(null);
        setError(
          caught instanceof Error ? caught.message : describeApiError(caught)
        );
      }
    },
    [activeItem, busyAction, client, close, suppressOriginRelease]
  );

  const choosePlaylist = useCallback(
    (playlist: PlaylistResponse, keyboardActivation = false) => {
      if (playlistPicker.status !== "ready") return;
      const hasSubPlaylists = playlistPicker.playlists.some(
        (candidate) => candidate.parent_playlist_id === playlist.id
      );
      if (!hasSubPlaylists) {
        void addToPlaylist(playlist, keyboardActivation);
        return;
      }
      setSelectedPlaylist(playlist);
      setContextView("playlist-destinations");
      setError(null);
    },
    [addToPlaylist, playlistPicker]
  );

  const movePlaylistItem = useCallback(
    async (playlist: PlaylistResponse, keyboardActivation = false) => {
      const work = activeItem?.work;
      const membership = activeItem?.playlistMembership;
      if (
        !work ||
        !membership ||
        playlist.id === membership.playlistId ||
        busyAction ||
        playlistActionInFlightRef.current
      ) {
        return;
      }
      playlistActionInFlightRef.current = true;
      if (keyboardActivation) suppressOriginRelease();
      setBusyAction(`playlist:${playlist.id}`);
      setError(null);
      try {
        const existingItems = await client.listPlaylistItems(playlist.id);
        if (existingItems.some((item) => item.work_id === work.id)) {
          throw new Error(`${work.title} is already in ${playlist.name}.`);
        }
        const destinationItem = await client.addPlaylistItem(playlist.id, {
          work_id: work.id,
        });
        try {
          await client.removePlaylistItem(
            membership.playlistId,
            membership.itemId
          );
        } catch (caught) {
          await client
            .removePlaylistItem(playlist.id, destinationItem.id)
            .catch(() => undefined);
          throw caught;
        }
        membership.onChanged?.({
          type: "moved",
          playlistId: membership.playlistId,
          itemId: membership.itemId,
          destinationPlaylistId: playlist.id,
          destinationItemId: destinationItem.id,
        });
        close();
      } catch (caught) {
        playlistActionInFlightRef.current = false;
        setBusyAction(null);
        setError(
          caught instanceof Error ? caught.message : describeApiError(caught)
        );
      }
    },
    [activeItem, busyAction, client, close, suppressOriginRelease]
  );

  const removeFromPlaylist = useCallback(
    async (keyboardActivation = false) => {
      const membership = activeItem?.playlistMembership;
      if (
        !membership ||
        busyAction ||
        playlistActionInFlightRef.current
      ) {
        return;
      }
      playlistActionInFlightRef.current = true;
      if (keyboardActivation) suppressOriginRelease();
      setBusyAction("playlist:remove");
      setError(null);
      try {
        await client.removePlaylistItem(
          membership.playlistId,
          membership.itemId
        );
        membership.onChanged?.({
          type: "removed",
          playlistId: membership.playlistId,
          itemId: membership.itemId,
        });
        close();
      } catch (caught) {
        playlistActionInFlightRef.current = false;
        setBusyAction(null);
        setError(
          caught instanceof Error ? caught.message : describeApiError(caught)
        );
      }
    },
    [activeItem, busyAction, client, close, suppressOriginRelease]
  );

  const itemProps = useCallback(
    (item: MediaContextItem) => ({
      onContextMenu: (event: ReactMouseEvent<HTMLElement>) => {
        event.preventDefault();
        event.stopPropagation();
        open(item, event.currentTarget, false);
      },
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        const isConfirm =
          event.key === "Enter" ||
          event.key === "Accept" ||
          event.keyCode === 13;
        if (!isConfirm) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) return;
        clearLongPress();
        longPressTriggeredRef.current = false;
        const origin = event.currentTarget;
        longPressTimerRef.current = window.setTimeout(() => {
          longPressTriggeredRef.current = true;
          open(item, origin, true);
        }, LONG_PRESS_MS);
      },
      onKeyUp: (event: KeyboardEvent<HTMLElement>) => {
        const isConfirm =
          event.key === "Enter" ||
          event.key === "Accept" ||
          event.keyCode === 13;
        if (!isConfirm) return;
        event.preventDefault();
        event.stopPropagation();
        clearLongPress();
        if (suppressOriginReleaseRef.current) {
          suppressOriginReleaseRef.current = false;
          suppressReleaseClick();
          longPressTriggeredRef.current = false;
          return;
        }
        if (!longPressTriggeredRef.current) {
          event.currentTarget.click();
        } else {
          confirmHeldRef.current = false;
          suppressReleaseClick();
          window.requestAnimationFrame(() => firstActionRef.current?.focus());
        }
        longPressTriggeredRef.current = false;
      },
      onBlur: clearLongPress,
    }),
    [clearLongPress, open, suppressReleaseClick]
  );

  const canAddToPlaylist =
    activeItem?.work?.kind === "movie" || activeItem?.work?.kind === "series";
  const isPlaylistItem = Boolean(activeItem?.playlistMembership);

  const contextMenu = activeItem ? (
    <div
      className="media-context-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <aside
        className="media-context-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`${
          activeItem.work?.title ?? activeItem.title ?? "Media"
        } ${contextView === "actions" ? "actions" : "playlist picker"}`}
        onClickCapture={(event) => {
          if (!suppressNextKeyboardClickRef.current || event.detail !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          suppressNextKeyboardClickRef.current = false;
        }}
        onKeyUpCapture={(event) => {
          if (
            event.key !== "Enter" &&
            event.key !== "Accept" &&
            event.keyCode !== 13
          ) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          confirmHeldRef.current = false;
          suppressReleaseClick();
          window.requestAnimationFrame(() => firstActionRef.current?.focus());
        }}
        onKeyDown={(event) => {
          const isBack =
            event.key === "Escape" ||
            event.key === "BrowserBack" ||
            event.key === "GoBack" ||
            event.keyCode === 10009 ||
            event.keyCode === 461;
          if (isBack || event.key === "ArrowLeft") {
            event.preventDefault();
            event.stopPropagation();
            if (contextView === "playlist-destinations") {
              if (isPlaylistItem) returnToActions();
              else returnToPlaylistRoots();
            } else if (contextView === "playlists") {
              returnToActions();
            } else {
              close();
            }
            return;
          }
          if (event.key === "ArrowRight") {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
          event.preventDefault();
          event.stopPropagation();
          const actions = Array.from(
            event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")
          );
          const currentIndex = actions.indexOf(document.activeElement as HTMLButtonElement);
          const delta = event.key === "ArrowDown" ? 1 : -1;
          actions[(currentIndex + delta + actions.length) % actions.length]?.focus();
        }}
      >
        {contextView === "actions" ? (
          <>
            <header>
              <p>Title actions</p>
              <h2>{activeItem.work?.title ?? activeItem.title ?? "Media"}</h2>
            </header>
            <div className="media-context-actions">
              <button ref={firstActionRef} type="button" disabled={Boolean(busyAction)} onClick={play}>
                <span aria-hidden="true">▶</span>
                <strong>{busyAction === "play" ? "Opening…" : "Play"}</strong>
              </button>
              {isPlaylistItem ? (
                <>
                  <button
                    ref={addToPlaylistRef}
                    type="button"
                    disabled={Boolean(busyAction)}
                    onClick={() => void openPlaylistPicker()}
                  >
                    <span aria-hidden="true">↔</span>
                    <strong>Move in playlist</strong>
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(busyAction)}
                    onClick={(event) =>
                      void removeFromPlaylist(event.detail === 0)
                    }
                  >
                    <span aria-hidden="true">−</span>
                    <strong>
                      {busyAction === "playlist:remove"
                        ? "Removing…"
                        : "Remove from playlist"}
                    </strong>
                  </button>
                </>
              ) : canAddToPlaylist ? (
                <button
                  ref={addToPlaylistRef}
                  type="button"
                  disabled={Boolean(busyAction)}
                  onClick={() => void openPlaylistPicker()}
                >
                  <span aria-hidden="true">＋</span>
                  <strong>Add to Playlist</strong>
                </button>
              ) : null}
              <button
                type="button"
                disabled={Boolean(busyAction)}
                onClick={() => void setWatched(true)}
              >
                <span aria-hidden="true">✓</span>
                <strong>{busyAction === "watched" ? "Updating…" : "Mark as Watched"}</strong>
              </button>
              <button
                type="button"
                disabled={Boolean(busyAction)}
                onClick={() => void setWatched(false)}
              >
                <span aria-hidden="true">○</span>
                <strong>{busyAction === "unwatched" ? "Updating…" : "Mark as Unwatched"}</strong>
              </button>
            </div>
          </>
        ) : contextView === "playlists" ? (
          <>
            <header className="media-context-playlist-header">
              <button
                ref={playlistBackRef}
                type="button"
                className="media-context-back"
                onClick={returnToActions}
              >
                <span aria-hidden="true">←</span>
                Back
              </button>
              <p>{isPlaylistItem ? "Move in playlist" : "Add to playlist"}</p>
              <h2>{activeItem.work?.title ?? "Media"}</h2>
            </header>
            <div className="media-context-actions media-context-playlist-actions">
              {playlistPicker.status === "loading" ? (
                <div className="media-context-state" role="status">
                  <span className="tv-mini-loader" aria-hidden="true" />
                  <p>Loading playlists…</p>
                </div>
              ) : playlistPicker.status === "error" ? (
                <TvEmptyState
                  graphic="playlist"
                  tone="error"
                  variant="compact"
                  title="Playlists could not be loaded"
                  description={playlistPicker.message}
                />
              ) : playlistPicker.status === "ready" &&
                playlistPicker.playlists.length ? (
                <>
                  <h3 className="media-context-group-heading">
                    Personal playlists
                  </h3>
                  {playlistPicker.playlists
                    .filter(
                      (playlist) =>
                        !playlist.parent_playlist_id ||
                        !playlistPicker.playlists.some(
                          (candidate) =>
                            candidate.id === playlist.parent_playlist_id
                        )
                    )
                    .map((playlist, index) => (
                      <button
                        key={playlist.id}
                        ref={index === 0 ? firstPlaylistRef : undefined}
                        type="button"
                        disabled={Boolean(busyAction)}
                        onClick={(event) =>
                          choosePlaylist(playlist, event.detail === 0)
                        }
                      >
                        <span aria-hidden="true">＋</span>
                        <strong>{playlist.name}</strong>
                      </button>
                    ))}
                </>
              ) : (
                <TvEmptyState
                  graphic="playlist"
                  variant="compact"
                  title="No personal playlists yet"
                  description="Create one from the Playlists page."
                />
              )}
            </div>
          </>
        ) : (
          <>
            <header className="media-context-playlist-header">
              <button
                ref={playlistBackRef}
                type="button"
                className="media-context-back"
                onClick={
                  isPlaylistItem ? returnToActions : returnToPlaylistRoots
                }
              >
                <span aria-hidden="true">←</span>
                Back
              </button>
              <p>{isPlaylistItem ? "Move in playlist" : "Add to playlist"}</p>
              <h2>{activeItem.work?.title ?? "Media"}</h2>
            </header>
            <div className="media-context-actions media-context-playlist-actions">
              {playlistPicker.status === "loading" ? (
                <div className="media-context-state" role="status">
                  <span className="tv-mini-loader" aria-hidden="true" />
                  <p>Loading playlists…</p>
                </div>
              ) : playlistPicker.status === "error" ? (
                <TvEmptyState
                  graphic="playlist"
                  tone="error"
                  variant="compact"
                  title="Playlists could not be loaded"
                  description={playlistPicker.message}
                />
              ) : selectedPlaylist && playlistPicker.status === "ready" ? (
                <>
                  <h3 className="media-context-group-heading">
                    {selectedPlaylist.name}
                  </h3>
                  {[
                    {
                      playlist: selectedPlaylist,
                      parentPath: "Top level",
                    },
                    ...playlistDescendants(
                      selectedPlaylist,
                      playlistPicker.playlists
                    ),
                  ]
                    .filter(
                      ({ playlist }) =>
                        playlist.id !==
                        activeItem.playlistMembership?.playlistId
                    )
                    .map(({ playlist, parentPath }, index) => (
                      <button
                        key={playlist.id}
                        ref={index === 0 ? firstPlaylistRef : undefined}
                        type="button"
                        disabled={Boolean(busyAction)}
                        onClick={(event) =>
                          void (isPlaylistItem
                            ? movePlaylistItem(
                                playlist,
                                event.detail === 0
                              )
                            : addToPlaylist(
                                playlist,
                                event.detail === 0
                              ))
                        }
                      >
                        <span aria-hidden="true">
                          {isPlaylistItem ? "↔" : "＋"}
                        </span>
                        <span>
                          <strong>{playlist.name}</strong>
                          <small>{parentPath}</small>
                        </span>
                      </button>
                    ))}
                </>
              ) : (
                <TvEmptyState
                  graphic="move"
                  variant="compact"
                  title="No playlist destinations are available"
                />
              )}
            </div>
          </>
        )}
        {error ? <p className="media-context-error" role="alert">{error}</p> : null}
      </aside>
    </div>
  ) : null;

  return {
    itemProps,
    contextMenu: contextMenu ? createPortal(contextMenu, document.body) : null,
    close,
    isOpen: activeItem !== null,
  };
}
