import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ImgHTMLAttributes,
  type ReactNode,
} from "react";
import type { Album, ApiClient, ImageKind, Work } from "@playarr-tv/api-client";
import { useApiClient } from "../lib/ApiClientProvider";

interface ArtworkRecord {
  promise: Promise<string>;
  url?: string;
}

const artworkByClient = new WeakMap<ApiClient, Map<string, ArtworkRecord>>();

function artworkCache(client: ApiClient): Map<string, ArtworkRecord> {
  let cache = artworkByClient.get(client);
  if (!cache) {
    cache = new Map();
    artworkByClient.set(client, cache);
  }
  return cache;
}

function workArtworkKey(workId: string, kind: ImageKind): string {
  return `work:${workId}:${kind}`;
}

function albumArtworkKey(artistWorkId: string, albumId: string, kind: ImageKind): string {
  return `album:${artistWorkId}:${albumId}:${kind}`;
}

function loadArtwork(
  client: ApiClient,
  key: string,
  request: () => Promise<Blob>
): ArtworkRecord {
  const cache = artworkCache(client);
  const existing = cache.get(key);
  if (existing) return existing;

  const record: ArtworkRecord = {
    promise: request().then((blob) => {
      const url = URL.createObjectURL(blob);
      record.url = url;
      return url;
    }),
  };
  record.promise.catch(() => {
    // Do not poison the application-lifetime cache when an artwork source is
    // temporarily unavailable. Remounting or revisiting can try again.
    if (cache.get(key) === record) cache.delete(key);
  });
  cache.set(key, record);
  return record;
}

function preferredArtworkKind(
  item: Pick<Work, "images"> | Pick<Album, "images">,
  kinds: readonly ImageKind[]
): ImageKind | null {
  return kinds.find((kind) => item.images.some((image) => image.kind === kind)) ?? null;
}

function useArtworkUrl(
  key: string | null,
  enabled: boolean,
  request: (() => Promise<Blob>) | null
): { url: string | null; loading: boolean } {
  const client = useApiClient();
  const [url, setUrl] = useState<string | null>(() =>
    key ? artworkCache(client).get(key)?.url ?? null : null
  );
  const [loading, setLoading] = useState(Boolean(enabled && key && !url));

  useEffect(() => {
    if (!enabled || !key || !request) {
      setUrl(null);
      setLoading(false);
      return;
    }

    const cached = artworkCache(client).get(key)?.url;
    if (cached) {
      setUrl(cached);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const record = loadArtwork(client, key, request);
    setUrl(record.url ?? null);
    setLoading(!record.url);
    if (!record.url) {
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
    }
    return () => {
      cancelled = true;
    };
  }, [client, enabled, key, request]);

  return { url, loading };
}

export function useCachedWorkArtwork(
  work: Pick<Work, "id" | "images">,
  kinds: readonly ImageKind[],
  enabled = true
): { url: string | null; available: boolean; loading: boolean } {
  const client = useApiClient();
  const kindsKey = kinds.join(":");
  const kind = useMemo(
    () => preferredArtworkKind(work, kinds),
    [kindsKey, work.images]
  );
  const key = kind ? workArtworkKey(work.id, kind) : null;
  const request = useMemo(
    () => (kind ? () => client.getWorkArtwork(work.id, kind) : null),
    [client, kind, work.id]
  );
  return {
    ...useArtworkUrl(key, enabled && kind !== null, request),
    available: kind !== null,
  };
}

function useCachedAlbumArtwork(
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
  const key = kind ? albumArtworkKey(artistWorkId, album.id, kind) : null;
  const request = useMemo(
    () =>
      kind
        ? () => client.getAlbumArtwork(artistWorkId, album.id, kind)
        : null,
    [album.id, artistWorkId, client, kind]
  );
  return {
    ...useArtworkUrl(key, enabled && kind !== null, request),
    available: kind !== null,
  };
}

interface CachedImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> {
  fallback?: ReactNode;
  loadingFallback?: ReactNode;
}

function CachedImage({
  url,
  artworkLoading,
  fallback,
  loadingFallback,
  lazyAnchorRef,
  shouldLoad,
  ...imageProps
}: CachedImageProps & {
  url: string | null;
  artworkLoading: boolean;
  lazyAnchorRef: React.RefObject<HTMLElement>;
  shouldLoad: boolean;
}) {
  if (url) return <img {...imageProps} src={url} />;
  return (
    <>
      {artworkLoading ? loadingFallback ?? fallback : fallback}
      {!shouldLoad ? (
        <i
          ref={lazyAnchorRef}
          aria-hidden="true"
          className="artwork-lazy-anchor"
        />
      ) : null}
    </>
  );
}

function useLazyArtwork(loading: ImgHTMLAttributes<HTMLImageElement>["loading"]): {
  lazyAnchorRef: React.RefObject<HTMLElement>;
  shouldLoad: boolean;
} {
  const lazyAnchorRef = useRef<HTMLElement>(null);
  const [shouldLoad, setShouldLoad] = useState(loading !== "lazy");
  useEffect(() => {
    if (loading !== "lazy" || shouldLoad) return;
    const anchor = lazyAnchorRef.current;
    if (!anchor || typeof IntersectionObserver === "undefined") {
      setShouldLoad(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      { rootMargin: "320px" }
    );
    observer.observe(anchor);
    return () => observer.disconnect();
  }, [loading, shouldLoad]);
  return { lazyAnchorRef, shouldLoad };
}

export function CachedWorkArtworkImage({
  work,
  kinds,
  ...props
}: CachedImageProps & {
  work: Pick<Work, "id" | "images">;
  kinds: readonly ImageKind[];
}) {
  const lazy = useLazyArtwork(props.loading);
  const artwork = useCachedWorkArtwork(work, kinds, lazy.shouldLoad);
  return (
    <CachedImage
      {...props}
      {...lazy}
      url={artwork.url}
      artworkLoading={artwork.loading}
    />
  );
}

export function CachedAlbumArtworkImage({
  artistWorkId,
  album,
  kinds,
  ...props
}: CachedImageProps & {
  artistWorkId: string;
  album: Pick<Album, "id" | "images">;
  kinds: readonly ImageKind[];
}) {
  const lazy = useLazyArtwork(props.loading);
  const artwork = useCachedAlbumArtwork(
    artistWorkId,
    album,
    kinds,
    lazy.shouldLoad
  );
  return (
    <CachedImage
      {...props}
      {...lazy}
      url={artwork.url}
      artworkLoading={artwork.loading}
    />
  );
}
