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
  // Web uses `localeCompare`: case-insensitive first ("Family Guy" before "FBI"), then exact.
  const folded = compareText(a.title.toLowerCase(), b.title.toLowerCase());
  const title = folded !== 0 ? folded : compareText(a.title, b.title);
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

// ---------------------------------------------------------------------------------------------------------
// Week and month views (web `visibleRange`, `startOfWeek`, `buildMonthGrid`, `buildWeekDays`, `shiftAnchor`).
// ---------------------------------------------------------------------------------------------------------

export type CalendarView = "agenda" | "week" | "month";

/** en-GB weeks start on Monday (web `weekStartsOn` for the TV locale). */
export const FIRST_DAY_OF_WEEK = 1;

export function startOfWeek(day: string, firstDay: number): string {
  const weekday = parseDay(day).getUTCDay();
  return addDays(day, -((weekday - firstDay + 7) % 7));
}

export function startOfMonth(day: string): string {
  return day.slice(0, 8) + "01";
}

/** Adds calendar months, clamping the day of month. */
export function addMonths(day: string, count: number): string {
  const date = parseDay(day);
  const dayOfMonth = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + count);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(dayOfMonth, last));
  return formatDay(date);
}

export interface DayRange {
  start: string;
  end: string;
}

/** The local days a view shows for an anchor day. */
export function visibleRange(view: CalendarView, anchor: string): DayRange {
  if (view === "month") {
    const start = startOfWeek(startOfMonth(anchor), FIRST_DAY_OF_WEEK);
    const monthEnd = addDays(addMonths(startOfMonth(anchor), 1), -1);
    return { start: start, end: addDays(startOfWeek(monthEnd, FIRST_DAY_OF_WEEK), 6) };
  }
  if (view === "week") {
    const start = startOfWeek(anchor, FIRST_DAY_OF_WEEK);
    return { start: start, end: addDays(start, 6) };
  }
  return { start: anchor, end: addDays(anchor, AGENDA_DAYS - 1) };
}

/** One page back (-1) or forward (1). */
export function shiftAnchor(view: CalendarView, anchor: string, direction: number): string {
  if (view === "month") {
    return addMonths(startOfMonth(anchor), direction);
  }
  return addDays(anchor, (view === "week" ? 7 : AGENDA_DAYS) * direction);
}

