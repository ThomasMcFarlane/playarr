import type { WorkKind } from "@playarr-tv/api-client";

const CATALOG_KINDS_STORAGE_KEY = "playarr.catalogKinds.v1";
const WORK_KINDS: ReadonlySet<string> = new Set([
  "movie",
  "series",
  "site",
  "artist",
  "author",
]);

type StoredCatalogKinds = Record<string, WorkKind[]>;

function browserLocalStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function isWorkKind(value: unknown): value is WorkKind {
  return typeof value === "string" && WORK_KINDS.has(value);
}

function readStore(storage: Storage): StoredCatalogKinds {
  try {
    const raw = storage.getItem(CATALOG_KINDS_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as StoredCatalogKinds)
      : {};
  } catch {
    return {};
  }
}

export function createCatalogKindsCacheScope(
  userId: string | undefined,
  serverUrls: ReadonlyArray<string>
): string | null {
  if (!userId) return null;
  return JSON.stringify([userId, [...new Set(serverUrls)].sort()]);
}

export function readCachedCatalogKinds(
  scope: string | null,
  storage: Storage | undefined = browserLocalStorage()
): ReadonlySet<WorkKind> | null {
  if (!scope || !storage) return null;
  const kinds = readStore(storage)[scope];
  if (!Array.isArray(kinds) || !kinds.every(isWorkKind)) return null;
  return new Set(kinds);
}

export function writeCachedCatalogKinds(
  scope: string | null,
  kinds: Iterable<WorkKind>,
  storage: Storage | undefined = browserLocalStorage()
): void {
  if (!scope || !storage) return;
  try {
    const stored = readStore(storage);
    stored[scope] = [...new Set(kinds)].filter(isWorkKind);
    storage.setItem(CATALOG_KINDS_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Navigation still loads from the API when persistent browser storage is unavailable.
  }
}
