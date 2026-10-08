/**
 * Library view, card size and sort/order and their URL (query string)
 * representation: `?view=list&size=large&sort=date_added&order=desc`.
 *
 * The URL is the source of truth, so refresh, back/forward and deep links
 * restore the exact view. localStorage only supplies the default for a fresh
 * URL with no params (the last choice made for that kind). Unknown or
 * malformed values are ignored rather than throwing.
 */
export type LibraryKind = "movie" | "series" | "site" | "artist";
export type LibraryView = "list" | "screen" | "cover" | "cover-flow";
export type ArtworkSize = "small" | "medium" | "large";
export type LibrarySort = "title" | "date_added";
export type SortOrder = "asc" | "desc";

export interface LibraryViewState {
  view: LibraryView;
  size: ArtworkSize;
  sort: LibrarySort;
  order: SortOrder;
}

export const LIBRARY_VIEW_PARAMS = ["view", "size", "sort", "order"] as const;

export const LIBRARY_VIEW_DEFAULTS: LibraryViewState = {
  view: "screen",
  size: "medium",
  sort: "title",
  order: "asc",
};

const VIEWS: readonly LibraryView[] = ["list", "screen", "cover", "cover-flow"];
const SIZES: readonly ArtworkSize[] = ["small", "medium", "large"];
const SORTS: readonly LibrarySort[] = ["title", "date_added"];
const ORDERS: readonly SortOrder[] = ["asc", "desc"];

function pick<T extends string>(allowed: readonly T[], raw: string | null | undefined): T | undefined {
  return raw != null && (allowed as readonly string[]).includes(raw) ? (raw as T) : undefined;
}

/** Cover Flow is the artist wall only; elsewhere it falls back to the default view. */
function coerceView(kind: LibraryKind, view: LibraryView | undefined): LibraryView | undefined {
  if (view === "cover-flow" && kind !== "artist") return LIBRARY_VIEW_DEFAULTS.view;
  return view;
}

const key = (name: string, kind: LibraryKind) => `playarr.${name}.${kind}`;

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The last choice per kind, used only when the URL carries no value for a field. */
export function storedLibraryView(kind: LibraryKind, storage: StorageLike | null = defaultStorage()): LibraryViewState {
  const read = (name: string) => {
    try {
      return storage?.getItem(key(name, kind)) ?? null;
    } catch {
      return null;
    }
  };
  return {
    view: coerceView(kind, pick(VIEWS, read("libraryView"))) ?? LIBRARY_VIEW_DEFAULTS.view,
    size: pick(SIZES, read("artworkSize")) ?? LIBRARY_VIEW_DEFAULTS.size,
    sort: pick(SORTS, read("librarySort")) ?? LIBRARY_VIEW_DEFAULTS.sort,
    order: pick(ORDERS, read("libraryOrder")) ?? LIBRARY_VIEW_DEFAULTS.order,
  };
}

export function rememberLibraryView(
  kind: LibraryKind,
  patch: Partial<LibraryViewState>,
  storage: StorageLike | null = defaultStorage()
): void {
  const names = { view: "libraryView", size: "artworkSize", sort: "librarySort", order: "libraryOrder" } as const;
  for (const field of LIBRARY_VIEW_PARAMS) {
    const value = patch[field];
    if (value === undefined) continue;
    try {
      storage?.setItem(key(names[field], kind), value);
    } catch {
      // Storage unavailable: the URL still carries the choice.
    }
  }
}

/** URL params win field by field; anything missing or invalid falls back to `defaults`. */
export function parseLibraryView(
  params: URLSearchParams,
  kind: LibraryKind,
  defaults: LibraryViewState = LIBRARY_VIEW_DEFAULTS
): LibraryViewState {
  return {
    view: coerceView(kind, pick(VIEWS, params.get("view"))) ?? defaults.view,
    size: pick(SIZES, params.get("size")) ?? defaults.size,
    sort: pick(SORTS, params.get("sort")) ?? defaults.sort,
    order: pick(ORDERS, params.get("order")) ?? defaults.order,
  };
}

/** Inverse of {@link parseLibraryView}: a copy of `current` with `patch` written explicitly (other params untouched). */
export function applyLibraryView(current: URLSearchParams, patch: Partial<LibraryViewState>): URLSearchParams {
  const out = new URLSearchParams(current);
  for (const field of LIBRARY_VIEW_PARAMS) {
    const value = patch[field];
    if (value !== undefined) out.set(field, value);
  }
  return out;
}
