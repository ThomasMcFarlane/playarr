/**
 * Resume/session bookkeeping for the shell-mounted `PlayerScreen` (design
 * doc §2's file-purpose comment for this file), a Vega-shaped port of
 * `clients/tv-web/web/src/lib/playerSession.ts`'s `ActivePlayerSession`
 * idea rather than a byte-for-byte copy, because the two clients' actual
 * failure mode differs:
 *
 * On tv-web, the browser can reload the whole document mid-playback (a
 * manual refresh, a crash-recovery reload) while React state -- including
 * "what mediaFileId is currently playing" -- is wiped clean; that file
 * persists to `window.sessionStorage` (cleared when the tab closes, kept
 * across a same-tab reload) purely to survive that one scenario.
 *
 * Vega has no equivalent "reload the document, keep the tab" event in
 * normal operation, but it has a real analogue that is if anything MORE
 * likely on this class of device: design doc §6.3 requires releasing the
 * decoder when the app backgrounds (`platform/lifecycle.ts`'s
 * `useAppForeground`, wired through `KeplerAppState`), and a memory-
 * constrained Fire TV Stick reaping a backgrounded app outright (rather
 * than merely suspending it) is a documented, expected class of event for
 * this hardware tier -- not a rare edge case. So this port persists through
 * `globalThis.localStorage` (Vega's AsyncStorage-backed shim,
 * `platform/storage/localStorageShim.ts`, allow-listing the `playarr.`
 * prefix this file's storage key uses -- see that file's own comment) so a
 * cold relaunch after the OS killed the app can still answer "what was
 * playing", not just a same-process remount. Deliberately does NOT decide
 * whether to auto-resume playback on its own -- that UX call (silently
 * resuming audio/video the moment the app opens is often the wrong answer
 * on a TV) belongs to whatever screen reads this back, a later integration
 * step per this task's own brief.
 *
 * Storage shape and the `platformLocalStorage()`/injectable-`Storage`-
 * parameter pattern below are copied from `lib/catalogKindsCache.ts`
 * deliberately -- see that file's own top comment for why
 * `globalThis.localStorage` is read fresh on every call rather than
 * captured at import time, and why an injectable `Storage` parameter (not a
 * jest.mock() of the global) is how this module's own tests exercise every
 * branch.
 */

const ACTIVE_PLAYER_SESSION_STORAGE_KEY = 'playarr.activePlayerSession.v1';

export interface ActivePlayerSession {
  mediaFileId: string;
  /** Absolute source timestamp to resume at, in seconds -- `undefined` starts from the beginning (or wherever `PlayerScreen`'s own resume-progress lookup lands it). */
  startPositionSeconds?: number;
  /** A human-readable title, purely so a future "Resume playing X?" prompt has something to show without a round trip -- never authoritative (the real title always comes from the API). */
  title?: string;
}

interface PersistedActivePlayerSession extends ActivePlayerSession {
  /** Scopes the session to one signed-in profile, exactly like `catalogKindsCache.ts`'s own per-profile scoping -- a stale session belonging to a profile that has since signed out (or a different profile on a shared device) must never resurface as "resume this". `null` before any profile is signed in. */
  userId: string | null;
}

function platformLocalStorage(): Storage | undefined {
  return typeof globalThis.localStorage === 'undefined' ? undefined : globalThis.localStorage;
}

function isActivePlayerSession(value: unknown): value is PersistedActivePlayerSession {
  if (!value || typeof value !== 'object') return false;
  const session = value as Record<string, unknown>;
  return (
    (session.userId === null || typeof session.userId === 'string') &&
    typeof session.mediaFileId === 'string' &&
    session.mediaFileId.length > 0 &&
    (session.startPositionSeconds === undefined ||
      (typeof session.startPositionSeconds === 'number' && Number.isFinite(session.startPositionSeconds))) &&
    (session.title === undefined || typeof session.title === 'string')
  );
}

/**
 * Reads back the last-persisted active player session for `userId`, or
 * `null` when there is nothing usable (no storage yet, nothing written,
 * corrupt JSON, or a session that belongs to a different profile).
 */
export function readActivePlayerSession(
  userId: string | undefined,
  storage: Storage | undefined = platformLocalStorage()
): ActivePlayerSession | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(ACTIVE_PLAYER_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isActivePlayerSession(parsed) || parsed.userId !== (userId ?? null)) return null;
    return {
      mediaFileId: parsed.mediaFileId,
      startPositionSeconds: parsed.startPositionSeconds,
      title: parsed.title,
    };
  } catch {
    // Corrupt JSON under this key behaves as "nothing persisted yet" --
    // the caller falls back to a normal cold start with no session to resume.
    return null;
  }
}

/**
 * Persists `session` for `userId`. A missing `storage` is a silent no-op --
 * `PlayerScreen` still works perfectly for the current run without this,
 * it just loses the ability to answer "what was playing" after a relaunch.
 */
export function writeActivePlayerSession(
  userId: string | undefined,
  session: ActivePlayerSession,
  storage: Storage | undefined = platformLocalStorage()
): void {
  if (!storage) return;
  try {
    storage.setItem(
      ACTIVE_PLAYER_SESSION_STORAGE_KEY,
      JSON.stringify({userId: userId ?? null, ...session} satisfies PersistedActivePlayerSession)
    );
  } catch {
    // Same posture as catalogKindsCache.ts: playback still works with a
    // storage write that throws, only the "resume after relaunch" feature
    // is lost for this update.
  }
}

/** Clears whatever active player session is currently persisted -- called once playback genuinely ends (not paused, not backgrounded) so a completed episode never resurfaces as "resume this" on the next cold start. */
export function clearActivePlayerSession(storage: Storage | undefined = platformLocalStorage()): void {
  try {
    storage?.removeItem(ACTIVE_PLAYER_SESSION_STORAGE_KEY);
  } catch {
    // The in-memory caller state is still cleared either way; only the
    // persisted copy might survive a throwing storage backend.
  }
}
