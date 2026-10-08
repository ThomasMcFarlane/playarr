import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { ApiClient } from "@playarr-tv/api-client";
import { withQueryCacheInvalidation } from "./cacheInvalidation";
import { createLiveCoordinator } from "./coordinator";
import { createLiveRegistry, type LiveRegistry, type LiveScope } from "./registry";

const LiveEventsContext = createContext<LiveRegistry | null>(null);

function documentVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

/**
 * Owns the one live event stream for the signed-in account. Mount it once,
 * inside the API client provider. `client` is the primary server's client and
 * `signedInKey` identifies the account on that server (undefined when signed
 * out); a change of either restarts the stream with a fresh cursor.
 */
export function LiveEventsProvider({
  client,
  signedInKey,
  serverKey,
  pollIntervalMs,
  children,
}: {
  client: ApiClient;
  signedInKey: string | undefined;
  serverKey: string;
  pollIntervalMs: number;
  children: ReactNode;
}) {
  const registry = useMemo(() => createLiveRegistry(), []);

  useEffect(() => {
    if (!signedInKey) return;
    const coordinator = createLiveCoordinator({
      // Stored query copies are dropped as the frame arrives; mounted screens then refetch (debounced).
      registry: withQueryCacheInvalidation(registry, client.queries),
      pollIntervalMs,
      open: ({ lastEventId, signal }) => client.openEventStream({ lastEventId, signal }),
    });
    const sync = () => coordinator.setActive(documentVisible());
    const hide = () => coordinator.setActive(false);
    sync();
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", sync);
      coordinator.dispose();
    };
    // `serverKey` restarts the stream (fresh cursor) when the server changes.
  }, [client, registry, signedInKey, serverKey, pollIntervalMs]);

  useEffect(() => () => registry.dispose(), [registry]);

  return <LiveEventsContext.Provider value={registry}>{children}</LiveEventsContext.Provider>;
}

function scopeKey(scope: LiveScope): string {
  return `${scope.areas.join(",")}|${scope.keys?.join(",") ?? "*"}`;
}

/**
 * Returns a `subscribe(refresh)` function for data hooks (see `useAsyncData`'s
 * `subscribe` option): `refresh` runs, in place, whenever a live event touches
 * this scope or a fallback poll fires. Without a provider it never fires.
 */
export function useLiveSubscription(scope: LiveScope): (refresh: () => void) => () => void {
  const registry = useContext(LiveEventsContext);
  const key = scopeKey(scope);
  return useMemo(
    () => (refresh: () => void) => (registry ? registry.register(scope, refresh) : () => undefined),
    // `key` stands in for the scope's identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [registry, key]
  );
}

/**
 * A counter that increments whenever a live event touches `scope`. Add it to
 * the dependency list of an existing fetch effect so that effect re-runs in
 * place; do not reset the effect's state to "loading" for revisions above 0,
 * so stale data stays on screen until the new data arrives.
 */
export function useLiveRevision(scope: LiveScope): number {
  const subscribe = useLiveSubscription(scope);
  const store = useMemo(() => {
    let revision = 0;
    return {
      subscribe: (listener: () => void) =>
        subscribe(() => {
          revision += 1;
          listener();
        }),
      snapshot: () => revision,
    };
  }, [subscribe]);
  return useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
}
