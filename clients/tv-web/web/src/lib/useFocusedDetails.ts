import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { WorkDetail } from "@playarr-tv/api-client";
import { useApiClient } from "./ApiClientProvider";
import { focusedDetailsFor, type FocusedDetails } from "./focusedDetails";

/**
 * The shared details controller for the signed-in client (stable for the client's life). A page calls
 * `focus(id)` on every remote move, `setNear` / `setWarm` once with resolvers, and `release()` when it
 * unmounts; see `FocusedDetails` for the request rules.
 */
export function useFocusedDetailsController(): FocusedDetails {
  return focusedDetailsFor(useApiClient());
}

/**
 * The extended details of `workId`: the stored copy at once (any age; the controller revalidates it in the
 * background), or `undefined` until one is loaded. Panels render from the card data first and fill these
 * fields in when they arrive, so they are never blank. This only reads; the page drives the requests.
 */
export function useFocusedDetail(workId: string | undefined): WorkDetail | undefined {
  const controller = useFocusedDetailsController();
  const subscribe = useCallback(
    (listener: () => void) => (workId ? controller.subscribe(workId, listener) : () => undefined),
    [controller, workId]
  );
  // A panel that shows an item the focus has not reached yet (the page's first paint) still reads the disk copy.
  useEffect(() => {
    if (workId) controller.hydrate(workId);
  }, [controller, workId]);
  return useSyncExternalStore(
    subscribe,
    () => (workId ? controller.peek(workId)?.data : undefined),
    () => undefined
  );
}
