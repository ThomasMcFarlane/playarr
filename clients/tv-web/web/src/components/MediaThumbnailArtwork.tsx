import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ApiClient } from "@playarr-tv/api-client";
import { useApiClient } from "../lib/ApiClientProvider";

interface MediaThumbnailArtworkProps {
  mediaFileId: string;
  fallback: string | null;
  className: string;
  children?: ReactNode;
  intersectionRootSelector?: string;
  rootMargin?: string;
  positionMs?: number;
  /**
   * The episode's own still, preferred over the extracted frame when the
   * catalogue says the source supplied one. Failure falls back to the frame
   * thumbnail, then to `fallback`.
   */
  still?: { seriesWorkId: string; episodeId: string };
}

interface MediaThumbnailRecord {
  /** Resolves to `null` when the server has no frame for this file (an expected miss, not an error). */
  promise: Promise<string | null>;
  url?: string;
  missing?: boolean;
}

const mediaThumbnailsByClient = new WeakMap<
  ApiClient,
  Map<string, MediaThumbnailRecord>
>();

function mediaThumbnailCache(client: ApiClient): Map<string, MediaThumbnailRecord> {
  let cache = mediaThumbnailsByClient.get(client);
  if (!cache) {
    cache = new Map();
    mediaThumbnailsByClient.set(client, cache);
  }
  return cache;
}

const episodeStillsByClient = new WeakMap<ApiClient, Map<string, MediaThumbnailRecord>>();

function loadEpisodeStill(
  client: ApiClient,
  seriesWorkId: string,
  episodeId: string
): MediaThumbnailRecord {
  let cache = episodeStillsByClient.get(client);
  if (!cache) {
    cache = new Map();
    episodeStillsByClient.set(client, cache);
  }
  const key = `${seriesWorkId}:${episodeId}`;
  const existing = cache.get(key);
  if (existing) return existing;
  const record: MediaThumbnailRecord = {
    promise: client.getEpisodeArtwork(seriesWorkId, episodeId, "thumb", { width: 540 }).then((blob) => {
      if (blob.size === 0) throw new Error("The episode still response was empty.");
      const url = URL.createObjectURL(blob);
      record.url = url;
      return url;
    }),
  };
  const owned = cache;
  record.promise.catch(() => {
    if (owned.get(key) === record) owned.delete(key);
  });
  cache.set(key, record);
  return record;
}

function mediaThumbnailKey(mediaFileId: string, positionMs?: number): string {
  return `${mediaFileId}:${positionMs ?? 30_000}`;
}

function loadMediaThumbnail(
  client: ApiClient,
  mediaFileId: string,
  positionMs?: number
): MediaThumbnailRecord {
  const cache = mediaThumbnailCache(client);
  const key = mediaThumbnailKey(mediaFileId, positionMs);
  const existing = cache.get(key);
  if (existing) return existing;

  const record: MediaThumbnailRecord = {
    promise: client.getMediaThumbnail(mediaFileId, positionMs).then((blob) => {
      if (blob === null) {
        record.missing = true;
        return null;
      }
      if (blob.size === 0) throw new Error("The thumbnail response was empty.");
      const url = URL.createObjectURL(blob);
      record.url = url;
      return url;
    }),
  };
  record.promise.catch(() => {
    if (cache.get(key) === record) cache.delete(key);
  });
  cache.set(key, record);
  return record;
}

// One shared observer answers "is this rail within a row of the page's viewport?". A rail that
// scrolls inside the page is its own intersection root for its items, and an item counts as
// intersecting that root whether or not the rail itself is on screen, so without this gate every
// season's rail below the fold fetched its first frames on page load.
const nearCallbacks = new WeakMap<Element, Set<() => void>>();
const nearElements = new WeakSet<Element>();
let nearObserver: IntersectionObserver | null = null;

