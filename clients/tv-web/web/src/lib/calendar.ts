/**
 * Pure view-model helpers for the release calendar page.
 *
 * Days are plain `YYYY-MM-DD` strings. All arithmetic goes through UTC dates
 * so daylight-saving changes never skip or repeat a day; only
 * {@link localDayOf} and {@link entryLocalDay} read the viewer's time zone.
 */
import type {
  CalendarEntry,
  CalendarMediaKind,
  CalendarSourceStatus,
} from "@playarr-tv/api-client";

export type Day = string;
export type CalendarView = "month" | "week" | "agenda";

export const CALENDAR_VIEWS: readonly CalendarView[] = ["agenda", "week", "month"];
export const CALENDAR_KINDS: readonly CalendarMediaKind[] = ["episode", "movie", "album", "book"];
export const AGENDA_DAYS = 30;
/** Server limit on `end - start`, in days (inclusive span). */
export const MAX_RANGE_DAYS = 92;

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseDay(day: Day): Date {
  const match = DAY_PATTERN.exec(day);
  if (!match) throw new Error(`Invalid day: ${day}`);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

export function formatDay(date: Date): Day {
  const y = String(date.getUTCFullYear()).padStart(4, "0");
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(day: Day, count: number): Day {
  const date = parseDay(day);
  date.setUTCDate(date.getUTCDate() + count);
  return formatDay(date);
}

export function diffDays(from: Day, to: Day): number {
  return Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / 86_400_000);
}

/** Adds calendar months, clamping the day of month (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(day: Day, count: number): Day {
  const date = parseDay(day);
  const dayOfMonth = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + count);
  const last = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)
  ).getUTCDate();
  date.setUTCDate(Math.min(dayOfMonth, last));
  return formatDay(date);
}

/** The viewer's local calendar day for an instant. */
export function localDayOf(date: Date): Day {
  const y = String(date.getFullYear()).padStart(4, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Sunday = 0 ... Saturday = 6. */
export function weekdayOf(day: Day): number {
  return parseDay(day).getUTCDay();
}

/** First day of the week for a locale (Sunday = 0); Monday when unknown. */
export function weekStartsOn(locale?: string): number {
  try {
    const intlLocale = new Intl.Locale(locale ?? "en-GB") as Intl.Locale & {
      weekInfo?: { firstDay: number };
      getWeekInfo?: () => { firstDay: number };
    };
    const info = intlLocale.getWeekInfo?.() ?? intlLocale.weekInfo;
    if (info && info.firstDay >= 1 && info.firstDay <= 7) return info.firstDay % 7;
  } catch {
    // Fall through to the default.
  }
  return 1;
}

export function startOfWeek(day: Day, firstDay: number): Day {
  const offset = (weekdayOf(day) - firstDay + 7) % 7;
  return addDays(day, -offset);
}

export function startOfMonth(day: Day): Day {
  return `${day.slice(0, 7)}-01`;
}

export interface DayRange {
  /** Inclusive local day. */
  start: Day;
  /** Inclusive local day. */
  end: Day;
}

/** The local days a view displays for the given anchor day. */
export function visibleRange(view: CalendarView, anchor: Day, firstDay: number): DayRange {
  switch (view) {
    case "month": {
      const start = startOfWeek(startOfMonth(anchor), firstDay);
      const monthEnd = addDays(addMonths(startOfMonth(anchor), 1), -1);
      const end = addDays(startOfWeek(monthEnd, firstDay), 6);
      return { start, end };
    }
    case "week": {
      const start = startOfWeek(anchor, firstDay);
      return { start, end: addDays(start, 6) };
    }
    case "agenda":
      return { start: anchor, end: addDays(anchor, AGENDA_DAYS - 1) };
  }
}

/**
 * The UTC window to request for a visible local range. Entries are bucketed by
 * local day, which can differ from the UTC day by up to a day either way, so
 * the window is padded by one day on each side.
 */
export function fetchWindow(range: DayRange): { start: Day; end: Day } {
  return { start: addDays(range.start, -1), end: addDays(range.end, 1) };
}

/** Moves the anchor one page backwards (-1) or forwards (1). */
export function shiftAnchor(view: CalendarView, anchor: Day, direction: -1 | 1): Day {
  switch (view) {
    case "month":
      return addMonths(startOfMonth(anchor), direction);
    case "week":
      return addDays(anchor, 7 * direction);
    case "agenda":
      return addDays(anchor, AGENDA_DAYS * direction);
  }
}

/** The day an anchor snaps to when switching view, so "today" stays visible. */
export function anchorForView(view: CalendarView, anchor: Day): Day {
  return view === "month" ? startOfMonth(anchor) : anchor;
}

export function entryLocalDay(entry: CalendarEntry): Day {
  if (entry.release_at) {
    const instant = new Date(entry.release_at);
    if (!Number.isNaN(instant.getTime())) return localDayOf(instant);
  }
  return entry.date;
}

function entrySortKey(entry: CalendarEntry): number {
  if (entry.release_at) {
    const time = new Date(entry.release_at).getTime();
    if (!Number.isNaN(time)) return time;
  }
  return Number.NEGATIVE_INFINITY; // All-day entries sort first within their day.
}

export function compareEntries(a: CalendarEntry, b: CalendarEntry): number {
  const ak = entrySortKey(a);
  const bk = entrySortKey(b);
  if (ak !== bk) return ak < bk ? -1 : 1;
  const title = a.title.localeCompare(b.title);
  if (title !== 0) return title;
  return (
    (a.season_number ?? 0) - (b.season_number ?? 0) ||
    (a.episode_number ?? 0) - (b.episode_number ?? 0) ||
    a.id.localeCompare(b.id)
  );
}

export interface DayGroup {
  day: Day;
  entries: CalendarEntry[];
}

export function filterByKinds(
  entries: readonly CalendarEntry[],
  kinds: ReadonlySet<CalendarMediaKind>
): CalendarEntry[] {
  if (kinds.size === 0) return [...entries];
  return entries.filter((entry) => kinds.has(entry.media_kind));
}

/** Groups entries by local day inside `range`, ascending; days without entries are omitted. */
export function groupByLocalDay(
  entries: readonly CalendarEntry[],
  range?: DayRange
): DayGroup[] {
  const byDay = new Map<Day, CalendarEntry[]>();
  for (const entry of entries) {
    const day = entryLocalDay(entry);
    if (range && (day < range.start || day > range.end)) continue;
    const bucket = byDay.get(day);
    if (bucket) bucket.push(entry);
    else byDay.set(day, [entry]);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, list]) => ({ day, entries: list.sort(compareEntries) }));
}

export interface MonthCell {
  day: Day;
  inMonth: boolean;
  isToday: boolean;
  entries: CalendarEntry[];
}

/** Rows of seven cells covering the month view's range. */
export function buildMonthGrid(
  anchor: Day,
  firstDay: number,
  groups: readonly DayGroup[],
  today: Day
): MonthCell[][] {
  const range = visibleRange("month", anchor, firstDay);
  const month = anchor.slice(0, 7);
  const lookup = new Map(groups.map((group) => [group.day, group.entries]));
  const weeks: MonthCell[][] = [];
  for (let offset = 0; offset <= diffDays(range.start, range.end); offset += 7) {
    const week: MonthCell[] = [];
    for (let i = 0; i < 7; i += 1) {
      const day = addDays(range.start, offset + i);
      week.push({
        day,
        inMonth: day.startsWith(month),
        isToday: day === today,
        entries: lookup.get(day) ?? [],
      });
    }
    weeks.push(week);
  }
  return weeks;
}

/** Days of the week view (always seven, including empty ones). */
export function buildWeekDays(
  anchor: Day,
  firstDay: number,
  groups: readonly DayGroup[],
  today: Day
): MonthCell[] {
  const range = visibleRange("week", anchor, firstDay);
  const lookup = new Map(groups.map((group) => [group.day, group.entries]));
  return Array.from({ length: 7 }, (_, i) => {
    const day = addDays(range.start, i);
    return { day, inMonth: true, isToday: day === today, entries: lookup.get(day) ?? [] };
  });
}

export type EntryState = "inLibrary" | "monitored" | "notMonitored";

export function entryState(entry: Pick<CalendarEntry, "has_file" | "monitored">): EntryState {
  if (entry.has_file) return "inLibrary";
  return entry.monitored ? "monitored" : "notMonitored";
}

/**
 * Availability drives the coloured left border of every calendar entry: we have the item (a file in the
 * library the viewer can play) versus not (upcoming, missing or not playable by this viewer). It is never
 * the library or media kind. When the server listed actions, `play`/`resume` enabled is authoritative;
 * servers that send none fall back to `has_file`.
 */
export function entryAvailable(
  entry: Pick<CalendarEntry, "has_file"> & { actions?: readonly { action: string; enabled: boolean }[] }
): boolean {
  if (!entry.has_file) return false;
  const actions = entry.actions;
  if (!actions || actions.length === 0) return true;
  return actions.some((a) => (a.action === "play" || a.action === "resume") && a.enabled);
}

export type EntryAvailability = "available" | "unavailable";

/** A series group is available only when every folded episode is. */
export function itemAvailability(item: CalendarItem): EntryAvailability {
  const entries = item.kind === "single" ? [item.entry] : item.entries;
  return entries.every(entryAvailable) ? "available" : "unavailable";
}

/** `S01E02`, or null for entries that are not episodes. */
export function episodeCode(entry: CalendarEntry): string | null {
  if (entry.season_number == null || entry.episode_number == null) return null;
  const s = String(entry.season_number).padStart(2, "0");
  const e = String(entry.episode_number).padStart(2, "0");
  return `S${s}E${e}`;
}

/** Detail route for an entry's work, or null when it is not in the catalogue. */
export function workRouteForEntry(entry: CalendarEntry): string | null {
  if (!entry.work_id) return null;
  switch (entry.media_kind) {
    case "episode":
      return `/series/${entry.work_id}`;
    case "movie":
      return `/movies/${entry.work_id}`;
    case "album":
      return `/music/${entry.work_id}`;
    case "book":
      return `/library/${entry.work_id}`;
  }
}

/** Sources that did not answer cleanly; these must always be shown to the viewer. */
export function failedSources(
  sources: readonly CalendarSourceStatus[]
): CalendarSourceStatus[] {
  return sources.filter((source) => source.status !== "ok");
}

export interface ViewportProbe {
  isTv: boolean;
  matches: (query: string) => boolean;
}

/** Agenda on TV, touch and narrow screens; month on desktop pointers. */
export function defaultCalendarView(probe: ViewportProbe): CalendarView {
  if (probe.isTv) return "agenda";
  if (probe.matches("(max-width: 760px)") || probe.matches("(pointer: coarse)")) return "agenda";
  return "month";
}

export interface HumanDuration {
  value: number;
  unit: "minute" | "hour" | "day";
}

/** Rounds a duration to the most natural single unit ("about 3 hours"). */
export function humanDuration(seconds: number): HumanDuration {
  const abs = Math.max(0, seconds);
  const minutes = abs / 60;
  if (minutes < 90) return { value: Math.max(1, Math.round(minutes)), unit: "minute" };
  const hours = minutes / 60;
  if (hours < 48) return { value: roundSmart(hours), unit: "hour" };
  return { value: roundSmart(hours / 24), unit: "day" };
}

function roundSmart(value: number): number {
  return value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
}

export function formatHumanDuration(seconds: number, locale?: string): string {
  const { value, unit } = humanDuration(seconds);
  try {
    return new Intl.NumberFormat(locale, {
      style: "unit",
      unit,
      unitDisplay: "long",
      maximumFractionDigits: 1,
    }).format(value);
  } catch {
    return `${value} ${unit}${value === 1 ? "" : "s"}`;
  }
}

/** One episode release grouped with its siblings, or a standalone entry. */
export type CalendarItem =
  | { kind: "single"; key: string; entry: CalendarEntry }
  | {
      kind: "series";
      key: string;
      /** Series title shared by every grouped episode. */
      title: string;
      entries: CalendarEntry[];
      /** Compact episode label, e.g. `S02E04–E06` or `S02E01, E03`. */
      codes: string;
    };

function seasonLabel(season: number): string {
  return `S${String(season).padStart(2, "0")}`;
}

function episodeLabel(episode: number): string {
  return `E${String(episode).padStart(2, "0")}`;
}

/**
 * Compact label for a set of episodes: contiguous runs within a season become
 * `S02E04–E06`, gaps are listed (`S02E01, E03, E05`), and multiple seasons are
 * joined with commas (`S01E10, S02E01–E02`). Entries without numbers are ignored.
 */
export function formatEpisodeCodes(entries: readonly CalendarEntry[]): string {
  const bySeason = new Map<number, number[]>();
  for (const entry of entries) {
    if (entry.season_number == null || entry.episode_number == null) continue;
    const list = bySeason.get(entry.season_number) ?? [];
    if (!list.includes(entry.episode_number)) list.push(entry.episode_number);
    bySeason.set(entry.season_number, list);
  }
  const parts: string[] = [];
  for (const season of [...bySeason.keys()].sort((a, b) => a - b)) {
    const episodes = bySeason.get(season)!.sort((a, b) => a - b);
    const runs: Array<[number, number]> = [];
    for (const episode of episodes) {
      const last = runs[runs.length - 1];
      if (last && episode === last[1] + 1) last[1] = episode;
      else runs.push([episode, episode]);
    }
    runs.forEach(([from, to], index) => {
      const prefix = index === 0 ? seasonLabel(season) : "";
      parts.push(
        from === to
          ? `${prefix}${episodeLabel(from)}`
          : `${prefix}${episodeLabel(from)}–${episodeLabel(to)}`
      );
    });
  }
  return parts.join(", ");
}

function entryTimeSlot(entry: CalendarEntry): string {
  if (!entry.release_at) return "all-day";
  const date = new Date(entry.release_at);
  if (Number.isNaN(date.getTime())) return "all-day";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/**
 * Collapses episodes of the same series released on the same local day (and at
 * the same air time) into one grouped item. Movies, albums, books and lone
 * episodes stay individual. Input order is preserved for the first member of
 * each group. Pass the entries of ONE day.
 */
export function groupSeriesEpisodes(entries: readonly CalendarEntry[]): CalendarItem[] {
  const buckets = new Map<string, CalendarEntry[]>();
  const order: Array<string> = [];
  for (const entry of entries) {
    const groupable = entry.media_kind === "episode" && entry.season_number != null && entry.episode_number != null;
    const key = groupable
      ? `series:${entry.work_id ?? entry.title}:${entryLocalDay(entry)}:${entryTimeSlot(entry)}`
      : `single:${entry.id}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(entry);
    else {
      buckets.set(key, [entry]);
      order.push(key);
    }
  }
  return order.map((key): CalendarItem => {
    const members = buckets.get(key)!;
    if (members.length === 1) return { kind: "single", key: members[0]!.id, entry: members[0]! };
    const sorted = [...members].sort(compareEntries);
    return { kind: "series", key, title: sorted[0]!.title, entries: sorted, codes: formatEpisodeCodes(sorted) };
  });
}

/**
 * A calendar poster is a provider URL the browser loads directly, and the server sends the
 * full-size original (1 to 2 MB for a 100 px tile). The image provider serves fixed smaller widths
 * under the same path, so ask for one that fits the tile. Any other URL is returned unchanged.
 */
export function sizedPosterUrl(url: string, width = 185): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "image.tmdb.org") return url;
    const match = /^\/t\/p\/original\/(.+)$/.exec(parsed.pathname);
    if (!match) return url;
    parsed.pathname = `/t/p/w${width}/${match[1]}`;
    return parsed.toString();
  } catch {
    return url;
  }
}
