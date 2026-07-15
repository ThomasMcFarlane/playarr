/**
 * @streamarr-tv/api-client/react
 *
 * Shared React data-fetching hooks over `ApiClient`. Kept in a separate
 * subpath export (rather than the package root) so consumers that don't
 * need React (e.g. `@streamarr-tv/device-auth`) never pull it in.
 *
 * These hooks are the single implementation of "loading / empty / error"
 * state handling reused by every screen that renders catalog or playback
 * data: the three TV app shells (via `@streamarr-tv/ui-tv`'s screen
 * containers) and the standalone web app's pages both call these directly,
 * so the async-state semantics (and their meaning: `"idle"` before a fetch
 * is even eligible to start, `"loading"` in flight, `"empty"` a successful
 * response with nothing to show, `"error"` a rejected fetch, `"ready"` data
 * in hand) are identical everywhere rather than reimplemented per surface.
 */
import { useEffect, useState } from "react";
import type { ApiClient, BrowseCatalogParams, CatalogPage, PlaybackInfo, WorkDetail } from "./index";

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
  const { enabled = true, isEmpty } = options;
  const [state, setState] = useState<AsyncState<T>>(enabled ? { status: "loading" } : { status: "idle" });

  useEffect(() => {
    if (!enabled) {
      setState({ status: "idle" });
      return;
    }

    let cancelled = false;
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

  return state;
}

/** Browse the catalog (optionally filtered/sorted/paged); `{status: "empty"}` when the page has no items. */
export function useCatalogBrowse(client: ApiClient, params: BrowseCatalogParams = {}): AsyncState<CatalogPage> {
  const key = JSON.stringify(params);
  return useAsyncData(() => client.browseCatalog(params), [client, key], {
    isEmpty: (data) => data.items.length === 0,
  });
}

/** Fetch a single work's full detail tree. Idle until `workId` is defined. */
export function useWorkDetail(client: ApiClient, workId: string | undefined): AsyncState<WorkDetail> {
  return useAsyncData(() => client.getWork(workId as string), [client, workId], {
    enabled: Boolean(workId),
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
