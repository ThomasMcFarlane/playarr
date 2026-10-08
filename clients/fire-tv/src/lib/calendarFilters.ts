/**
 * Release-calendar filters and their URL (query string) representation.
 *
 * Every filter round-trips through `?type=tv,movie&source=1,2&status=upcoming&from=2026-10-01&to=2026-10-31&monitored=1`
 * so refresh, back/forward and deep links restore the exact view. Unknown or
 * malformed values are ignored rather than throwing.
 */
import type { CalendarEntry, CalendarMediaKind } from "@playarr-tv/api-client";
import { entryLocalDay, type Day } from "./calendar";

export type CalendarTypeParam = "tv" | "movie" | "music" | "book";
export type CalendarStatus = "aired" | "upcoming" | "downloaded" | "missing";

export const CALENDAR_TYPE_PARAMS: readonly CalendarTypeParam[] = ["tv", "movie", "music", "book"];
export const CALENDAR_STATUSES: readonly CalendarStatus[] = ["aired", "upcoming", "downloaded", "missing"];

const TYPE_TO_KIND: Record<CalendarTypeParam, CalendarMediaKind> = {
  tv: "episode",
  movie: "movie",
  music: "album",
  book: "book",
};

export function kindForType(type: CalendarTypeParam): CalendarMediaKind {
  return TYPE_TO_KIND[type];
}

export function typeForKind(kind: CalendarMediaKind): CalendarTypeParam {
  return (Object.keys(TYPE_TO_KIND) as CalendarTypeParam[]).find((type) => TYPE_TO_KIND[type] === kind)!;
}

export interface CalendarFilters {
  types: ReadonlySet<CalendarTypeParam>;
  /** Source instance ids. */
  sources: ReadonlySet<string>;
  statuses: ReadonlySet<CalendarStatus>;
  from: Day | null;
  to: Day | null;
  monitoredOnly: boolean;
}

export const EMPTY_CALENDAR_FILTERS: CalendarFilters = {
  types: new Set(),
  sources: new Set(),
  statuses: new Set(),
  from: null,
  to: null,
  monitoredOnly: false,
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function parseList<T extends string>(raw: string | null, allowed?: readonly T[]): Set<T> {
  const out = new Set<T>();
  for (const part of (raw ?? "").split(",")) {
    const value = part.trim();
    if (!value) continue;
    if (allowed && !(allowed as readonly string[]).includes(value)) continue;
    out.add(value as T);
  }
  return out;
}

function parseDayParam(raw: string | null): Day | null {
  if (!raw || !DAY.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw ? null : raw;
}

export function parseCalendarFilters(params: URLSearchParams): CalendarFilters {
  let from = parseDayParam(params.get("from"));
  let to = parseDayParam(params.get("to"));
  if (from && to && from > to) [from, to] = [to, from];
  return {
    types: parseList(params.get("type"), CALENDAR_TYPE_PARAMS),
    sources: parseList(params.get("source")),
    statuses: parseList(params.get("status"), CALENDAR_STATUSES),
    from,
    to,
    monitoredOnly: params.get("monitored") === "1",
  };
}

/** Returns a copy of `params` with the filter keys replaced; other keys are preserved. */
export function writeCalendarFilters(params: URLSearchParams, filters: CalendarFilters): URLSearchParams {
  const next = new URLSearchParams(params);
  const set = (key: string, value: string | null) => {
    if (value) next.set(key, value);
    else next.delete(key);
  };
  const list = (values: ReadonlySet<string>, order?: readonly string[]) => {
    const items = order ? order.filter((v) => values.has(v)) : [...values].sort();
    return items.length > 0 ? items.join(",") : null;
  };
  set("type", list(filters.types, CALENDAR_TYPE_PARAMS));
  set("source", list(filters.sources));
  set("status", list(filters.statuses, CALENDAR_STATUSES));
  set("from", filters.from);
  set("to", filters.to);
  set("monitored", filters.monitoredOnly ? "1" : null);
  return next;
}

export function activeFilterCount(filters: CalendarFilters): number {
  return (
    (filters.types.size > 0 ? 1 : 0) +
    (filters.sources.size > 0 ? 1 : 0) +
    (filters.statuses.size > 0 ? 1 : 0) +
    (filters.from || filters.to ? 1 : 0) +
    (filters.monitoredOnly ? 1 : 0)
  );
}

function matchesStatus(entry: CalendarEntry, status: CalendarStatus, today: Day): boolean {
  const aired = entryLocalDay(entry) <= today;
  switch (status) {
    case "aired":
      return aired;
    case "upcoming":
      return !aired;
    case "downloaded":
      return entry.has_file;
    case "missing":
      return aired && !entry.has_file;
  }
}

/** Filters entries; selected values within one filter are OR-ed, different filters are AND-ed. */
export function applyCalendarFilters(
  entries: readonly CalendarEntry[],
  filters: CalendarFilters,
  today: Day
): CalendarEntry[] {
  return entries.filter((entry) => {
    if (filters.types.size > 0 && !filters.types.has(typeForKind(entry.media_kind))) return false;
    if (filters.sources.size > 0 && !entry.sources.some((s) => filters.sources.has(s.source_instance_id))) {
      return false;
    }
    if (filters.statuses.size > 0 && ![...filters.statuses].some((s) => matchesStatus(entry, s, today))) {
      return false;
    }
    if (filters.monitoredOnly && !entry.monitored) return false;
    const day = entryLocalDay(entry);
    if (filters.from && day < filters.from) return false;
    if (filters.to && day > filters.to) return false;
    return true;
  });
}

/** Side panels that can be open; encoded as `?panel=filters|link`. */
export type CalendarPanel = "filters" | "link";
export const CALENDAR_PANELS: readonly CalendarPanel[] = ["filters", "link"];

/** Everything the calendar keeps in the URL besides the filters themselves. */
export interface CalendarUrlState {
  view: "agenda" | "week" | "month" | null;
  /** Anchor day (`?date=`). */
  date: Day | null;
  /** Selected entry id or group key (`?selected=`). */
  selected: string | null;
  panel: CalendarPanel | null;
}

export function parseCalendarUrl(params: URLSearchParams): CalendarUrlState {
  const view = params.get("view");
  // `subscription` is the pre-rename spelling of `link`; old deep links keep working.
  const rawPanel = params.get("panel");
  const panel = rawPanel === "subscription" ? "link" : rawPanel;
  return {
    view: view === "agenda" || view === "week" || view === "month" ? view : null,
    date: parseDayParam(params.get("date")),
    selected: params.get("selected") || null,
    panel: (CALENDAR_PANELS as readonly string[]).includes(panel ?? "") ? (panel as CalendarPanel) : null,
  };
}

/** Writes the URL state onto `params`, dropping empty values and preserving other keys. */
export function writeCalendarUrl(params: URLSearchParams, state: Partial<CalendarUrlState>): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of ["view", "date", "selected", "panel"] as const) {
    if (!(key in state)) continue;
    const value = state[key];
    if (value) next.set(key, value);
    else next.delete(key);
  }
  return next;
}
