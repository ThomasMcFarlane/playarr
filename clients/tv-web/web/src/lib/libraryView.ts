/**
 * Library view and sort/order and their URL (query string)
 * representation: `?view=list&sort=date_added&order=desc`.
 *
 * The URL is the source of truth, so refresh, back/forward and deep links
 * restore the exact view. localStorage only supplies the default for a fresh
 * URL with no params (the last choice made for that kind). Unknown or
 * malformed values are ignored rather than throwing.
 */
export type LibraryKind = "movie" | "series" | "site" | "artist";
export type LibraryView = "list" | "screen" | "cover" | "cover-flow";
export type LibrarySort = "title" | "date_added";
export type SortOrder = "asc" | "desc";

export interface LibraryViewState {
  view: LibraryView;
  sort: LibrarySort;
  order: SortOrder;
}

export const LIBRARY_VIEW_PARAMS = ["view", "sort", "order"] as const;

export const LIBRARY_VIEW_DEFAULTS: LibraryViewState = {
  view: "screen",
  sort: "title",
  order: "asc",
};

const VIEWS: readonly LibraryView[] = ["list", "screen", "cover", "cover-flow"];
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
    return typeof window === "undefined" ? null : window.localStorage;
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
    sort: pick(SORTS, read("librarySort")) ?? LIBRARY_VIEW_DEFAULTS.sort,
    order: pick(ORDERS, read("libraryOrder")) ?? LIBRARY_VIEW_DEFAULTS.order,
  };
}

export function rememberLibraryView(
  kind: LibraryKind,
  patch: Partial<LibraryViewState>,
  storage: StorageLike | null = defaultStorage()
): void {
  const names = { view: "libraryView", sort: "librarySort", order: "libraryOrder" } as const;
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

/**
 * The artwork size is a global setting now (lib/artworkSize.ts). An old `?size=` param is read once so it
 * can be adopted into that setting, then dropped from the URL.
 */
export const LEGACY_SIZE_PARAM = "size";

/** URL params win field by field; anything missing or invalid falls back to `defaults`. */
export function parseLibraryView(
  params: URLSearchParams,
  kind: LibraryKind,
  defaults: LibraryViewState = LIBRARY_VIEW_DEFAULTS
): LibraryViewState {
  return {
    view: coerceView(kind, pick(VIEWS, params.get("view"))) ?? defaults.view,
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

/** Items per library page request. */
export const LIBRARY_PAGE_SIZE = 200;

/**
 * The first-page request a library screen makes for `kind` with this sort and these language
 * filters. One definition shared by the screen and by route prefetching, so a prefetched page is
 * exactly the one the screen then asks for.
 */
export function libraryFirstPageParams(
  kind: LibraryKind,
  sort: LibrarySort,
  order: SortOrder,
  languageParams: { audio_lang?: string; subtitle_lang?: string } = {}
) {
  return {
    kind,
    available_only: true,
    sort,
    order,
    limit: LIBRARY_PAGE_SIZE,
    offset: 0,
    ...languageParams,
  };
}

/** The query-cache key of a library first page. */
export function libraryFirstPageKey(params: ReturnType<typeof libraryFirstPageParams>): string {
  return `catalog:library:${JSON.stringify(params)}`;
}

/** What the grid holds once more than the first page is loaded (the whole scrolled-through list). */
export interface LibraryLoadedList<T> {
  items: T[];
  total: number;
}

/**
 * The query-cache key of the whole loaded list of one library view. The first page alone is not enough for
 * Back: returning from a title opened deep in the list needs that title's row in the first render, otherwise
 * the grid paints its head, grows page by page and the restored focus and scroll have nothing to land on.
 */
export function libraryLoadedKey(params: ReturnType<typeof libraryFirstPageParams>): string {
  return `${libraryFirstPageKey(params)}:loaded`;
}

const COVER_IMAGE_KINDS = ["poster", "backdrop"] as const;
const SCREEN_IMAGE_KINDS = ["backdrop", "poster"] as const;

/** The artwork kinds a library card prefers in this view (cover art, otherwise screen art). */
export function libraryImageKinds(view: LibraryView): readonly ("poster" | "backdrop")[] {
  return view === "cover" ? COVER_IMAGE_KINDS : SCREEN_IMAGE_KINDS;
}
