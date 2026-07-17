/**
 * Streamarr Web service worker -- the versioned OTA update mechanism
 * described in `docs/architecture/clients/web.md#self-update--ota-mechanism`.
 *
 * A newly installed worker activates immediately. Activation only replaces
 * request routing and does not reload an open page, so playback is not
 * interrupted; this also ensures a corrected worker cannot remain waiting
 * behind an older worker that returns the app shell for failed API requests.
 */

const CACHE_PREFIX = "streamarr-web-";
const APP_BASE_URL = new URL(self.registration.scope).pathname;
const appUrl = (path = "") => `${APP_BASE_URL}${path}`;

self.addEventListener("install", (event) => {
  event.waitUntil(precacheNewBundle().then(() => self.skipWaiting()));
});

async function fetchManifest() {
  try {
    const response = await fetch(appUrl("build-manifest.json"), { cache: "no-store" });
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
    await cache.addAll([APP_BASE_URL, appUrl("index.html")]);
  } catch {
    // A precache miss (e.g. offline during install) isn't fatal -- the
    // fetch handler below still falls through to the network per-request.
  }
}

// Retained for compatibility with already-open clients that explicitly ask a
// waiting worker to activate through `appUpdate.ts`.
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
  const url = new URL(event.request.url);

  // This worker owns only Playarr's static files and navigations. In
  // particular, never catch a cross-origin or API failure and substitute
  // index.html: callers would then try to parse the HTML app shell as JSON.
  if (url.origin !== self.location.origin) return;
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname === "/healthz" ||
    url.pathname === "/readyz"
  ) return;

  // Never intercept the manifest/version-check itself -- the app must
  // always see a live, uncached answer to "is there a newer build".
  if (url.pathname === appUrl("build-manifest.json")) return;

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
            .then((cached) => cached || caches.match(appUrl("index.html")))
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
        });
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
      icon: appUrl("playarr-icon-192.png"),
      badge: appUrl("playarr-icon-192.png"),
      tag: "invite-approved",
      data: { link: data.link || appUrl("settings") },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = event.notification.data?.link || appUrl("settings");
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
