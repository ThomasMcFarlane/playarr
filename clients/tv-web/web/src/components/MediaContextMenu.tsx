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
} from "@playarr-tv/api-client";
import { useApiClient } from "../lib/ApiClientProvider";
import { useDownloads } from "../lib/DownloadsProvider";
import { useLanguage } from "../lib/i18n/LanguageProvider";
import type { TranslationKey } from "../lib/i18n/translations";
import { captureNavigationLayer } from "../lib/navigationLayer";
import { leafSubtitle, playableLeaves, type PlayableLeaf } from "../lib/playableLeaves";
import { useToast } from "../lib/toast";
import {
  DownloadQualityDrawer,
  type DownloadQualitySelection,
} from "./DownloadQualityDrawer";
import { Drawer } from "./shell";
import { Button } from "./ui";
import { TvEmptyState } from "./tv/TvEmptyState";
import { isBackKey } from "../lib/backKey";

const LONG_PRESS_MS = 650;
/** Download enqueue calls are heavier than a watch-progress PUT (each creates a server-side download ticket) -- a smaller batch than `setWatched`'s. */
const DOWNLOAD_BATCH_SIZE = 4;

type ContextView = "actions" | "playlists" | "playlist-destinations" | "download";
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
  /** A whole playlist represented by this UI item -- the Download action fans this out via `listPlaylistItems` + per-item detail resolution. */
  playlistId?: string;
  /** Preserve a surface's specialised short action, e.g. chapter offset or playlist selection. */
  onPlay?: () => void;
  activateOrigin?: boolean;
  startPositionSeconds?: number;
  /** Exact track represented by an audio item; `workId` is its artist work. */
  playlistTrackId?: string;
  /** Exact tracks represented by an audio album; `workId` is its artist work. */
  playlistTrackIds?: string[];
  playlistMembership?: {
    playlistId: string;
    itemId: string;
    onChanged?: (change: PlaylistMembershipChange) => void;
  };
}

interface PlaylistTarget {
  mediaType: PlaylistResponse["media_type"];
  workId: string;
  trackId?: string;
  trackIds?: string[];
  title: string;
}

function playlistTarget(item: MediaContextItem | null): PlaylistTarget | null {
  if (!item) return null;
  if (item.playlistTrackIds?.length && item.workId) {
    return {
      mediaType: "audio",
      workId: item.workId,
      trackIds: [...new Set(item.playlistTrackIds)],
      title: item.title ?? "Album",
    };
  }
  if (item.playlistTrackId && item.workId) {
    return {
      mediaType: "audio",
      workId: item.workId,
      trackId: item.playlistTrackId,
      title: item.title ?? "Track",
    };
  }
  if (item.work?.kind === "artist") {
    return {
      mediaType: "audio",
      workId: item.work.id,
      title: item.work.title,
    };
  }
  if (
    item.work &&
    (item.work.kind === "movie" ||
      item.work.kind === "series" ||
      item.work.kind === "site")
  ) {
    return {
      mediaType: "video",
      workId: item.work.id,
      title: item.work.title,
    };
  }
  return null;
}

