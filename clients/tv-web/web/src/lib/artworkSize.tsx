import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/** One size for all artwork (Home, Library, Search, playlists, "more like this", Music). */
export type ArtworkSize = "small" | "medium" | "large";

export const ARTWORK_SIZES: readonly ArtworkSize[] = ["small", "medium", "large"];
export const ARTWORK_SIZE_DEFAULT: ArtworkSize = "medium";
export const ARTWORK_SIZE_STORAGE_KEY = "playarr-artwork-size";

/** The per-kind keys the Library used before the size became a global setting. */
const LEGACY_KINDS = ["movie", "series", "site", "artist"] as const;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

interface ArtworkSizeContextValue {
  size: ArtworkSize;
  setSize: (size: ArtworkSize) => void;
}

const ArtworkSizeContext = createContext<ArtworkSizeContextValue | null>(null);

function browserStorage(): StorageLike | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function parseArtworkSize(raw: string | null | undefined): ArtworkSize | undefined {
  return raw != null && (ARTWORK_SIZES as readonly string[]).includes(raw) ? (raw as ArtworkSize) : undefined;
}

function write(storage: StorageLike | undefined, size: ArtworkSize) {
  try {
    if (size === ARTWORK_SIZE_DEFAULT) storage?.removeItem(ARTWORK_SIZE_STORAGE_KEY);
    else storage?.setItem(ARTWORK_SIZE_STORAGE_KEY, size);
  } catch {
    // Storage unavailable: the choice lasts for this session only.
  }
}

/**
 * The saved size. When none is saved yet, the first old per-kind Library choice is adopted once
 * (and saved under the new key) so nobody loses the size they had picked.
 */
export function readArtworkSize(storage: StorageLike | undefined = browserStorage()): ArtworkSize {
  try {
    const saved = parseArtworkSize(storage?.getItem(ARTWORK_SIZE_STORAGE_KEY));
    if (saved) return saved;
    for (const kind of LEGACY_KINDS) {
      const legacy = parseArtworkSize(storage?.getItem(`playarr.artworkSize.${kind}`));
      if (legacy) {
        write(storage, legacy);
        return legacy;
      }
    }
  } catch {
    // fall through to the default
  }
  return ARTWORK_SIZE_DEFAULT;
}

/** An old `?size=` link: used once, and only when no size has been saved yet. */
export function adoptLegacyArtworkSize(
  raw: string,
  setSize: (size: ArtworkSize) => void,
  storage: StorageLike | undefined = browserStorage()
): void {
  const legacy = parseArtworkSize(raw);
  let hasSaved = false;
  try {
    hasSaved = storage?.getItem(ARTWORK_SIZE_STORAGE_KEY) != null;
  } catch {
    // Storage unavailable: treat as nothing saved.
  }
  if (legacy && !hasSaved) setSize(legacy);
}

export function ArtworkSizeProvider({ children }: { children: ReactNode }) {
  const [size, setSizeState] = useState<ArtworkSize>(() => readArtworkSize());

  // The shared card tokens read this attribute (page-layout.css), so every poster surface follows it.
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (size === ARTWORK_SIZE_DEFAULT) delete root.dataset.artworkSize;
    else root.dataset.artworkSize = size;
  }, [size]);

  const value = useMemo<ArtworkSizeContextValue>(
    () => ({
      size,
      setSize: (next) => {
        setSizeState(next);
        write(browserStorage(), next);
      },
    }),
    [size]
  );

  return <ArtworkSizeContext.Provider value={value}>{children}</ArtworkSizeContext.Provider>;
}

export function useArtworkSize(): ArtworkSizeContextValue {
  const context = useContext(ArtworkSizeContext);
  if (!context) throw new Error("useArtworkSize must be used within ArtworkSizeProvider");
  return context;
}
