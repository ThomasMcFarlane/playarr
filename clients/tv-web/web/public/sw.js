/**
 * Streamarr Web service worker -- the versioned OTA update mechanism
 * described in `docs/architecture/clients/web.md#self-update--ota-mechanism`.
 *
 * Deliberately does NOT call `self.skipWaiting()` unconditionally on
 * install: a newly installed worker sits WAITING (holding a fresh
 * precache keyed by the CDN build manifest's `bundleVersion`) until the
 * page explicitly tells it to take over, either because the viewer
 * dismissed-into "reload now" on the update toast, or because
 * `src/lib/appUpdate.ts` forced a reload after finding the running bundle
 * below the server's `min_supported_version` floor. That is what keeps a
 * background update from interrupting an in-progress session, per the
 * architecture doc's step 3.
 */

const CACHE_PREFIX = "streamarr-web-";

self.addEventListener("install", (event) => {
  event.waitUntil(precacheNewBundle());
});

async function fetchManifest() {
  try {
    const response = await fetch("/build-manifest.json", { cache: "no-store" });
    if (!response.ok) return null;
    const manifest = await response.json();
    return typeof manifest?.bundleVersion === "string" ? manifest : null;
  } catch {
    return null;
  }
}

async function precacheNewBundle() {
  const manifest = await fetchManifest();
  if (!manifest) return;

  const cache = await caches.open(CACHE_PREFIX + manifest.bundleVersion);
  // The app shell only -- hashed asset URLs referenced by index.html get
  // pulled in lazily by the fetch handler below (cache-as-you-go) rather
  // than needing a full precache asset list generated at build time.
  try {
    await cache.addAll(["/", "/index.html"]);
  } catch {
    // A precache miss (e.g. offline during install) isn't fatal -- the
    // fetch handler below still falls through to the network per-request.
  }
}

// The page (see `appUpdate.ts`) posts this once the viewer has confirmed
// (or the version-floor check has forced) an update -- only then does this
// worker activate and start controlling pages under the new cache.
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const manifest = await fetchManifest();
      const currentCacheName = manifest ? CACHE_PREFIX + manifest.bundleVersion : null;
      const keys = await caches.keys();
      // Deletes every other bundle-version precache *and* the opportunistic
      // runtime cache from `fetch` below (it doesn't match `currentCacheName`
      // either) -- intentional: a fresh activation is exactly the moment to
      // drop any runtime-cached responses from the bundle version being
      // replaced, rather than tracking their provenance separately.
      await Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== currentCacheName)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  // Never intercept the manifest/version-check itself -- the app must
  // always see a live, uncached answer to "is there a newer build".
  const url = new URL(event.request.url);
  if (url.pathname === "/build-manifest.json") return;

  // Production deploys can update the bundle without changing the package
  // version. Fetching navigations from the network first means a reload sees
  // the newly deployed index and its hashed assets immediately; the cached
  // shell remains the offline fallback.
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request, { cache: "no-store" })
        .then((response) => {
          if (response.ok && event.request.url.startsWith(self.location.origin)) {
            const responseClone = response.clone();
            caches
              .open(CACHE_PREFIX + "runtime")
              .then((cache) => cache.put(event.request, responseClone))
              .catch(() => {});
          }
          return response;
        })
        .catch(() =>
          caches
            .match(event.request)
            .then((cached) => cached || caches.match("/index.html"))
        )
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (response.ok && event.request.url.startsWith(self.location.origin)) {
            const responseClone = response.clone();
            caches
              .open(CACHE_PREFIX + "runtime")
              .then((cache) => cache.put(event.request, responseClone))
              .catch(() => {});
          }
          return response;
        })
        .catch(() => caches.match("/index.html"));
    })
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  const notification = payload.notification || payload.data?.notification || {};
  const data = payload.data || {};
  event.waitUntil(
    self.registration.showNotification(notification.title || "Playarr", {
      body: notification.body || "Your friend invite request was approved.",
      icon: "/playarr-icon-192.png",
      badge: "/playarr-icon-192.png",
      tag: "invite-approved",
      data: { link: data.link || "https://playarr.app/settings" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = event.notification.data?.link || "https://playarr.app/settings";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => client.url.startsWith(self.location.origin));
      if (existing) {
        existing.navigate(link);
        return existing.focus();
      }
      return self.clients.openWindow(link);
    })
  );
});
