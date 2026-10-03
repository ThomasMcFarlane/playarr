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
}

// One object URL per API-client/work/kind for the application lifetime.
// This de-duplicates Home/detail/directory requests for the same artwork;
// the server-side cache remains the durable source across reloads.
const artworkByClient = new WeakMap<ApiClient, Map<string, ArtworkRecord>>();

function artworkCache(client: ApiClient): Map<string, ArtworkRecord> {
  let cache = artworkByClient.get(client);
  if (!cache) {
    cache = new Map();
    artworkByClient.set(client, cache);
  }
  return cache;
}

function loadArtwork(client: ApiClient, workId: string, kind: ImageKind): ArtworkRecord {
  const cache = artworkCache(client);
  const key = `${workId}:${kind}`;
  const existing = cache.get(key);
  if (existing) return existing;

  const record: ArtworkRecord = {
    promise: client.getWorkArtwork(workId, kind).then(
      (blob) =>
        new Promise<string>((resolve) => {
          // createObjectURL is synchronous main-thread work: never during a hold.
          whenNavigationIdle(() => {
            const url = URL.createObjectURL(blob);
            record.url = url;
            resolve(url);
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
    promise: client.getAlbumArtwork(artistWorkId, albumId, kind).then((blob) => {
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
  enabled = true
): { url: string | null; available: boolean; loading: boolean } {
  const client = useApiClient();
  const kindsKey = kinds.join(":");
  const kind = useMemo(
    () => preferredArtworkKind(work, kinds),
    // `images` is replaced as catalogue data changes; `kindsKey` avoids a
    // new caller-owned array retriggering this calculation every render.
    [kindsKey, work.images]
  );
  const [url, setUrl] = useState<string | null>(() => {
    if (!kind) return null;
    return artworkCache(client).get(`${work.id}:${kind}`)?.url ?? null;
  });
  const [loading, setLoading] = useState(Boolean(enabled && kind && !url));

  useEffect(() => {
    if (!kind) {
      setUrl(null);
      setLoading(false);
      return;
    }

    const cachedUrl = artworkCache(client).get(`${work.id}:${kind}`)?.url;
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
    const existing = artworkCache(client).get(`${work.id}:${kind}`);
    setUrl(null);
    setLoading(true);
    const cancelStart = whenNavigationIdle(() => {
      if (cancelled) return;
      const record = existing ?? loadArtwork(client, work.id, kind);
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
    };
  }, [client, enabled, kind, work.id]);

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
}

/** Authenticated `<img>` backed by Playarr Server's persistent artwork cache. */
export function CachedArtworkImage({
  work,
  kinds,
  fallback = null,
  enabled = true,
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

  const artwork = useCachedArtwork(work, kinds, shouldLoad && enabled);
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
  return <img {...imageProps} src={artwork.url} />;
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
  return <img {...imageProps} src={artwork.url} />;
}