function playableAudioTrackIds(detail: WorkDetail): string[] {
  if (
    typeof detail.children !== "object" ||
    detail.children === null ||
    !("Artist" in detail.children)
  ) {
    return [];
  }
  return [
    ...new Set(
      detail.children.Artist.flatMap((album) =>
        album.tracks.flatMap((track) =>
          track.media_file_id ? [track.track.id] : []
        )
      )
    )
  ];
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

interface MediaContextMenuOptions {
  onProgressChanged?: (
    workId: string,
    progress: WatchProgress[]
  ) => void;
}

/**
 * Resolves every leaf a playlist's items expand to -- an audio item's
 * `track_id` picks the one matching track out of its artist work's albums
 * (same lookup `pages/Playlists.tsx`'s local `resolveAudioTrack` does); a
 * video item has no `track_id` (Playarr playlists only ever add movies to a
 * video playlist, never a whole series), so it resolves via `playableLeaves`
 * on that work directly. Used by the Download action's Playlist container
 * fan-out (`playlistId` on a `MediaContextItem`) -- `listPlaylistItems` plus
 * one `getWork` per distinct work id referenced, same batching shape
 * `Playlists.tsx`'s own directory load already uses.
 */
async function resolvePlaylistLeaves(
  client: ReturnType<typeof useApiClient>,
  playlistId: string,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
): Promise<PlayableLeaf[]> {
  const items = await client.listPlaylistItems(playlistId);
  const workIds = [...new Set(items.map((item) => item.work_id))];
  const details = await Promise.all(
    workIds.map(async (workId): Promise<WorkDetail | null> => {
      try {
        return await client.getWork(workId);
      } catch {
        return null;
      }
    })
  );
  const detailByWorkId = new Map(
    details.filter((detail): detail is WorkDetail => detail !== null).map((detail) => [detail.work.id, detail])
  );
  return items.flatMap((item) => {
    const detail = detailByWorkId.get(item.work_id);
    if (!detail) return [];
    if (!item.track_id) {
      return playableLeaves(detail, t).map((leaf) => ({ ...leaf, workId: detail.work.id }));
    }
    const trackLeaves = playableLeaves(detail, t);
    // `playableLeaves` doesn't retain a track's id, so match by walking the
    // artist's albums directly for this one track id instead.
    if (typeof detail.children !== "object" || detail.children === null || !("Artist" in detail.children)) {
      return [];
    }
    for (const album of detail.children.Artist) {
      const track = album.tracks.find((candidate) => candidate.track.id === item.track_id);
      if (track?.media_file_id) {
        return [
          {
            mediaFileId: track.media_file_id,
            runtimeMs: track.runtime_ms ?? (track.track.duration_seconds ?? 0) * 1_000,
            title: track.track.title,
            seriesTitle: detail.work.title,
            albumTitle: album.album.title,
            workKind: detail.work.kind,
            workId: detail.work.id,
          },
        ];
      }
    }
    return trackLeaves.length === 1
      ? trackLeaves.map((leaf) => ({ ...leaf, workId: detail.work.id }))
      : [];
  });
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
  const downloads = useDownloads();
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [activeItem, setActiveItem] = useState<MediaContextItem | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contextView, setContextView] = useState<ContextView>("actions");
  const [playlistPicker, setPlaylistPicker] = useState<PlaylistPickerState>({
    status: "idle",
  });
  const [selectedPlaylist, setSelectedPlaylist] =
    useState<PlaylistResponse | null>(null);
  const [downloadLeaves, setDownloadLeaves] = useState<PlayableLeaf[]>([]);
  const [downloadBusy, setDownloadBusy] = useState(false);
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
    setDownloadLeaves([]);
    setDownloadBusy(false);
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
    setDownloadLeaves([]);
    setDownloadBusy(false);
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
        (workId ? playableLeaves(await getDetail(workId), t) : []);
      const preferredMediaFileId =
        activeItem.preferredMediaFileId ?? activeItem.progress?.media_file_id;
      const leaf =
        leaves.find((candidate) => candidate.mediaFileId === preferredMediaFileId) ??
        leaves[0];
      if (!leaf) throw new Error(t("components.mediaContextMenu.noPlayableMedia"));

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
  }, [activeItem, busyAction, close, getDetail, location.key, location.pathname, navigate, t]);

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
              ? getDetail(workId).then((detail) => playableLeaves(detail, t))
              : Promise.resolve([]),
          client.listWatchProgress(),
        ]);
        const leaves = resolvedLeaves;
        if (leaves.length === 0) {
          throw new Error(t("components.mediaContextMenu.noPlayableMedia"));
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
        showToast(
          watched
            ? t("components.mediaContextMenu.markedWatched")
            : t("components.mediaContextMenu.markedUnwatched")
        );
      } catch (caught) {
        setBusyAction(null);
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    },
    [activeItem, busyAction, client, close, getDetail, onProgressChanged, showToast, t]
  );

  /**
   * Resolves this item's leaf/leaves and opens the quality/keep-until
   * picker (`contextView: "download"`) -- fans out exactly like `play`/
   * `setWatched` for a Series/Artist/Site/Album (`activeItem.leaves` when
   * explicit, else `playableLeaves` off the resolved work detail), plus a
   * Playlist container via `activeItem.playlistId` (`resolvePlaylistLeaves`).
   * The actual enqueue happens in `confirmDownload` once the drawer
   * resolves a quality + keep-until choice.
   */
  const download = useCallback(async () => {
    if (!activeItem || busyAction) return;
    setBusyAction("download");
    setError(null);
    try {
      let leaves = activeItem.leaves;
      if (!leaves) {
        if (activeItem.playlistId) {
          leaves = await resolvePlaylistLeaves(client, activeItem.playlistId, t);
        } else {
          const workId = activeItem.work?.id ?? activeItem.workId;
          leaves = workId ? playableLeaves(await getDetail(workId), t) : [];
        }
      }
      if (leaves.length === 0) {
        throw new Error(t("components.mediaContextMenu.noPlayableMedia"));
      }
      setDownloadLeaves(leaves);
      setContextView("download");
      setBusyAction(null);
    } catch (caught) {
      setBusyAction(null);
      setError(
        caught instanceof Error ? caught.message : describeApiError(caught)
      );
    }
  }, [activeItem, busyAction, client, getDetail, t]);

  const confirmDownload = useCallback(
    async (selection: DownloadQualitySelection) => {
      if (downloadBusy || downloadLeaves.length === 0) return;
      setDownloadBusy(true);
      setError(null);
      try {
        const fallbackWorkId = activeItem?.work?.id ?? activeItem?.workId ?? "";
        for (let index = 0; index < downloadLeaves.length; index += DOWNLOAD_BATCH_SIZE) {
          const batch = downloadLeaves.slice(index, index + DOWNLOAD_BATCH_SIZE);
          await Promise.all(
            batch.map((leaf) =>
              downloads.enqueue({
                workId: leaf.workId ?? fallbackWorkId,
                workKind: leaf.workKind ?? activeItem?.work?.kind,
                mediaFileId: leaf.mediaFileId,
                title: leaf.title,
                subtitle: leafSubtitle(leaf),
                runtimeMs: leaf.runtimeMs,
                qualityId: selection.qualityId,
                qualityLabel: selection.qualityLabel,
                keepUntil: selection.keepUntil,
              })
            )
          );
        }
        const title =
          activeItem?.title ??
          activeItem?.work?.title ??
          t("components.mediaContextMenu.genericTitle");
        close();
        showToast(
          downloadLeaves.length === 1
            ? t("components.mediaContextMenu.downloadStarted", { title })
            : t("components.mediaContextMenu.downloadsStarted", {
                count: downloadLeaves.length,
              })
        );
      } catch (caught) {
        setDownloadBusy(false);
        setError(
          caught instanceof Error ? caught.message : describeApiError(caught)
        );
      }
    },
    [activeItem, close, downloadBusy, downloadLeaves, downloads, showToast, t]
  );

  const returnToActions = useCallback(() => {
    setContextView("actions");
    setError(null);
    setBusyAction(null);
    setDownloadLeaves([]);
    setDownloadBusy(false);
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
    const target = playlistTarget(activeItem);
    if (!target || busyAction) return;
    const membership = activeItem?.playlistMembership;
    const movingPlaylistItem = Boolean(membership);
    setContextView(
      movingPlaylistItem ? "playlist-destinations" : "playlists"
    );
    setError(null);
    setPlaylistPicker({ status: "loading" });
    try {
      const playlists = (await client.listPlaylists())
        .filter(
          (playlist) =>
            !playlist.is_system && playlist.media_type === target.mediaType
        )
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
            playlist.id === membership?.playlistId
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

  /**
   * Opens the drawer straight on one action, for a visible button instead of a
   * hold gesture: the Add to Playlist button on a title and the season
   * Download button. The action runs once the item is active.
   */
  const [pendingAction, setPendingAction] = useState<"playlists" | "download" | null>(null);
  const openAction = useCallback(
    (action: "playlists" | "download", item: MediaContextItem, origin: HTMLElement) => {
      open(item, origin, false);
      setPendingAction(action);
    },
    [open]
  );
  useEffect(() => {
    if (!pendingAction || !activeItem) return;
    setPendingAction(null);
    if (pendingAction === "playlists") void openPlaylistPicker();
    else void download();
  }, [activeItem, download, openPlaylistPicker, pendingAction]);

  const addToPlaylist = useCallback(
    async (playlist: PlaylistResponse, keyboardActivation = false) => {
      const target = playlistTarget(activeItem);
      if (!target || busyAction || playlistActionInFlightRef.current) return;
      playlistActionInFlightRef.current = true;
      if (keyboardActivation) suppressOriginRelease();
      setBusyAction(`playlist:${playlist.id}`);
      setError(null);
      try {
        const trackIds =
          target.mediaType === "audio"
            ? target.trackIds ??
              (target.trackId
                ? [target.trackId]
                : playableAudioTrackIds(await getDetail(target.workId)))
            : [undefined];
        if (trackIds.length === 0) {
          throw new Error(t("components.mediaContextMenu.noPlayableMedia"));
        }
        const existingItems = await client.listPlaylistItems(playlist.id);
        const missingTrackIds = trackIds.filter(
          (trackId) =>
            !existingItems.some(
              (item) =>
                item.work_id === target.workId &&
                (item.track_id ?? undefined) === trackId
            )
        );
        if (missingTrackIds.length === 0) {
          throw new Error(
            t("components.mediaContextMenu.alreadyInPlaylist", {
              title: target.title,
              playlist: playlist.name,
            })
          );
        }
        const addedItemIds: string[] = [];
        try {
          for (const trackId of missingTrackIds) {
            const added = await client.addPlaylistItem(playlist.id, {
              work_id: target.workId,
              track_id: trackId,
            });
            addedItemIds.push(added.id);
          }
        } catch (caught) {
          await Promise.all(
            addedItemIds.map((itemId) =>
              client
                .removePlaylistItem(playlist.id, itemId)
                .catch(() => undefined)
            )
          );
          throw caught;
        }
        close();
        showToast(
          t("components.mediaContextMenu.addedToPlaylist", {
            title: target.title,
            playlist: playlist.name,
          })
        );
      } catch (caught) {
        playlistActionInFlightRef.current = false;
        setBusyAction(null);
        setError(
          caught instanceof Error ? caught.message : describeApiError(caught)
        );
      }
    },
    [
      activeItem,
      busyAction,
      client,
      close,
      getDetail,
      showToast,
      suppressOriginRelease,
      t,
    ]
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
      const target = playlistTarget(activeItem);
      const membership = activeItem?.playlistMembership;
      if (
        !target ||
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
        if (
          existingItems.some(
            (item) =>
              item.work_id === target.workId &&
              (item.track_id ?? undefined) === target.trackId
          )
        ) {
          throw new Error(
            t("components.mediaContextMenu.alreadyInPlaylist", {
              title: target.title,
              playlist: playlist.name,
            })
          );
        }
        const destinationItem = await client.addPlaylistItem(playlist.id, {
          work_id: target.workId,
          track_id: target.trackId,
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
        showToast(
          t("components.mediaContextMenu.movedToPlaylist", {
            title: target.title,
            playlist: playlist.name,
          })
        );
      } catch (caught) {
        playlistActionInFlightRef.current = false;
        setBusyAction(null);
        setError(
          caught instanceof Error ? caught.message : describeApiError(caught)
        );
      }
    },
    [activeItem, busyAction, client, close, showToast, suppressOriginRelease, t]
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
        const title =
          activeItem.title ??
          activeItem.work?.title ??
          t("components.mediaContextMenu.genericItem");
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
        showToast(
          t("components.mediaContextMenu.removedFromPlaylist", { title })
        );
      } catch (caught) {
        playlistActionInFlightRef.current = false;
        setBusyAction(null);
        setError(
          caught instanceof Error ? caught.message : describeApiError(caught)
        );
      }
    },
    [activeItem, busyAction, client, close, showToast, suppressOriginRelease, t]
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

  const canAddToPlaylist = Boolean(playlistTarget(activeItem));
  const isPlaylistItem = Boolean(activeItem?.playlistMembership);

  const contextMenu = activeItem ? (
    <div
      className="media-context-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      {contextView === "download" ? (
        <DownloadQualityDrawer
          title={
            activeItem.title ??
            activeItem.work?.title ??
            t("components.mediaContextMenu.genericTitle")
          }
          leaves={downloadLeaves}
          busy={downloadBusy}
          onClose={returnToActions}
          onConfirm={(selection) => void confirmDownload(selection)}
          confirmLabel={
            downloadLeaves.length > 1
              ? t("components.mediaContextMenu.downloadCount", {
                  count: downloadLeaves.length,
                })
              : undefined
          }
        />
      ) : (
      <Drawer
        className="media-context-drawer"
        initialFocus="none"
        ariaLabel={
          contextView === "actions"
            ? t("components.mediaContextMenu.dialogAriaLabelActions", {
                title:
                  activeItem.title ??
                  activeItem.work?.title ??
                  t("components.mediaContextMenu.genericTitle"),
              })
            : t("components.mediaContextMenu.dialogAriaLabelPlaylistPicker", {
                title:
                  activeItem.title ??
                  activeItem.work?.title ??
                  t("components.mediaContextMenu.genericTitle"),
              })
        }
        kicker={
          contextView === "actions"
            ? t("components.mediaContextMenu.titleActionsHeading")
            : isPlaylistItem
              ? t("components.mediaContextMenu.moveInPlaylist")
              : t("components.mediaContextMenu.addToPlaylistHeading")
        }
        title={
          activeItem.title ??
          activeItem.work?.title ??
          t("components.mediaContextMenu.genericTitle")
        }
        closeLabel={t("components.mediaContextMenu.close")}
        onClose={close}
        containerProps={{
          onClickCapture: (event) => {
            if (!suppressNextKeyboardClickRef.current || event.detail !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            suppressNextKeyboardClickRef.current = false;
          },
          onKeyUpCapture: (event) => {
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
          },
        }}
        onKeyDown={(event) => {
          const isBack =
            isBackKey(event);
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
            event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled):not(.drawer-close)")
          );
          const currentIndex = actions.indexOf(document.activeElement as HTMLButtonElement);
          const delta = event.key === "ArrowDown" ? 1 : -1;
          actions[(currentIndex + delta + actions.length) % actions.length]?.focus();
        }}
      >
        {contextView === "actions" ? (
          <>
            <div className="media-context-actions">
              <button ref={firstActionRef} type="button" disabled={Boolean(busyAction)} onClick={play}>
                <span aria-hidden="true">▶</span>
                <strong>
                  {busyAction === "play"
                    ? t("components.mediaContextMenu.opening")
                    : t("components.mediaContextMenu.play")}
                </strong>
              </button>
              {downloads.canDownload === true ? (
                <button
                  type="button"
                  disabled={Boolean(busyAction)}
                  onClick={() => void download()}
                >
                  <span aria-hidden="true">⇩</span>
                  <strong>
                    {busyAction === "download"
                      ? t("components.mediaContextMenu.opening")
                      : t("components.mediaContextMenu.download")}
                  </strong>
                </button>
              ) : null}
              {isPlaylistItem ? (
                <>
                  <button
                    ref={addToPlaylistRef}
                    type="button"
                    disabled={Boolean(busyAction)}
                    onClick={() => void openPlaylistPicker()}
                  >
                    <span aria-hidden="true">↔</span>
                    <strong>{t("components.mediaContextMenu.moveInPlaylist")}</strong>
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
                        ? t("components.mediaContextMenu.removing")
                        : t("components.mediaContextMenu.removeFromPlaylist")}
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
                  <strong>{t("components.mediaContextMenu.addToPlaylist")}</strong>
                </button>
              ) : null}
              <button
                type="button"
                disabled={Boolean(busyAction)}
                onClick={() => void setWatched(true)}
              >
                <span aria-hidden="true">✓</span>
                <strong>
                  {busyAction === "watched"
                    ? t("components.mediaContextMenu.updating")
                    : t("components.mediaContextMenu.markAsWatched")}
                </strong>
              </button>
              <button
                type="button"
                disabled={Boolean(busyAction)}
                onClick={() => void setWatched(false)}
              >
                <span aria-hidden="true">○</span>
                <strong>
                  {busyAction === "unwatched"
                    ? t("components.mediaContextMenu.updating")
                    : t("components.mediaContextMenu.markAsUnwatched")}
                </strong>
              </button>
            </div>
          </>
        ) : contextView === "playlists" ? (
          <>
              <Button
                variant="ghost"
                size="sm"
                ref={playlistBackRef}
                type="button"
                className="media-context-back"
                onClick={returnToActions}
              >
                <span aria-hidden="true">←</span>
                {t("components.mediaContextMenu.back")}
              </Button>
            <div className="media-context-actions media-context-playlist-actions">
              {playlistPicker.status === "loading" ? (
                <div className="media-context-state" role="status">
                  <span className="tv-mini-loader" aria-hidden="true" />
                  <p>{t("components.mediaContextMenu.loadingPlaylists")}</p>
                </div>
              ) : playlistPicker.status === "error" ? (
                <TvEmptyState
                  graphic="playlist"
                  tone="error"
                  variant="compact"
                  title={t("components.mediaContextMenu.playlistsLoadError")}
                  description={playlistPicker.message}
                />
              ) : playlistPicker.status === "ready" &&
                playlistPicker.playlists.length ? (
                <>
                  <h3 className="media-context-group-heading">
                    {t("components.mediaContextMenu.personalPlaylistsHeading")}
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
                  title={t("components.mediaContextMenu.noPersonalPlaylistsTitle")}
                  description={t(
                    "components.mediaContextMenu.noPersonalPlaylistsDescription"
                  )}
                />
              )}
            </div>
          </>
        ) : (
          <>
              <Button
                variant="ghost"
                size="sm"
                ref={playlistBackRef}
                type="button"
                className="media-context-back"
                onClick={
                  isPlaylistItem ? returnToActions : returnToPlaylistRoots
                }
              >
                <span aria-hidden="true">←</span>
                {t("components.mediaContextMenu.back")}
              </Button>
            <div className="media-context-actions media-context-playlist-actions">
              {playlistPicker.status === "loading" ? (
                <div className="media-context-state" role="status">
                  <span className="tv-mini-loader" aria-hidden="true" />
                  <p>{t("components.mediaContextMenu.loadingPlaylists")}</p>
                </div>
              ) : playlistPicker.status === "error" ? (
                <TvEmptyState
                  graphic="playlist"
                  tone="error"
                  variant="compact"
                  title={t("components.mediaContextMenu.playlistsLoadError")}
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
                      parentPath: t("components.mediaContextMenu.topLevel"),
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
                  title={t("components.mediaContextMenu.noPlaylistDestinations")}
                />
              )}
            </div>
          </>
        )}
        {error ? <p className="media-context-error" role="alert">{error}</p> : null}
      </Drawer>
      )}
    </div>
  ) : null;

  return {
    itemProps,
    openAction,
    contextMenu: contextMenu ? createPortal(contextMenu, document.body) : null,
    close,
    isOpen: activeItem !== null,
  };
}
