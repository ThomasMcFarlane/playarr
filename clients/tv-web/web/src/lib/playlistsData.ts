import type {
  ApiClient,
  PlaylistItemResponse,
  PlaylistResponse,
  Work,
  WorkDetail,
} from "@playarr-tv/api-client";
import { mapWithLimit } from "./mapWithLimit";

export interface ResolvedPlaylistItem {
  id: string;
  work: Work;
  audioTrack?: {
    id: string;
    title: string;
    albumTitle: string;
    mediaFileId: string | null;
    runtimeMs: number;
  };
}

export interface PlaylistTrack {
  playlist: PlaylistResponse;
  items: ResolvedPlaylistItem[];
}

/** Most playlist and work reads in flight at once while the directory loads. */
export const PLAYLISTS_LOAD_CONCURRENCY = 6;
/** A playlist's items read this recently are reused (live events drop them sooner). */
const ITEMS_TTL_MS = 5_000;
const WORK_TTL_MS = 30_000;
const PLAYLIST_TAGS = ["playlists", "catalog"] as const;
const WORK_TAGS = ["catalog", "progress", "watchlist"] as const;

const LIST_KEY = "playlists:list";
const itemsKey = (id: string) => `playlists:items:${id}`;
const workKey = (id: string) => `work:${id}`;

export function resolveAudioTrack(detail: WorkDetail, trackId: string) {
  if (typeof detail.children !== "object" || detail.children === null || !("Artist" in detail.children)) {
    return undefined;
  }
  for (const album of detail.children.Artist) {
    const track = album.tracks.find((candidate) => candidate.track.id === trackId);
    if (track) {
      return {
        id: track.track.id,
        title: track.track.title,
        albumTitle: album.album.title,
        mediaFileId: track.media_file_id ?? null,
        runtimeMs: track.runtime_ms ?? (track.track.duration_seconds ?? 0) * 1_000,
      };
    }
  }
  return undefined;
}

function assemble(
  playlists: readonly PlaylistResponse[],
  itemGroups: readonly (readonly PlaylistItemResponse[])[],
  detailById: ReadonlyMap<string, WorkDetail>
): PlaylistTrack[] {
  return playlists.map((playlist, index) => ({
    playlist,
    items: [...(itemGroups[index] ?? [])]
      .sort((left, right) => left.position - right.position)
      .flatMap((item) => {
        const detail = detailById.get(item.work_id);
        if (!detail) return [];
        const audioTrack = item.track_id ? resolveAudioTrack(detail, item.track_id) : undefined;
        if (item.track_id && !audioTrack) return [];
        return [{ id: item.id, work: detail.work, audioTrack }];
      }),
  }));
}

/**
 * The directory as the query cache holds it, or `undefined` when any part is missing. A page that mounts
 * with it paints its rows in the first frame (stale copies included) and revalidates behind them.
 */
export function peekPlaylistTracks(client: ApiClient): PlaylistTrack[] | undefined {
  const { queries } = client;
  if (!queries.enabled) return undefined;
  const list = queries.peek<PlaylistResponse[]>(LIST_KEY);
  if (!list) return undefined;
  const groups: PlaylistItemResponse[][] = [];
  for (const playlist of list.data) {
    const items = queries.peek<PlaylistItemResponse[]>(itemsKey(playlist.id));
    if (!items) return undefined;
    groups.push(items.data);
  }
  const details = new Map<string, WorkDetail>();
  for (const item of groups.flat()) {
    if (details.has(item.work_id)) continue;
    const detail = queries.peek<WorkDetail>(workKey(item.work_id));
    if (!detail) return undefined;
    details.set(item.work_id, detail.data);
  }
  return assemble(list.data, groups, details);
}

export interface LoadPlaylistTracksOptions {
  /** Stops starting new reads once true (the screen unmounted, or the prefetch was cancelled). */
  isCancelled?: () => boolean;
  /** Cancels the reads this call alone is waiting on. */
  signal?: AbortSignal;
  /** Background prefetch asks for "low" so it never delays what the screen is waiting on. */
  priority?: "high" | "low" | "auto";
  /** Marks every stored read as one the query cache drops last (a warmed section: see `FetchQueryOptions.keep`). */
  keep?: boolean;
}

export interface LoadedPlaylistTracks {
  tracks: PlaylistTrack[];
  playlistCount: number;
  workCount: number;
  failures: number;
  firstFailure: unknown;
}

/**
 * Reads the directory through the query cache: the playlists, each one's items, and each distinct work.
 * One request per playlist and per work is unavoidable until the server batches them, so the fan-out is
 * bounded and a failed read leaves a gap instead of failing the page.
 */
export async function loadPlaylistTracks(
  client: ApiClient,
  options: LoadPlaylistTracksOptions = {}
): Promise<LoadedPlaylistTracks> {
  const { signal, priority, keep } = options;
  const isCancelled = () => options.isCancelled?.() === true || signal?.aborted === true;
  const playlists = await client.queries.fetch(LIST_KEY, (flight) => client.listPlaylists({ signal: flight, priority }), {
    tags: PLAYLIST_TAGS,
    ttlMs: ITEMS_TTL_MS,
    signal,
    keep,
  });
  let failures = 0;
  let firstFailure: unknown;
  const noteFailure = (error: unknown) => {
    failures += 1;
    firstFailure ??= error;
  };
  const itemGroups = await mapWithLimit(
    playlists,
    PLAYLISTS_LOAD_CONCURRENCY,
    async (playlist) => {
      try {
        return await client.queries.fetch(
          itemsKey(playlist.id),
          (flight) => client.listPlaylistItems(playlist.id, { signal: flight, priority }),
          { tags: PLAYLIST_TAGS, ttlMs: ITEMS_TTL_MS, signal, keep }
        );
      } catch (error) {
        noteFailure(error);
        return [];
      }
    },
    isCancelled
  );
  const workIds = [...new Set(itemGroups.flat().map((item) => item.work_id))];
  const details = await mapWithLimit(
    workIds,
    PLAYLISTS_LOAD_CONCURRENCY,
    async (workId): Promise<WorkDetail | null> => {
      try {
        return await client.queries.fetch(
          workKey(workId),
          (flight) => client.getWork(workId, { signal: flight, priority }),
          { tags: WORK_TAGS, ttlMs: WORK_TTL_MS, signal, keep }
        );
      } catch (error) {
        noteFailure(error);
        return null;
      }
    },
    isCancelled
  );
  const detailById = new Map(
    details.filter((detail): detail is WorkDetail => detail !== null).map((detail) => [detail.work.id, detail])
  );
  return {
    tracks: assemble(playlists, itemGroups, detailById),
    playlistCount: playlists.length,
    workCount: workIds.length,
    failures,
    firstFailure,
  };
}

/** Warms the directory so the Playlists page paints from the cache. Cancel through `signal`. */
export function prefetchPlaylists(client: ApiClient, signal?: AbortSignal): void {
  if (!client.queries.enabled) return;
  void loadPlaylistTracks(client, { signal, priority: "low", keep: true }).catch(() => undefined);
}
