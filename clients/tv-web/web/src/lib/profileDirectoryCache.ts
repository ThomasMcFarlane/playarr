// The last "Who's watching?" directory the server returned, kept so a returning visit paints the real tiles at once
// and the fresh answer updates them in place. It belongs to exactly one server and one signed-in account: a read for
// any other pair finds nothing, and sign-out or an account removal drops it, so a tile of another account never shows.

const STORAGE_KEY = "playarr.profileDirectory.v1";

export interface CachedDirectoryProfile {
  id: string;
  username: string;
  name: string;
  pinLocked: boolean;
}

interface CachedDirectory {
  apiBaseUrl: string;
  userId: string;
  profiles: CachedDirectoryProfile[];
}

function isProfile(value: unknown): value is CachedDirectoryProfile {
  const profile = value as Partial<CachedDirectoryProfile> | null;
  return (
    typeof profile?.id === "string" &&
    typeof profile.username === "string" &&
    typeof profile.name === "string" &&
    typeof profile.pinLocked === "boolean"
  );
}

export function readProfileDirectory(
  apiBaseUrl: string,
  userId: string | undefined
): CachedDirectoryProfile[] | null {
  if (!userId) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as Partial<CachedDirectory> | null;
    if (cached?.apiBaseUrl !== apiBaseUrl || cached.userId !== userId) return null;
    if (!Array.isArray(cached.profiles) || !cached.profiles.every(isProfile)) return null;
    return cached.profiles;
  } catch {
    return null;
  }
}

export function writeProfileDirectory(
  apiBaseUrl: string,
  userId: string,
  profiles: CachedDirectoryProfile[]
): void {
  try {
    const entry: CachedDirectory = { apiBaseUrl, userId, profiles };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
  } catch {
    // Storage can be full or blocked; the page then shows its skeleton on each visit.
  }
}

export function clearProfileDirectory(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing stored that we could clear.
  }
}