/** The range button text: "11 Oct – 9 Nov" (agenda), "5 – 11 Oct" (week), "Oct 2026" (month). */
export function rangeLabel(view: CalendarView, anchor: string): string {
  if (view === "month") {
    const date = parseDay(startOfMonth(anchor));
    return `${MONTHS_SHORT[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
  }
  const range = visibleRange(view, anchor);
  const from = parseDay(range.start);
  const to = parseDay(range.end);
  if (from.getUTCMonth() === to.getUTCMonth() && from.getUTCFullYear() === to.getUTCFullYear()) {
    return `${from.getUTCDate()} – ${to.getUTCDate()} ${MONTHS_SHORT[to.getUTCMonth()]}`;
  }
  return `${from.getUTCDate()} ${MONTHS_SHORT[from.getUTCMonth()]} – ${to.getUTCDate()} ${MONTHS_SHORT[to.getUTCMonth()]}`;
}

export interface CalendarCell {
  day: string;
  inMonth: boolean;
  isToday: boolean;
  entries: CalendarEntry[];
}

function entriesFor(groups: DayGroup[], day: string): CalendarEntry[] {
  for (const group of groups) {
    if (group.day === day) {
      return group.entries;
    }
  }
  return [];
}

/** Rows of seven cells covering the month view's range. */
export function buildMonthGrid(anchor: string, groups: DayGroup[], today: string): CalendarCell[][] {
  const range = visibleRange("month", anchor);
  const month = anchor.slice(0, 7);
  const weeks: CalendarCell[][] = [];
  for (let day = range.start; day <= range.end; day = addDays(day, 7)) {
    const week: CalendarCell[] = [];
    for (let i = 0; i < 7; i++) {
      const cellDay = addDays(day, i);
      week.push({ day: cellDay, inMonth: cellDay.startsWith(month), isToday: cellDay === today,
        entries: entriesFor(groups, cellDay) });
    }
    weeks.push(week);
  }
  return weeks;
}

/** The seven days of the week view, empty ones included. */
export function buildWeekDays(anchor: string, groups: DayGroup[], today: string): CalendarCell[] {
  const start = visibleRange("week", anchor).start;
  const days: CalendarCell[] = [];
  for (let i = 0; i < 7; i++) {
    const day = addDays(start, i);
    days.push({ day: day, inMonth: true, isToday: day === today, entries: entriesFor(groups, day) });
  }
  return days;
}

export const WEEKDAY_SHORT: string[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function dayOfMonth(day: string): number {
  return parseDay(day).getUTCDate();
}

// ---------------------------------------------------------------------------------------------------------
// Same-day series grouping (web `groupSeriesEpisodes`, `formatEpisodeCodes`, `itemPillTone`, `itemAvailability`).
// ---------------------------------------------------------------------------------------------------------

/** One calendar line: a standalone entry, or several episodes of one series released together. */
export interface CalendarItem {
  key: string;
  title: string;
  entries: CalendarEntry[];
  /** `S02E04–E06` style label; empty for a standalone entry. */
  codes: string;
  grouped: boolean;
}

function seasonLabel(season: number): string {
  return `S${pad(season, 2)}`;
}

function episodeLabel(episode: number): string {
  return `E${pad(episode, 2)}`;
}

/** Contiguous runs become `S02E04–E06`, gaps are listed (`S02E01, E03`), seasons are joined with commas. */
export function formatEpisodeCodes(entries: CalendarEntry[]): string {
  const seasons: number[] = [];
  const episodesBySeason: number[][] = [];
  for (const entry of entries) {
    if (entry.season_number === undefined || entry.season_number === null ||
      entry.episode_number === undefined || entry.episode_number === null) {
      continue;
    }
    let index = seasons.indexOf(entry.season_number);
    if (index < 0) {
      seasons.push(entry.season_number);
      episodesBySeason.push([]);
      index = seasons.length - 1;
    }
    if (episodesBySeason[index].indexOf(entry.episode_number) < 0) {
      episodesBySeason[index].push(entry.episode_number);
    }
  }
  const order = seasons.map((season: number, index: number): number => index);
  order.sort((a: number, b: number): number => seasons[a] - seasons[b]);
  const parts: string[] = [];
  for (const index of order) {
    const episodes = episodesBySeason[index].slice();
    episodes.sort((a: number, b: number): number => a - b);
    const runs: number[][] = [];
    for (const episode of episodes) {
      const last = runs.length > 0 ? runs[runs.length - 1] : undefined;
      if (last !== undefined && episode === last[1] + 1) {
        last[1] = episode;
      } else {
        runs.push([episode, episode]);
      }
    }
    runs.forEach((run: number[], runIndex: number): void => {
      const prefix = runIndex === 0 ? seasonLabel(seasons[index]) : "";
      parts.push(run[0] === run[1] ? `${prefix}${episodeLabel(run[0])}` :
        `${prefix}${episodeLabel(run[0])}–${episodeLabel(run[1])}`);
    });
  }
  return parts.join(", ");
}

function timeSlot(entry: CalendarEntry): string {
  const instant = releaseInstant(entry);
  return instant === null ? "all-day" : `${pad(instant.getHours(), 2)}:${pad(instant.getMinutes(), 2)}`;
}

/** Episodes of one series on the same local day and air time collapse into one item; order is kept. */
export function groupSeriesEpisodes(entries: CalendarEntry[]): CalendarItem[] {
  const keys: string[] = [];
  const buckets: CalendarEntry[][] = [];
  for (const entry of entries) {
    const groupable = entry.media_kind === "episode" && entry.season_number !== undefined &&
      entry.season_number !== null && entry.episode_number !== undefined && entry.episode_number !== null;
    const series = entry.work_id !== undefined && entry.work_id !== null ? entry.work_id : entry.title;
    const key = groupable ? `series:${series}:${entryLocalDay(entry)}:${timeSlot(entry)}` : `single:${entry.id}`;
    const index = keys.indexOf(key);
    if (index < 0) {
      keys.push(key);
      buckets.push([entry]);
    } else {
      buckets[index].push(entry);
    }
  }
  return keys.map((key: string, index: number): CalendarItem => {
    const members = buckets[index];
    if (members.length === 1) {
      return { key: members[0].id, title: members[0].title, entries: members, codes: "", grouped: false };
    }
    const sorted = members.slice();
    sorted.sort(compareEntries);
    return { key: key, title: sorted[0].title, entries: sorted, codes: formatEpisodeCodes(sorted), grouped: true };
  });
}

/** A group reports its worst state: missing, then upcoming, then not tracked, else available. */
export function itemPillTone(item: CalendarItem, today: string): EntryPillTone {
  const tones = item.entries.map((entry: CalendarEntry): EntryPillTone => entryPillTone(entry, today));
  const order: EntryPillTone[] = ["missing", "upcoming", "neutral"];
  for (const tone of order) {
    if (tones.indexOf(tone) >= 0) {
      return tone;
    }
  }
  return "available";
}

/** A group is available only when every episode is. */
export function itemAvailable(item: CalendarItem): boolean {
  return item.entries.every((entry: CalendarEntry): boolean => entryAvailable(entry));
}

/** The second line of a card: the entry's code and subtitle, or "2 episodes · S00E15, S01E08". */
export function itemSubtitle(item: CalendarItem): string {
  return item.grouped ? `${item.entries.length} episodes · ${item.codes}` : entrySubtitle(item.entries[0]);
}

/** A month line: the title, or "Title · 2×" for a group. */
export function itemLineText(item: CalendarItem): string {
  return item.grouped ? `${item.title} · ${item.entries.length}×` : item.title;
}
