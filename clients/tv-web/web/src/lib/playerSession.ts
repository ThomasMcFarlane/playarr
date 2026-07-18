import type { PlayerLocationState } from "../pages/Player";

const ACTIVE_PLAYER_SESSION_STORAGE_KEY = "playarr.activePlayerSession.v1";

export interface ActivePlayerSession {
  mediaFileId: string;
  locationState: PlayerLocationState | null;
}

interface PersistedActivePlayerSession extends ActivePlayerSession {
  userId: string | null;
}

function browserSessionStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.sessionStorage;
  } catch {
    return undefined;
  }
}

function isActivePlayerSession(value: unknown): value is PersistedActivePlayerSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Record<string, unknown>;
  return (
    (session.userId === null || typeof session.userId === "string") &&
    typeof session.mediaFileId === "string" &&
    session.mediaFileId.length > 0 &&
    (session.locationState === null ||
      (typeof session.locationState === "object" && session.locationState !== null))
  );
}

export function readActivePlayerSession(
  userId: string | undefined,
  storage: Storage | undefined = browserSessionStorage()
): ActivePlayerSession | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(ACTIVE_PLAYER_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as unknown;
    if (!isActivePlayerSession(session) || session.userId !== (userId ?? null)) {
      return null;
    }
    return {
      mediaFileId: session.mediaFileId,
      locationState: session.locationState,
    };
  } catch {
    return null;
  }
}

export function hydrateActivePlayerSession(
  currentSession: ActivePlayerSession | null,
  userId: string,
  storage: Storage | undefined = browserSessionStorage()
): ActivePlayerSession | null {
  return currentSession ?? readActivePlayerSession(userId, storage);
}

export function writeActivePlayerSession(
  userId: string | undefined,
  session: ActivePlayerSession,
  storage: Storage | undefined = browserSessionStorage()
): void {
  if (!storage) return;
  try {
    storage.setItem(
      ACTIVE_PLAYER_SESSION_STORAGE_KEY,
      JSON.stringify({
        userId: userId ?? null,
        ...session,
      } satisfies PersistedActivePlayerSession)
    );
  } catch {
    // Playback still works when tab storage is disabled; only refresh restoration is lost.
  }
}

export function clearActivePlayerSession(
  storage: Storage | undefined = browserSessionStorage()
): void {
  try {
    storage?.removeItem(ACTIVE_PLAYER_SESSION_STORAGE_KEY);
  } catch {
    // The in-memory React state is still cleared when tab storage is unavailable.
  }
}
