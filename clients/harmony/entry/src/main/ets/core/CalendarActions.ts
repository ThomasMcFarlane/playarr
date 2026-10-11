/**
 * What the calendar details panel offers, ported from web `lib/calendarActions.ts`: only what the server
 * computed for the viewer (an action it did not list is not offered; a disabled one is not shown).
 */

import type { CalendarAction, CalendarEntry, TitleSnapshot } from "./Types/Calendar";
import type { CalendarItem } from "./CalendarAgenda";

export interface PlayPlan {
  mediaFileId: string;
  workId: string;
  resume: boolean;
  positionMs: number;
}

export interface WatchlistPlan {
  enabled: boolean;
  listed: boolean;
}

export interface CalendarActionPlan {
  /** The library work to open, when the server enabled `open` (or play/resume). */
  openWorkId: string | null;
  play: PlayPlan | null;
  /** The server's watchlist action; `listed` is the state at load time. */
  watchlist: WatchlistPlan | null;
  snapshot: TitleSnapshot | null;
}

function find(actions: CalendarAction[], kind: string): CalendarAction | undefined {
  for (const action of actions) {
    if (action.action === kind) {
      return action;
    }
  }
  return undefined;
}

function usablePlay(action: CalendarAction | undefined): boolean {
  return action !== undefined && action.enabled && action.media_file_id !== undefined && action.media_file_id !== null;
}

export function planCalendarActions(entry: CalendarEntry): CalendarActionPlan {
  const actions = entry.actions ?? [];
  const snapshot = entry.snapshot ?? null;
  const open = find(actions, "open");
  const resume = find(actions, "resume");
  const play = find(actions, "play");
  const watchlist = find(actions, "watchlist");
  const playable = usablePlay(resume) ? resume : usablePlay(play) ? play : undefined;
  let openWorkId: string | null = null;
  if (open !== undefined && open.enabled) {
    openWorkId = open.work_id ?? entry.work_id ?? null;
  } else if (playable !== undefined) {
    openWorkId = playable.work_id ?? entry.work_id ?? null;
  }
  const workId = openWorkId ?? entry.work_id ?? "";
  return {
    openWorkId: openWorkId,
    play: playable !== undefined ? {
      mediaFileId: playable.media_file_id as string,
      workId: workId,
      resume: playable.action === "resume",
      positionMs: playable.position_ms ?? 0,
    } : null,
    watchlist: watchlist !== undefined ? { enabled: watchlist.enabled, listed: watchlist.active === true } : null,
    snapshot: snapshot,
  };
}

/** A group acts on one episode: one with progress, else the earliest playable, else the first. */
export function planItemActions(item: CalendarItem): CalendarActionPlan {
  const plans = item.entries.map((entry: CalendarEntry): CalendarActionPlan => planCalendarActions(entry));
  for (const plan of plans) {
    if (plan.play !== null && plan.play.resume) {
      return plan;
    }
  }
  for (const plan of plans) {
    if (plan.play !== null) {
      return plan;
    }
  }
  return plans[0];
}
