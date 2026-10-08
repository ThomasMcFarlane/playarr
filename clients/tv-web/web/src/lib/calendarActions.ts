import type { CalendarAction, CalendarEntry, TitleSnapshot } from "@playarr-tv/api-client";
import { workRouteForEntry } from "./calendar";

/** What the details panel offers for one calendar item. */
export interface CalendarActionPlan {
  /** Detail page of the library work, when the server enabled `open` (or play/resume). */
  open: { route: string } | null;
  /** Start or resume playback of a library file, when the server enabled it. */
  play: { mediaFileId: string; resume: boolean } | null;
  /** The server's request action, shown disabled with its reason when it cannot be used. */
  request: { enabled: boolean; reason: string | null; requested: boolean } | null;
  /** The server's watchlist action; `listed` is the state at load time. */
  watchlist: { enabled: boolean; reason: string | null; listed: boolean } | null;
  /** Posted unchanged to the request and watchlist endpoints. */
  snapshot: TitleSnapshot | null;
  /** The server predates server-computed actions, so the client builds them itself. */
  legacy: boolean;
}

function find(actions: readonly CalendarAction[], kind: CalendarAction["action"]): CalendarAction | undefined {
  return actions.find((action) => action.action === kind);
}

function detailRoute(entry: CalendarEntry, workId: string | null | undefined): string | null {
  return workId ? workRouteForEntry({ ...entry, work_id: workId }) : null;
}

/**
 * Resolves the actions of a calendar entry from what the server computed for
 * the signed-in viewer. Nothing is inferred from library state here: an action
 * the server did not list is not offered, and a disabled one keeps its reason.
 *
 * Entries from a server without `actions` (not yet updated) give a `legacy`
 * plan so the caller can fall back to the earlier client-side behaviour.
 */
export function planCalendarActions(entry: CalendarEntry): CalendarActionPlan {
  const actions = entry.actions ?? [];
  if (actions.length === 0) {
    return { open: null, play: null, request: null, watchlist: null, snapshot: entry.snapshot ?? null, legacy: true };
  }
  const open = find(actions, "open");
  const resume = find(actions, "resume");
  const play = find(actions, "play");
  const request = find(actions, "request");
  const watchlist = find(actions, "watchlist");
  const playable = [resume, play].find((action) => action?.enabled && action.media_file_id);
  const openWorkId = open?.enabled ? open.work_id : (playable?.work_id ?? null);
  const route = open?.enabled || playable ? detailRoute(entry, openWorkId ?? entry.work_id) : null;
  return {
    open: route ? { route } : null,
    play: playable ? { mediaFileId: playable.media_file_id!, resume: playable.action === "resume" } : null,
    request: request
      ? { enabled: request.enabled && !request.active, reason: request.reason ?? null, requested: request.active === true }
      : null,
    watchlist: watchlist
      ? { enabled: watchlist.enabled, reason: watchlist.reason ?? null, listed: watchlist.active === true }
      : null,
    snapshot: entry.snapshot ?? null,
    legacy: false,
  };
}

/** The snapshot a client built before servers computed it; only for servers without `actions`. */
export function legacySnapshot(entry: CalendarEntry): TitleSnapshot {
  const kind = entry.media_kind === "movie" ? "movie" : entry.media_kind === "album" ? "artist" : entry.media_kind === "book" ? "author" : "series";
  return {
    kind,
    title: entry.title,
    poster_url: entry.poster_url ?? null,
    work_id: entry.work_id ?? null,
    // An episode's date is its air date, not the series' release year, so only movies and albums carry one.
    year: kind === "movie" || kind === "artist" ? Number(entry.date.slice(0, 4)) || null : null,
  };
}
