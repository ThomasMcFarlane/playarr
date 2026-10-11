// core/CalendarFilters.ts: web lib/calendarFilters.ts (type, status and monitoring filters of the calendar).
import type { CalendarEntry, CalendarMediaKind } from "./Types/Calendar";
import { entryLocalDay } from "./CalendarAgenda";

export type CalendarTypeParam = "tv" | "movie" | "music" | "book";
export type CalendarStatus = "aired" | "upcoming" | "downloaded" | "missing";

export const CALENDAR_TYPE_PARAMS: CalendarTypeParam[] = ["tv", "movie", "music", "book"];
export const CALENDAR_STATUSES: CalendarStatus[] = ["aired", "upcoming", "downloaded", "missing"];

/** Web's option labels (`pages.calendar.type*` / `status*`). */
export function calendarTypeLabel(type: string): string {
  if (type === "tv") {
    return "TV";
  }
  if (type === "movie") {
    return "Movies";
  }
  return type === "music" ? "Music" : "Books";
}

export function calendarStatusLabel(status: string): string {
  if (status === "aired") {
    return "Aired";
  }
  if (status === "upcoming") {
    return "Upcoming";
  }
  return status === "downloaded" ? "Downloaded" : "Missing";
}

export function typeForKind(kind: CalendarMediaKind): CalendarTypeParam {
  if (kind === "episode") {
    return "tv";
  }
  if (kind === "movie") {
    return "movie";
  }
  return kind === "album" ? "music" : "book";
}

export interface CalendarFilters {
  types: string[];
  statuses: string[];
  monitoredOnly: boolean;
}

export function activeFilterCount(filters: CalendarFilters): number {
  return (filters.types.length > 0 ? 1 : 0) + (filters.statuses.length > 0 ? 1 : 0) + (filters.monitoredOnly ? 1 : 0);
}

function matchesStatus(entry: CalendarEntry, status: string, today: string): boolean {
  const aired = entryLocalDay(entry) <= today;
  if (status === "aired") {
    return aired;
  }
  if (status === "upcoming") {
    return !aired;
  }
  if (status === "downloaded") {
    return entry.has_file;
  }
  return aired && !entry.has_file;
}

/** Selected values within one filter are OR-ed, different filters are AND-ed (web). */
export function applyCalendarFilters(entries: CalendarEntry[], filters: CalendarFilters, today: string): CalendarEntry[] {
  return entries.filter((entry: CalendarEntry) => {
    if (filters.types.length > 0 && filters.types.indexOf(typeForKind(entry.media_kind)) < 0) {
      return false;
    }
    if (filters.statuses.length > 0 && !filters.statuses.some((status: string) => matchesStatus(entry, status, today))) {
      return false;
    }
    return !(filters.monitoredOnly && !entry.monitored);
  });
}
