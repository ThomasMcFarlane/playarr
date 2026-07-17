/**
 * The Web app's client auto-update module, per the architecture plan's OTA
 * design (`docs/architecture/clients/web.md#self-update--ota-mechanism`,
 * `docs/versioning-policy.md`'s per-platform update table).
 *
 * Two independent signals feed this, both defensive/never-throwing (see
 * `@streamarr-tv/domain`):
 *
 * 1. The CDN-hosted build manifest (`fetchBuildManifest`) -- "is there a
 *    newer bundle than the one I'm running". This drives the *soft*,
 *    dismissible "Update available" path: precache the new bundle via the
 *    service worker in the background, but only reload when the viewer
 *    asks.
 * 2. `GET /api/system/version`'s compatibility table (`evaluateClientVersion`)
 *    -- "is the bundle I'm running still within the server's supported
 *    range". This drives the *hard*, non-dismissible path: once the
 *    running bundle is below `min_supported_version` (the server's floor),
 *    a reload is forced automatically rather than merely offered.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "@streamarr-tv/api-client";
import { evaluateClientVersion, fetchBuildManifest, isNewerBundleAvailable } from "@streamarr-tv/domain";

/** How often to re-poll for an update while the app stays open, in addition to on-focus/on-visible checks. */
const POLL_INTERVAL_MS = 15 * 60 * 1000;

export interface AppUpdateState {
  /** A newer CDN bundle exists. Dismissible -- shows the "Update available" toast. */
  updateAvailable: boolean;
  /** The running bundle is below the server's `min_supported_version` floor. Non-dismissible; a reload is triggered automatically. */
  mustReload: boolean;
  dismiss: () => void;
  reloadNow: () => void;
}

/**
 * Registers the versioned service worker (production builds only -- see
 * the `import.meta.env.PROD` guard below, so this never fights Vite's dev
 * server/HMR) and polls both update signals above.
 */
export function useAppUpdate(client: ApiClient, clientPlatform = "web"): AppUpdateState {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [mustReload, setMustReload] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);

  const reloadNow = useCallback(() => {
    const waiting = registrationRef.current?.waiting;
    if (!waiting || typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      window.location.reload();
      return;
    }

    let reloaded = false;
    const doReload = () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", doReload, { once: true });
    waiting.postMessage("SKIP_WAITING");
    // Fall back to a plain reload if `controllerchange` never fires (e.g. this
    // worker never actually took control for some reason) -- an update should
    // never get permanently stuck behind a toast/forced-reload that does nothing.
    setTimeout(doReload, 3000);
  }, []);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator) || !import.meta.env.PROD) return;
    let cancelled = false;
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .then((registration) => {
        if (!cancelled) registrationRef.current = registration;
      })
      .catch(() => {
        // No SW support/registration failure -- update prompting below still
        // works via a plain full reload, just without background precaching.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const checkForUpdate = useCallback(async () => {
    const manifest = await fetchBuildManifest({
      manifestUrl: `${import.meta.env.BASE_URL}build-manifest.json`,
    });
    if (manifest && isNewerBundleAvailable(__APP_VERSION__, manifest)) {
      setUpdateAvailable(true);
      // Ask the SW to re-check/precache the new bundle in the background --
      // the actual reload still waits for `reloadNow` (dismissible toast, or
      // the forced path below), matching the architecture doc's "background
      // fetch... without interrupting an in-progress session" step.
      void registrationRef.current?.update();
    }

    try {
      const version = await client.getVersion();
      const evaluation = evaluateClientVersion(__APP_VERSION__, clientPlatform, version.compatibility);
      if (evaluation.status === "unsupported") {
        setMustReload(true);
      }
    } catch {
      // Server unreachable this tick -- try again on the next poll rather than treating it as a hard failure.
    }
  }, [client, clientPlatform]);

  useEffect(() => {
    void checkForUpdate();
    const onVisible = () => {
      if (document.visibilityState === "visible") void checkForUpdate();
    };
    const interval = setInterval(() => void checkForUpdate(), POLL_INTERVAL_MS);
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [checkForUpdate]);

  // The floor check is a hard requirement, not a suggestion -- force the
  // reload as soon as it's detected rather than waiting for the viewer.
  useEffect(() => {
    if (mustReload) reloadNow();
  }, [mustReload, reloadNow]);

  return {
    updateAvailable: updateAvailable && !dismissed,
    mustReload,
    dismiss: () => setDismissed(true),
    reloadNow,
  };
}
