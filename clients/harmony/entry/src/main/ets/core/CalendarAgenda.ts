/**
 * The TV calendar agenda, ported from web `lib/calendar.ts` and `pages/Calendar.tsx` (web is the
 * reference): days are `YYYY-MM-DD` strings with UTC arithmetic; only `localDayOf` and `entryLocalDay`
 * read the viewer's time zone. English labels as web `en.ts`.
 */

import type { CalendarEntry, CalendarMediaKind, CalendarReleaseType } from "./Types/Calendar";

export const AGENDA_DAYS = 30;

const WEEKDAYS: string[] = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS: string[] = ["January", "February", "March", "April", "May", "June", "July", "August",
  "September", "October", "November", "December"];
const MONTHS_SHORT: string[] = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 86400000;

function pad(value: number, width: number): string {
  let text = String(value);
  while (text.length < width) {
    text = "0" + text;
  }
  return text;
}

export function parseDay(day: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (match === null) {
    throw new Error("Invalid day: " + day);
  }
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

export function formatDay(date: Date): string {
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)}`;
}

export function addDays(day: string, count: number): string {
  const date = parseDay(day);
  date.setUTCDate(date.getUTCDate() + count);
  return formatDay(date);
}

/** The viewer's local calendar day for an instant. */
export function localDayOf(date: Date): string {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)}`;
}

/** The release instant, or null for an all-day release (date-only releases are midnight UTC). */
export function releaseInstant(entry: CalendarEntry): Date | null {
  if (entry.release_at === undefined || entry.release_at === null || entry.release_at.length === 0) {
    return null;
  }
  const instant = new Date(entry.release_at);
  const time = instant.getTime();
  if (Number.isNaN(time) || time % DAY_MS === 0) {
    return null;
  }
  return instant;
}

export function entryLocalDay(entry: CalendarEntry): string {
  const instant = releaseInstant(entry);
  return instant !== null ? localDayOf(instant) : entry.date;
}

function sortKey(entry: CalendarEntry): number {
  const instant = releaseInstant(entry);
  return instant !== null ? instant.getTime() : Number.NEGATIVE_INFINITY;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** All-day entries first, then by time, title, season, episode, id. */
export function compareEntries(a: CalendarEntry, b: CalendarEntry): number {
  const ak = sortKey(a);
  const bk = sortKey(b);
  if (ak !== bk) {
    return ak < bk ? -1 : 1;
  }
  const title = compareText(a.title, b.title);
  if (title !== 0) {
    return title;
  }
  const season = (a.season_number ?? 0) - (b.season_number ?? 0);
  if (season !== 0) {
    return season;
  }
  const episode = (a.episode_number ?? 0) - (b.episode_number ?? 0);
  return episode !== 0 ? episode : compareText(a.id, b.id);
}

export interface DayGroup {
  day: string;
  entries: CalendarEntry[];
}

/** Entries grouped by local day within [start, end], ascending; empty days omitted. */
export function groupByLocalDay(entries: CalendarEntry[], start: string, end: string): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const entry of entries) {
    const day = entryLocalDay(entry);
    if (day < start || day > end) {
      continue;
    }
    let group: DayGroup | undefined = undefined;
    for (const candidate of groups) {
      if (candidate.day === day) {
        group = candidate;
      }
    }
    if (group === undefined) {
      groups.push({ day: day, entries: [entry] });
    } else {
      group.entries.push(entry);
    }
  }
  groups.sort((a: DayGroup, b: DayGroup): number => compareText(a.day, b.day));
  for (const group of groups) {
    group.entries.sort(compareEntries);
  }
  return groups;
}

export type EntryPillTone = "available" | "upcoming" | "missing" | "neutral";

/** Have it, not out yet, out but absent, or nothing to report. */
export function entryPillTone(entry: CalendarEntry, today: string): EntryPillTone {
  if (entry.has_file) {
    return "available";
  }
  if (entryLocalDay(entry) > today) {
    return "upcoming";
  }
  return entry.monitored ? "missing" : "neutral";
}

export function pillLabel(tone: EntryPillTone): string {
  if (tone === "available") {
    return "Available";
  }
  if (tone === "upcoming") {
    return "Upcoming";
  }
  return tone === "missing" ? "Missing" : "Not tracked";
}

/** The left border: playable (a file the viewer can play) versus not; never the library or kind. */
export function entryAvailable(entry: CalendarEntry): boolean {
  if (!entry.has_file) {
    return false;
  }
  const actions = entry.actions;
  if (actions === undefined || actions.length === 0) {
    return true;
  }
  return actions.some((action) => (action.action === "play" || action.action === "resume") && action.enabled);
}

/** `S01E02`, or null for entries that are not episodes. */
export function episodeCode(entry: CalendarEntry): string | null {
  if (entry.season_number === undefined || entry.season_number === null ||
    entry.episode_number === undefined || entry.episode_number === null) {
    return null;
  }
  return `S${pad(entry.season_number, 2)}E${pad(entry.episode_number, 2)}`;
}

/** "S02E13 · TBA": the episode code and subtitle, whichever exist. */
export function entrySubtitle(entry: CalendarEntry): string {
  const parts: string[] = [];
  const code = episodeCode(entry);
  if (code !== null) {
    parts.push(code);
  }
  if (entry.subtitle !== undefined && entry.subtitle !== null && entry.subtitle.length > 0) {
    parts.push(entry.subtitle);
  }
  return parts.join(" · ");
}

export function releaseTypeLabel(type: CalendarReleaseType): string {
  if (type === "air") {
    return "Airs";
  }
  if (type === "cinema") {
    return "In cinemas";
  }
  if (type === "digital") {
    return "Digital release";
  }
  return type === "physical" ? "Physical release" : "Release";
}

export function mediaKindLabel(kind: CalendarMediaKind): string {
  if (kind === "episode") {
    return "Episodes";
  }
  if (kind === "movie") {
    return "Movies";
  }
  return kind === "album" ? "Albums" : "Books";
}

/** "15:00", or "All day" for a date-only release. */
export function entryTimeLabel(entry: CalendarEntry): string {
  const instant = releaseInstant(entry);
  return instant !== null ? `${pad(instant.getHours(), 2)}:${pad(instant.getMinutes(), 2)}` : "All day";
}

/** "Sunday 11 October" (agenda day heading). */
export function dayHeading(day: string): string {
  const date = parseDay(day);
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

/** "Sunday, 11 October 2026 at 15:00", or "Sunday, 11 October 2026" for all day (details panel). */
export function entryWhenLabel(entry: CalendarEntry): string {
  const date = parseDay(entryLocalDay(entry));
  const dayText = `${WEEKDAYS[date.getUTCDay()]}, ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
  const instant = releaseInstant(entry);
  return instant !== null ? `${dayText} at ${entryTimeLabel(entry)}` : dayText;
}

/** The agenda range button: "11 Oct – 9 Nov" (same month: "1 – 30 Oct"). */
export function agendaRangeLabel(start: string): string {
  const from = parseDay(start);
  const to = parseDay(addDays(start, AGENDA_DAYS - 1));
  if (from.getUTCMonth() === to.getUTCMonth() && from.getUTCFullYear() === to.getUTCFullYear()) {
    return `${from.getUTCDate()} – ${to.getUTCDate()} ${MONTHS_SHORT[to.getUTCMonth()]}`;
  }
  return `${from.getUTCDate()} ${MONTHS_SHORT[from.getUTCMonth()]} – ${to.getUTCDate()} ${MONTHS_SHORT[to.getUTCMonth()]}`;
}