function observeNearViewport(element: Element, onNear: () => void): () => void {
  if (!nearObserver) {
    nearObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          // Once near, a rail stays near: every waiting item is released and the rail is dropped.
          const callbacks = nearCallbacks.get(entry.target);
          nearObserver?.unobserve(entry.target);
          nearCallbacks.delete(entry.target);
          nearElements.add(entry.target);
          callbacks?.forEach((callback) => callback());
        }
      },
      { rootMargin: "400px 0px" }
    );
  }
  if (nearElements.has(element)) {
    onNear();
    return () => undefined;
  }
  let callbacks = nearCallbacks.get(element);
  if (!callbacks) {
    callbacks = new Set();
    nearCallbacks.set(element, callbacks);
    nearObserver.observe(element);
  }
  callbacks.add(onNear);
  return () => {
    const current = nearCallbacks.get(element);
    current?.delete(onNear);
    if (current && current.size === 0) {
      nearCallbacks.delete(element);
      nearObserver?.unobserve(element);
    }
  };
}

/**
 * Authenticated media-frame artwork shared by episode rails and On Deck.
 *
 * The API returns a protected Blob rather than a public image URL. This
 * component owns the corresponding object-URL lifecycle and keeps retrying
 * transient failures with capped backoff, so restoring a media mount repairs
 * an already-open page without a navigation or reload.
 */
export function MediaThumbnailArtwork({
  mediaFileId,
  fallback,
  className,
  children,
  intersectionRootSelector,
  rootMargin = "0px 360px",
  positionMs,
  still,
}: MediaThumbnailArtworkProps) {
  const client = useApiClient();
  const containerRef = useRef<HTMLSpanElement>(null);
  const [shouldLoad, setShouldLoad] = useState(false);
  const [source, setSource] = useState<string | null>(fallback);

  useEffect(() => {
    const cachedSource = mediaThumbnailCache(client).get(
      mediaThumbnailKey(mediaFileId, positionMs)
    )?.url;
    setSource(cachedSource ?? fallback);
    if (cachedSource) {
      setShouldLoad(true);
      return;
    }
    setShouldLoad(false);
    const container = containerRef.current;
    if (!container || typeof IntersectionObserver === "undefined") {
      setShouldLoad(true);
      return;
    }

    const root = intersectionRootSelector
      ? container.closest<HTMLElement>(intersectionRootSelector)
      : null;
    // Load when the item is near its rail's visible part AND the rail is near the page's viewport.
    let itemNear = false;
    let railNear = root === null;
    const maybeLoad = () => {
      if (!itemNear || !railNear) return;
      setShouldLoad(true);
      observer.disconnect();
      stopRailWatch();
    };
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        itemNear = true;
        maybeLoad();
      },
      { root, rootMargin }
    );
    const stopRailWatch = root
      ? observeNearViewport(root, () => {
          railNear = true;
          maybeLoad();
        })
      : () => undefined;
    observer.observe(container);
    return () => {
      observer.disconnect();
      stopRailWatch();
    };
  }, [client, fallback, intersectionRootSelector, mediaFileId, positionMs, rootMargin]);

  useEffect(() => {
    if (!shouldLoad) return;
    let cancelled = false;
    let retryTimer: number | undefined;
    let retryAttempt = 0;
    const retryDelays = [1_500, 3_000, 6_000, 12_000, 30_000, 60_000];

    const loadThumbnail = () => {
      const record = loadMediaThumbnail(client, mediaFileId, positionMs);
      if (record.url) {
        setSource(record.url);
        return;
      }
      if (record.missing) return;
      record.promise
        .then((url) => {
          if (!cancelled && url) setSource(url);
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          const delay = retryDelays[Math.min(retryAttempt, retryDelays.length - 1)];
          retryAttempt += 1;
          retryTimer = window.setTimeout(loadThumbnail, delay);
          if (retryAttempt === 1) {
            console.warn(
              `Media thumbnail unavailable for ${mediaFileId} at ${positionMs ?? 30_000}ms; retrying.`,
              error
            );
          }
        });
    };

    if (still) {
      const stillRecord = loadEpisodeStill(client, still.seriesWorkId, still.episodeId);
      if (stillRecord.url) {
        setSource(stillRecord.url);
      } else {
        stillRecord.promise
          .then((url) => {
            if (!cancelled) setSource(url);
          })
          .catch(() => {
            if (!cancelled) loadThumbnail();
          });
      }
    } else {
      loadThumbnail();
    }

    return () => {
      cancelled = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [client, mediaFileId, positionMs, shouldLoad, still?.seriesWorkId, still?.episodeId]);

  return (
    <span className={className} ref={containerRef}>
      {source ? <img src={source} alt="" /> : null}
      {children}
    </span>
  );
}
