import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ImgHTMLAttributes,
  type ReactNode,
} from "react";
import type {
  Album,
  ApiClient,
  ImageKind,
  Work,
} from "@playarr-tv/api-client";
import { useApiClient } from "./ApiClientProvider";
import { whenNavigationIdle } from "./navigationActivity";

interface ArtworkRecord {
  promise: Promise<string>;
  url?: string;
  /** Mounted images currently showing this URL: never revoked while above zero. */
  refs: number;
}

// One object URL per API-client/work/kind/width for the application lifetime, capped (see
// `trimArtwork`). This de-duplicates Home/detail/directory requests for the same artwork; the
// browser HTTP cache (artwork URLs carry a version, so they are immutable) is the durable source
// across reloads.
const artworkByClient = new WeakMap<ApiClient, Map<string, ArtworkRecord>>();

function artworkCache(client: ApiClient): Map<string, ArtworkRecord> {
  let cache = artworkByClient.get(client);
  if (!cache) {
    cache = new Map();
    artworkByClient.set(client, cache);
  }
  return cache;
}

/**
 * How many decoded artwork object URLs one client keeps. Low-memory TVs get fewer: a poster
 * decoded at card size is a few hundred kilobytes, so the cap bounds memory on a long session.
 */
export function artworkCacheLimit(deviceMemoryGb: number | undefined): number {
  if (deviceMemoryGb === undefined) return 240;
  if (deviceMemoryGb >= 4) return 400;
  if (deviceMemoryGb >= 2) return 240;
  return 120;
}

const ARTWORK_CACHE_LIMIT = artworkCacheLimit(
  typeof navigator === "undefined" ? undefined : (navigator as Navigator & { deviceMemory?: number }).deviceMemory
);

/** Drops the least recently used resolved artwork that nothing is showing, until under the cap. */
export function trimArtwork(cache: Map<string, ArtworkRecord>, limit: number = ARTWORK_CACHE_LIMIT): void {
  if (cache.size <= limit) return;
  for (const [key, record] of cache) {
    if (cache.size <= limit) break;
    if (record.refs > 0 || !record.url) continue;
    URL.revokeObjectURL(record.url);
    cache.delete(key);
  }
}

function touchArtwork(cache: Map<string, ArtworkRecord>, key: string, record: ArtworkRecord): void {
  cache.delete(key);
  cache.set(key, record);
}

