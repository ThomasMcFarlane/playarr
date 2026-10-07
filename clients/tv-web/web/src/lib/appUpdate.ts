/**
 * The Web app's client auto-update module, per the architecture plan's OTA
 * design (`docs/architecture/clients/web.md#self-update--ota-mechanism`,
 * `docs/versioning-policy.md`'s per-platform update table).
 *
 * Two independent signals feed this, both defensive/never-throwing (see
 * `@playarr-tv/domain`):
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
 *    hosted Web reloads while immutable webOS/Tizen packages show an update
 *    notice and wait for the viewer to install a newer IPK/WGT.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "@playarr-tv/api-client";
import { evaluateClientVersion, fetchBuildManifest, isNewerBundleAvailable } from "@playarr-tv/domain";

/** How often to re-poll for an update while the app stays open, in addition to on-focus/on-visible checks. */
const POLL_INTERVAL_MS = 15 * 60 * 1000;

export interface AppUpdateState {
  /** A newer CDN bundle exists. Dismissible -- shows the "Update available" toast. */
  updateAvailable: boolean;
  /** The running bundle is below the server's `min_supported_version` floor. */
  mustReload: boolean;
  /** Vendor packages cannot update through the Web service worker and must be reinstalled. */
  packageUpdateRequired: boolean;
  dismiss: () => void;
  reloadNow: () => void;
}

/**
 * Registers the versioned service worker for hosted production builds only
 * (never vendor packages and never Vite development) and polls the applicable
 * update signals above.
 */
export function useAppUpdate(client: ApiClient, clientPlatform = "web"): AppUpdateState {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [mustReload, setMustReload] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const isVendorPackage = clientPlatform === "tv-webos" || clientPlatform === "tv-tizen";

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
    if (
      isVendorPackage ||
      typeof navigator === "undefined" ||
      !("serviceWorker" in navigator) ||
      !import.meta.env.PROD ||
      // The server-hosted build (`--mode server`, under /tv/) has no service worker.
      import.meta.env.MODE === "server"
    ) return;
    let cancelled = false;
    navigator.serviceWorker
      .register("/sw.js")
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
  }, [isVendorPackage]);

  const checkForUpdate = useCallback(async () => {
    if (!isVendorPackage) {
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
  }, [client, clientPlatform, isVendorPackage]);

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

  // Hosted Web builds can satisfy the floor by loading their newly deployed
  // bundle. Vendor TV packages cannot, so they keep running and surface the
  // explicit reinstall notice returned below instead of entering a reload
  // loop against the same immutable IPK/WGT.
  useEffect(() => {
    if (mustReload && !isVendorPackage) reloadNow();
  }, [isVendorPackage, mustReload, reloadNow]);

  return {
    updateAvailable: updateAvailable && !dismissed,
    mustReload,
    packageUpdateRequired: isVendorPackage && mustReload,
    dismiss: () => setDismissed(true),
    reloadNow,
  };
}
