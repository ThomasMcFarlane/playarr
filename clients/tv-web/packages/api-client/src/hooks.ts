/**
 * @playarr-tv/api-client/react
 *
 * Shared React data-fetching hooks over `ApiClient`. Kept in a separate
 * subpath export (rather than the package root) so consumers that don't
 * need React (e.g. `@playarr-tv/device-auth`) never pull it in.
 *
 * These hooks are the single implementation of "loading / empty / error"
 * state handling reused by every screen that renders catalog or playback
 * data: the three TV app shells (via `@playarr-tv/ui-tv`'s screen
 * containers) and the standalone web app's pages both call these directly,
 * so the async-state semantics (and their meaning: `"idle"` before a fetch
 * is even eligible to start, `"loading"` in flight, `"empty"` a successful
 * response with nothing to show, `"error"` a rejected fetch, `"ready"` data
 * in hand) are identical everywhere rather than reimplemented per surface.
 */
import { useEffect, useRef, useState } from "react";
import type {
  ApiClient,
  BrowseCatalogParams,
  CatalogPage,
  HomeRailsResponse,
  PlaybackInfo,
  WorkDetail,
} from "./index";

export type AsyncState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "empty" }
  | { status: "ready"; data: T };

export interface UseAsyncDataOptions<T> {
  /** When false, skips fetching entirely and reports `{status: "idle"}` -- useful while a required id is unknown. */
  enabled?: boolean;
  isEmpty?: (data: T) => boolean;
  /**
   * Live refresh hook-up: called with a `refresh` function, returns an unsubscribe.
   * `refresh` refetches in place -- the current data stays on screen (no "loading"
   * flash, no remount) and is replaced only when the new data arrives; a failed
   * background refetch keeps the old data. Pass a stable function (memoise it).
   */
  subscribe?: (refresh: () => void) => () => void;
}

/**
 * Generic "fetch on mount / on dep change" hook with a shared loading/empty/error/ready
 * state shape. `deps` should be primitive/stable values (ids, stringified query objects) --
 * it is passed straight through to `useEffect`'s dependency array.
 */
export function useAsyncData<T>(
  fetcher: () => Promise<T>,
  deps: unknown[],
  options: UseAsyncDataOptions<T> = {}
): AsyncState<T> {
  const { enabled = true, isEmpty, subscribe } = options;
  const [state, setState] = useState<AsyncState<T>>(enabled ? { status: "loading" } : { status: "idle" });
  // Latest closures, so a background refresh uses current params without re-subscribing.
  const latest = useRef({ fetcher, isEmpty });
  latest.current = { fetcher, isEmpty };
  // Bumped whenever the primary effect restarts, so an older background refresh never wins.
  const generation = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setState({ status: "idle" });
      return;
    }

    let cancelled = false;
    generation.current += 1;
    setState({ status: "loading" });

    fetcher()
      .then((data) => {
        if (cancelled) return;
        setState(isEmpty?.(data) ? { status: "empty" } : { status: "ready", data });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
      });

    return () => {
      cancelled = true;
    };
    // `deps` is an intentionally caller-controlled dependency array (ids / stringified params),
    // not `fetcher`/`isEmpty` themselves, so callers don't need to memoize closures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  useEffect(() => {
    if (!enabled || !subscribe) return;
    return subscribe(() => {
      const started = generation.current;
      latest.current
        .fetcher()
        .then((data) => {
          if (generation.current !== started) return;
          const next: AsyncState<T> = latest.current.isEmpty?.(data) ? { status: "empty" } : { status: "ready", data };
          setState((current) => (sameAsyncState(current, next) ? current : next));
        })
        .catch(() => undefined);
    });
  }, [enabled, subscribe]);

  return state;
}

function sameAsyncState<T>(a: AsyncState<T>, b: AsyncState<T>): boolean {
  if (a.status !== b.status) return false;
  if (a.status === "ready" && b.status === "ready") {
    try {
      return JSON.stringify(a.data) === JSON.stringify(b.data);
    } catch {
      return false;
    }
  }
  return a.status === "empty";
}

/** Browse the catalog (optionally filtered/sorted/paged); `{status: "empty"}` when the page has no items. */
export function useCatalogBrowse(
  client: ApiClient,
  params: BrowseCatalogParams = {},
  options: Pick<UseAsyncDataOptions<CatalogPage>, "subscribe"> = {}
): AsyncState<CatalogPage> {
  const key = JSON.stringify(params);
  return useAsyncData(() => client.browseCatalog(params), [client, key], {
    isEmpty: (data) => data.items.length === 0,
    subscribe: options.subscribe,
  });
}

/** The caller's server-computed Home rails; `{status: "empty"}` when none have items. */
export function useHomeRails(
  client: ApiClient,
  params: { lang?: string; library?: "movie" | "series" | "artist" } = {}
): AsyncState<HomeRailsResponse> {
  const key = JSON.stringify(params);
  return useAsyncData(() => client.getHomeRails(params), [client, key], {
    isEmpty: (data) => data.rails.length === 0,
  });
}

/** Fetch a single work's full detail tree. Idle until `workId` is defined. */
export function useWorkDetail(
  client: ApiClient,
  workId: string | undefined,
  options: Pick<UseAsyncDataOptions<WorkDetail>, "subscribe"> = {}
): AsyncState<WorkDetail> {
  return useAsyncData(() => client.getWork(workId as string), [client, workId], {
    enabled: Boolean(workId),
    subscribe: options.subscribe,
  });
}

export interface PlaybackCapabilities {
  containers?: string;
  videoCodecs?: string;
  audioCodecs?: string;
  maxBitrateBps?: number;
  profile?: string;
}

/** Negotiate playback for a MediaFile. Idle until `mediaFileId` is defined. */
export function usePlaybackInfo(
  client: ApiClient,
  mediaFileId: string | undefined,
  capabilities: PlaybackCapabilities = {}
): AsyncState<PlaybackInfo> {
  const key = JSON.stringify(capabilities);
  return useAsyncData(
    () => client.getPlaybackInfo(mediaFileId as string, capabilities),
    [client, mediaFileId, key],
    { enabled: Boolean(mediaFileId) }
  );
}
