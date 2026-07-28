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
}

interface MediaThumbnailRecord {
  promise: Promise<string>;
  url?: string;
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
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setShouldLoad(true);
        observer.disconnect();
      },
      { root, rootMargin }
    );
    observer.observe(container);
    return () => observer.disconnect();
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
      record.promise
        .then((url) => {
          if (!cancelled) setSource(url);
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

    loadThumbnail();

    return () => {
      cancelled = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [client, mediaFileId, positionMs, shouldLoad]);

  return (
    <span className={className} ref={containerRef}>
      {source ? <img src={source} alt="" /> : null}
      {children}
    </span>
  );
}