/** A short, stable token for an artwork source URL: when the source changes the token does too. */
export function artworkVersion(sourceUrl: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < sourceUrl.length; i += 1) {
    hash ^= sourceUrl.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Card-sized by default: the server snaps these up to its own set of widths and never upscales. */
export function defaultArtworkWidth(kind: ImageKind): number {
  switch (kind) {
    case "poster":
      return 360;
    case "thumb":
      return 540;
    case "logo":
      return 540;
    case "banner":
      return 780;
    case "backdrop":
      return 780;
    default:
      return 540;
  }
}

function artworkKey(workId: string, kind: ImageKind, width: number): string {
  return `${workId}:${kind}:${width}`;
}

function loadArtwork(
  client: ApiClient,
  workId: string,
  kind: ImageKind,
  width: number,
  version: string | undefined
): ArtworkRecord {
  const cache = artworkCache(client);
  const key = artworkKey(workId, kind, width);
  const existing = cache.get(key);
  if (existing) {
    touchArtwork(cache, key, existing);
    return existing;
  }

  const record: ArtworkRecord = {
    refs: 0,
    promise: client.getWorkArtwork(workId, kind, { width, version }).then(
      (blob) =>
        new Promise<string>((resolve) => {
          // createObjectURL is synchronous main-thread work: never during a hold.
          whenNavigationIdle(() => {
            const url = URL.createObjectURL(blob);
            record.url = url;
            resolve(url);
            trimArtwork(cache);
          });
        })
    ),
  };
  record.promise.catch(() => {
    // A provider outage should be retryable when the artwork mounts again,
    // rather than poisoning the in-memory cache for the whole app session.
    if (cache.get(key) === record) cache.delete(key);
  });
  cache.set(key, record);
  return record;
}

/**
 * Starts fetching a work's artwork ahead of use (focus dwell, the next rail) so it is decoded and
 * cached by the time the card or page mounts. Safe to call repeatedly.
 */
export function prefetchWorkArtwork(
  client: ApiClient,
  work: Pick<Work, "id" | "images">,
  kinds: readonly ImageKind[],
  width?: number
): void {
  const kind = preferredArtworkKind(work, kinds);
  if (!kind) return;
  const image = work.images.find((candidate) => candidate.kind === kind);
  void loadArtwork(client, work.id, kind, width ?? defaultArtworkWidth(kind), image ? artworkVersion(image.url) : undefined)
    .promise.catch(() => undefined);
}

function albumArtworkKey(
  artistWorkId: string,
  albumId: string,
  kind: ImageKind
): string {
  return `album:${artistWorkId}:${albumId}:${kind}`;
}

function loadAlbumArtwork(
  client: ApiClient,
  artistWorkId: string,
  albumId: string,
  kind: ImageKind
): ArtworkRecord {
  const cache = artworkCache(client);
  const key = albumArtworkKey(artistWorkId, albumId, kind);
  const existing = cache.get(key);
  if (existing) return existing;

  const record: ArtworkRecord = {
    // Album art is never evicted (few per page, and its hook does not track mounts).
    refs: 1,
    promise: client.getAlbumArtwork(artistWorkId, albumId, kind, { width: defaultArtworkWidth(kind) }).then((blob) => {
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

export function preferredArtworkKind(
  work: Pick<Work, "images">,
  kinds: readonly ImageKind[]
): ImageKind | null {
  return kinds.find((kind) => work.images.some((image) => image.kind === kind)) ?? null;
}

export function useCachedArtwork(
  work: Pick<Work, "id" | "images">,
  kinds: readonly ImageKind[],
  enabled = true,
  width?: number,
  versioned = true
): { url: string | null; available: boolean; loading: boolean } {
  const client = useApiClient();
  const kindsKey = kinds.join(":");
  const kind = useMemo(
    () => preferredArtworkKind(work, kinds),
    // `images` is replaced as catalogue data changes; `kindsKey` avoids a
    // new caller-owned array retriggering this calculation every render.
    [kindsKey, work.images]
  );
  const artWidth = kind ? (width ?? defaultArtworkWidth(kind)) : 0;
  const version = useMemo(() => {
    const image = kind ? work.images.find((candidate) => candidate.kind === kind) : undefined;
    return image && versioned ? artworkVersion(image.url) : undefined;
  }, [kind, work.images, versioned]);
  const [url, setUrl] = useState<string | null>(() => {
    if (!kind) return null;
    return artworkCache(client).get(artworkKey(work.id, kind, artWidth))?.url ?? null;
  });
  const [loading, setLoading] = useState(Boolean(enabled && kind && !url));

  useEffect(() => {
    if (!kind) {
      setUrl(null);
      setLoading(false);
      return;
    }

    const cache = artworkCache(client);
    const key = artworkKey(work.id, kind, artWidth);
    // Hold the record while this image shows it, so the memory cap never revokes a visible URL.
    let held: ArtworkRecord | undefined;
    const hold = (record: ArtworkRecord) => {
      if (held === record) return;
      if (held) held.refs -= 1;
      record.refs += 1;
      held = record;
    };
    const release = () => {
      if (held) held.refs -= 1;
      held = undefined;
      trimArtwork(cache);
    };

    const cached = cache.get(key);
    if (cached?.url) {
      hold(cached);
      touchArtwork(cache, key, cached);
      setUrl(cached.url);
      setLoading(false);
      return release;
    }
    if (!enabled) {
      setUrl(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setUrl(null);
    setLoading(true);
    const cancelStart = whenNavigationIdle(() => {
      if (cancelled) return;
      const record = cache.get(key) ?? loadArtwork(client, work.id, kind, artWidth, version);
      hold(record);
      record.promise
        .then((resolvedUrl) => {
          if (!cancelled) {
            setUrl(resolvedUrl);
            setLoading(false);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setUrl(null);
            setLoading(false);
          }
        });
    });
    return () => {
      cancelled = true;
      cancelStart();
      release();
    };
  }, [client, enabled, kind, work.id, artWidth, version]);

  return { url, available: kind !== null, loading };
}

export function useCachedAlbumArtwork(
  artistWorkId: string,
  album: Pick<Album, "id" | "images">,
  kinds: readonly ImageKind[],
  enabled = true
): { url: string | null; available: boolean; loading: boolean } {
  const client = useApiClient();
  const kindsKey = kinds.join(":");
  const kind = useMemo(
    () => preferredArtworkKind(album, kinds),
    [album.images, kindsKey]
  );
  const key = kind
    ? albumArtworkKey(artistWorkId, album.id, kind)
    : null;
  const [url, setUrl] = useState<string | null>(() =>
    key ? artworkCache(client).get(key)?.url ?? null : null
  );
  const [loading, setLoading] = useState(Boolean(enabled && kind && !url));

  useEffect(() => {
    if (!kind || !key) {
      setUrl(null);
      setLoading(false);
      return;
    }

    const cachedUrl = artworkCache(client).get(key)?.url;
    if (cachedUrl) {
      setUrl(cachedUrl);
      setLoading(false);
      return;
    }
    if (!enabled) {
      setUrl(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const record = loadAlbumArtwork(client, artistWorkId, album.id, kind);
    if (record.url) {
      setUrl(record.url);
      setLoading(false);
      return;
    }
    setUrl(null);
    setLoading(true);
    record.promise
      .then((resolvedUrl) => {
        if (!cancelled) {
          setUrl(resolvedUrl);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUrl(null);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [album.id, artistWorkId, client, enabled, key, kind]);

  return { url, available: kind !== null, loading };
}


// One shared IntersectionObserver for every lazy artwork anchor. A per-image
// observer costs a construct + observe per card, which dominated the frames in
// which a library row mounted.
const visibleCallbacks = new WeakMap<Element, () => void>();
let sharedVisibilityObserver: IntersectionObserver | null = null;

function observeVisibleOnce(anchor: Element, onVisible: () => void): () => void {
  if (!sharedVisibilityObserver) {
    sharedVisibilityObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const callback = visibleCallbacks.get(entry.target);
          sharedVisibilityObserver?.unobserve(entry.target);
          visibleCallbacks.delete(entry.target);
          callback?.();
        }
      },
      { rootMargin: "320px" }
    );
  }
  visibleCallbacks.set(anchor, onVisible);
  sharedVisibilityObserver.observe(anchor);
  return () => {
    visibleCallbacks.delete(anchor);
    sharedVisibilityObserver?.unobserve(anchor);
  };
}

function loadPersonArtwork(client: ApiClient, personId: string): ArtworkRecord {
  const cache = artworkCache(client);
  const key = `person:${personId}`;
  const existing = cache.get(key);
  if (existing) return existing;
  const record: ArtworkRecord = {
    promise: client.getPersonArtwork(personId).then((blob) => {
      const url = URL.createObjectURL(blob);
      record.url = url;
      return url;
    }),
    // A headshot is a few kilobytes at 240 px and its card holds no reference: keep it for the session.
    refs: 1,
  };
  record.promise.catch(() => {
    if (cache.get(key) === record) cache.delete(key);
  });
  cache.set(key, record);
  return record;
}

/**
 * A cast or crew headshot through the server's resizing image proxy (never the metadata provider's original from a
 * third-party host). Loads when the card scrolls near the viewport; the fallback (initials) shows until then and when
 * the person has no headshot.
 */
export function PersonHeadshot({
  personId,
  hasHeadshot,
  fallback,
}: {
  personId: string;
  hasHeadshot: boolean;
  fallback: ReactNode;
}) {
  const client = useApiClient();
  const anchorRef = useRef<HTMLElement>(null);
  const key = `person:${personId}`;
  const [url, setUrl] = useState<string | null>(() => artworkCache(client).get(key)?.url ?? null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!hasHeadshot || url || visible) return;
    const anchor = anchorRef.current;
    if (!anchor || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    let cancelDeferred = () => {};
    const stop = observeVisibleOnce(anchor, () => {
      cancelDeferred = whenNavigationIdle(() => setVisible(true));
    });
    return () => {
      stop();
      cancelDeferred();
    };
  }, [hasHeadshot, url, visible]);
  useEffect(() => {
    if (!hasHeadshot || !visible || url) return;
    let cancelled = false;
    loadPersonArtwork(client, personId).promise.then(
      (resolved) => {
        if (!cancelled) setUrl(resolved);
      },
      () => undefined
    );
    return () => {
      cancelled = true;
    };
  }, [client, hasHeadshot, personId, url, visible]);
  if (url) return <img src={url} alt="" decoding="async" />;
  return (
    <>
      {fallback}
      {hasHeadshot && !visible ? (
        <i ref={anchorRef} aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />
      ) : null}
    </>
  );
}

interface CachedArtworkImageProps
  extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> {
  work: Pick<Work, "id" | "images">;
  kinds: readonly ImageKind[];
  fallback?: ReactNode;
  /**
   * False keeps the image unloaded and unobserved (the fallback shows). Dense
   * grids that already know which cards are near the viewport drive this
   * instead of observing every mounted card.
   */
  enabled?: boolean;
  /** Longest useful width in pixels; defaults to a card-sized width for the artwork kind. */
  artWidth?: number;
}

/** Authenticated `<img>` backed by Playarr Server's persistent artwork cache. */
export function CachedArtworkImage({
  work,
  kinds,
  fallback = null,
  enabled = true,
  artWidth,
  ...imageProps
}: CachedArtworkImageProps) {
  const lazyAnchorRef = useRef<HTMLElement>(null);
  const [shouldLoad, setShouldLoad] = useState(imageProps.loading !== "lazy");
  useEffect(() => {
    if (imageProps.loading !== "lazy" || shouldLoad || !enabled) return;
    const anchor = lazyAnchorRef.current;
    if (!anchor || typeof IntersectionObserver === "undefined") {
      setShouldLoad(true);
      return;
    }
    // Becoming visible during a remote hold must not cost a render per card.
    let cancelDeferred = () => {};
    const stopObserving = observeVisibleOnce(anchor, () => {
      cancelDeferred = whenNavigationIdle(() => setShouldLoad(true));
    });
    return () => {
      stopObserving();
      cancelDeferred();
    };
  }, [imageProps.loading, shouldLoad, enabled]);

  const artwork = useCachedArtwork(work, kinds, shouldLoad && enabled, artWidth);
  if (!artwork.url) {
    return (
      <>
        {fallback}
        {!shouldLoad ? (
          <i
            ref={lazyAnchorRef}
            aria-hidden="true"
            style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
          />
        ) : null}
      </>
    );
  }
  return <img decoding="async" {...imageProps} src={artwork.url} />;
}

interface CachedAlbumArtworkImageProps
  extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> {
  artistWorkId: string;
  album: Pick<Album, "id" | "images">;
  kinds: readonly ImageKind[];
  fallback?: ReactNode;
}

/** Authenticated album `<img>` backed by Playarr Server's persistent artwork cache. */
export function CachedAlbumArtworkImage({
  artistWorkId,
  album,
  kinds,
  fallback = null,
  ...imageProps
}: CachedAlbumArtworkImageProps) {
  const lazyAnchorRef = useRef<HTMLElement>(null);
  const [shouldLoad, setShouldLoad] = useState(imageProps.loading !== "lazy");
  useEffect(() => {
    if (imageProps.loading !== "lazy" || shouldLoad) return;
    const anchor = lazyAnchorRef.current;
    if (!anchor || typeof IntersectionObserver === "undefined") {
      setShouldLoad(true);
      return;
    }
    // Becoming visible during a remote hold must not cost a render per card.
    let cancelDeferred = () => {};
    const stopObserving = observeVisibleOnce(anchor, () => {
      cancelDeferred = whenNavigationIdle(() => setShouldLoad(true));
    });
    return () => {
      stopObserving();
      cancelDeferred();
    };
  }, [imageProps.loading, shouldLoad]);

  const artwork = useCachedAlbumArtwork(
    artistWorkId,
    album,
    kinds,
    shouldLoad
  );
  if (!artwork.url) {
    return (
      <>
        {fallback}
        {!shouldLoad ? (
          <i
            ref={lazyAnchorRef}
            aria-hidden="true"
            style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
          />
        ) : null}
      </>
    );
  }
  return <img decoding="async" {...imageProps} src={artwork.url} />;
}
