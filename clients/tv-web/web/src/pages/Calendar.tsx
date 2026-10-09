import { memo, useCallback, useEffect, useMemo, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import type {
  CalendarEntry,
  CalendarMediaKind,
  CalendarResponse,
} from "@playarr-tv/api-client";
import { CALENDAR_QUERY_TAGS, calendarCacheKey, prefetchCalendar, useAsyncData } from "@playarr-tv/api-client/react";
import { CalendarLink } from "../components/CalendarLink";
import { DetailsPanel } from "../components/DetailsPanel";
import { ListPanel } from "../components/tv/ListPanel";
import { StatusPill } from "../components/StatusPill";
import {
  DateRangeField,
  EmptyState,
  ErrorState,
  FilterSection,
  FiltersDrawer,
  MasterDetail,
  MultiSelect,
  PageLayout,
  type PageHeaderProps,
  SkeletonBlock,
  SkeletonLines,
  ViewToggle,
} from "../components/shell";
import { Button, buttonClassName } from "../components/ui";
import { SettledAnnouncer } from "../components/shell";
import { RequestButton } from "../components/RequestButton";
import { WatchlistToggle } from "../components/WatchlistToggle";
import { useApiClient } from "../lib/ApiClientProvider";
import { useToday } from "../lib/useToday";
import {
  CALENDAR_VIEWS,
  anchorForView,
  addDays,
  createAnchorStepper,
  createFocusSelection,
  releaseInstant,
  buildMonthGrid,
  buildWeekDays,
  defaultCalendarView,
  entryPillTone,
  itemPillTone,
  type EntryPillTone,
  itemAvailability,
  entryLocalDay,
  episodeCode,
  adjacentFetchWindows,
  fetchWindow,
  formatHumanDuration,
  groupByLocalDay,
  groupSeriesEpisodes,
  localDayOf,
  parseDay,
  sizedPosterUrl,
  visibleRange,
  weekStartsOn,
  workRouteForEntry,
  type CalendarItem,
  type CalendarView,
  type Day,
  type DayGroup,
} from "../lib/calendar";
import { legacySnapshot, planItemActions } from "../lib/calendarActions";
import {
  activeFilterCount,
  applyCalendarFilters,
  CALENDAR_STATUSES,
  CALENDAR_TYPE_PARAMS,
  EMPTY_CALENDAR_FILTERS,
  kindForType,
  parseCalendarFilters,
  parseCalendarUrl,
  writeCalendarFilters,
  writeCalendarUrl,
  type CalendarFilters,
  type CalendarStatus,
  type CalendarTypeParam,
} from "../lib/calendarFilters";
import { IS_TV } from "../lib/clientPlatform";
import { useLiveSubscription } from "../lib/liveEvents";
import { useMediaQuery } from "../lib/useMediaQuery";
import { useLanguage } from "../lib/i18n/LanguageProvider";
import { localeTagFor } from "../lib/i18n/languages";
import type { TranslationKey } from "../lib/i18n/translations";
import { captureNavigationLayer, useNavigationLayer } from "../lib/navigationLayer";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import { useScrollEdges } from "../lib/useScrollEdges";
import "./Calendar.css";
import { isBackKey } from "../lib/backKey";

/**
 * A scroll viewport inside a plain window: the one shared edge fade (`useScrollEdges`) shows on each
 * side where content continues. The scroller keeps its own element so native wheel, touch and focus
 * scrolling are unchanged.
 */
export function EdgeScroller({
  axis,
  as: Tag = "div",
  windowClassName = "",
  refreshKey = "",
  children,
  className,
  ...rest
}: {
  axis: "vertical" | "horizontal";
  as?: "div" | "section";
  windowClassName?: string;
  refreshKey?: string | number;
  children: ReactNode;
} & HTMLAttributes<HTMLElement> & { "data-tv-scroll-container"?: boolean; "data-tv-scroll-axis"?: string; "data-tv-nav-geometric"?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useScrollEdges(ref, axis, refreshKey);
  return (
    <div
      className={`calendar-edge-window${windowClassName ? ` ${windowClassName}` : ""}`}
      data-edge-window={axis}
    >
      <Tag ref={ref as never} className={`calendar-edge-scroller${className ? ` ${className}` : ""}`} {...rest}>
        {children}
      </Tag>
    </div>
  );
}

type TFunction = (key: TranslationKey, params?: Record<string, string | number>) => string;

const MONTH_CHIP_LIMIT = 3;

const KIND_KEYS: Record<CalendarMediaKind, TranslationKey> = {
  episode: "pages.calendar.kindEpisode",
  movie: "pages.calendar.kindMovie",
  album: "pages.calendar.kindAlbum",
  book: "pages.calendar.kindBook",
};

const TYPE_KEYS: Record<CalendarTypeParam, TranslationKey> = {
  tv: "pages.calendar.typeTv",
  movie: "pages.calendar.typeMovies",
  music: "pages.calendar.typeMusic",
  book: "pages.calendar.typeBooks",
};

const STATUS_KEYS: Record<CalendarStatus, TranslationKey> = {
  aired: "pages.calendar.statusAired",
  upcoming: "pages.calendar.statusUpcoming",
  downloaded: "pages.calendar.statusDownloaded",
  missing: "pages.calendar.statusMissing",
};

const VIEW_KEYS: Record<CalendarView, TranslationKey> = {
  agenda: "pages.calendar.viewAgenda",
  week: "pages.calendar.viewWeek",
  month: "pages.calendar.viewMonth",
};

const RELEASE_KEYS: Record<CalendarEntry["release_type"], TranslationKey> = {
  air: "pages.calendar.releaseAir",
  cinema: "pages.calendar.releaseCinema",
  digital: "pages.calendar.releaseDigital",
  physical: "pages.calendar.releasePhysical",
  release: "pages.calendar.releaseGeneric",
};

const PILL_KEYS: Record<EntryPillTone, TranslationKey> = {
  available: "pages.calendar.pillAvailable",
  upcoming: "pages.calendar.statusUpcoming",
  missing: "pages.calendar.statusMissing",
  neutral: "pages.calendar.pillNotTracked",
};

const FOCUS_URL_DEBOUNCE_MS = 250;
/** Quiet time after a period paints before its neighbours are loaded. */
const ADJACENT_PREFETCH_DELAY_MS = 400;

function utcFormatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" });
}

function formatDayHeading(day: Day, locale: string): string {
  return utcFormatter(locale, { weekday: "long", day: "numeric", month: "long" }).format(parseDay(day));
}

export function formatRangeLabel(view: CalendarView, anchor: Day, firstDay: number, locale: string): string {
  if (view === "month") {
    return utcFormatter(locale, { month: "long", year: "numeric" }).format(parseDay(anchor));
  }
  const range = visibleRange(view, anchor, firstDay);
  const short = utcFormatter(locale, { day: "numeric", month: "short" });
  const withYear = utcFormatter(locale, { day: "numeric", month: "short", year: "numeric" });
  return `${short.format(parseDay(range.start))} – ${withYear.format(parseDay(range.end))}`;
}

/**
 * The short range shown on the shell action button ("6–12 Oct", "Oct 2026"), locale-aware. The full label from
 * {@link formatRangeLabel} is the button's accessible name and the settled announcement.
 */
export function formatRangeButtonLabel(view: CalendarView, anchor: Day, firstDay: number, locale: string): string {
  if (view === "month") {
    return utcFormatter(locale, { month: "short", year: "numeric" }).format(parseDay(anchor));
  }
  const range = visibleRange(view, anchor, firstDay);
  return utcFormatter(locale, { day: "numeric", month: "short" }).formatRange(parseDay(range.start), parseDay(range.end));
}

function entryTime(entry: CalendarEntry): Date | null {
  return releaseInstant(entry);
}

const timeFormatters = new Map<string, Intl.DateTimeFormat>();
function formatEntryTime(locale: string, time: Date): string {
  let formatter = timeFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { timeStyle: "short" });
    timeFormatters.set(locale, formatter);
  }
  return formatter.format(time);
}

function entrySubtitle(entry: CalendarEntry): string | null {
  const parts = [episodeCode(entry), entry.subtitle ?? null].filter(
    (part): part is string => Boolean(part)
  );
  return parts.length > 0 ? parts.join(" · ") : null;
}

function TonePill({ tone, t }: { tone: EntryPillTone; t: TFunction }) {
  return <StatusPill tone={tone === "neutral" ? "neutral" : tone}>{t(PILL_KEYS[tone])}</StatusPill>;
}

type SeriesGroup = Extract<CalendarItem, { kind: "series" }>;

interface SelectHandlers {
  /** Agenda: moving focus onto an entry selects it, so the details panel follows the remote. */
  selectOnFocus?: boolean;
  selectedKey: string | null;
  /** `source: "focus"` marks a selection that only followed D-pad focus. */
  onSelect: (item: CalendarItem, target: HTMLElement, source?: "focus") => void;
}

function itemEntry(item: CalendarItem): CalendarEntry {
  return item.kind === "single" ? item.entry : item.entries[0]!;
}

function itemTitle(item: CalendarItem): string {
  return item.kind === "single" ? item.entry.title : item.title;
}

/**
 * The provider's poster at a tile-sized width. Routing these through the server's artwork proxy
 * was measured and rejected: a calendar month shows over a hundred posters, and one proxied
 * request each (about 0.9 s of relay latency apiece) took longer to finish (about 7 s against
 * 4.5 s) than loading the small provider images directly, for a few MB fewer bytes.
 */
function Poster({ entry }: { entry: CalendarEntry }) {
  return entry.poster_url ? (
    <img
      className="calendar-poster"
      src={sizedPosterUrl(entry.poster_url)}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
    />
  ) : (
    <span className="calendar-poster calendar-poster-empty" aria-hidden="true" />
  );
}

const ItemRow = memo(function ItemRow({
  item,
  t,
  locale,
  today,
  selected,
  onSelect,
  selectOnFocus,
}: {
  item: CalendarItem;
  t: TFunction;
  locale: string;
  today: Day;
  selected: boolean;
  onSelect: SelectHandlers["onSelect"];
  selectOnFocus?: boolean;
}) {
  const first = itemEntry(item);
  const time = entryTime(first);
  const isGroup = item.kind === "series";
  const subtitle = isGroup
    ? t("pages.calendar.groupSummary", { count: item.entries.length, codes: item.codes })
    : entrySubtitle(item.entry);
  const tone = itemPillTone(item, today);
  return (
    <li>
      <button
        type="button"
        className={`media-card media-card-solid calendar-entry calendar-availability-${itemAvailability(item)}${isGroup ? " calendar-entry-group" : ""}${selected ? " is-selected" : ""}`}
        data-navigation-focus-key={`calendar:${item.key}`}
        aria-pressed={selected}
        onClick={(event) => onSelect(item, event.currentTarget)}
        onFocus={selectOnFocus && !selected ? (event) => onSelect(item, event.currentTarget, "focus") : undefined}
      >
        <Poster entry={first} />
        <span className="calendar-entry-body">
          <span className="calendar-entry-title">{itemTitle(item)}</span>
          {subtitle ? <span className="calendar-entry-subtitle">{subtitle}</span> : null}
          <span className="calendar-entry-meta">
            <span>
              {time ? formatEntryTime(locale, time) : t("pages.calendar.allDay")}
            </span>
            <span>{t(RELEASE_KEYS[first.release_type])}</span>
            {isGroup ? null : <span>{t(KIND_KEYS[first.media_kind])}</span>}
            <TonePill tone={tone} t={t} />
          </span>
        </span>
      </button>
    </li>
  );
});

function SkeletonRow() {
  return (
    <li className="calendar-entry calendar-entry-skeleton" aria-hidden="true">
      <SkeletonBlock className="calendar-poster" />
      <span className="calendar-entry-body">
        <SkeletonBlock width="60%" height="1rem" />
        <SkeletonBlock width="40%" height="0.8rem" />
        <SkeletonBlock width="75%" height="0.7rem" />
      </span>
    </li>
  );
}

export function DaySections({
  days,
  t,
  locale,
  today,
  showEmpty,
  loading,
  selectedKey,
  onSelect,
  selectOnFocus,
}: {
  days: readonly { day: Day; entries: CalendarEntry[] }[];
  t: TFunction;
  locale: string;
  today: Day;
  showEmpty: boolean;
  loading?: boolean;
} & SelectHandlers) {
  const dayItems = useMemo(
    () => new Map(days.map((group) => [group.day, groupSeriesEpisodes(group.entries)] as const)),
    [days]
  );
  return (
    <div className={`calendar-days calendar-days-${showEmpty ? "week" : "agenda"}`}>
      {days
        .filter((group) => loading || showEmpty || group.entries.length > 0)
        .map((group, index) => {
          const dayProps = {
            className: `calendar-day${group.day === today ? " is-today" : ""}`,
            "aria-busy": loading ? true : undefined,
          };
          const content = (
            <>
              <h3>
                <time dateTime={group.day}>{formatDayHeading(group.day, locale)}</time>
                {group.day === today ? <span className="calendar-today-tag">{t("pages.calendar.today")}</span> : null}
              </h3>
              {loading ? (
                <ul>
                  {Array.from({ length: 1 + ((index + 1) % 2) }, (_, i) => (
                    <SkeletonRow key={i} />
                  ))}
                </ul>
              ) : group.entries.length > 0 ? (
                <ul>
                  {(dayItems.get(group.day) ?? []).map((item) => (
                    <ItemRow
                      key={item.key}
                      item={item}
                      t={t}
                      locale={locale}
                      today={today}
                      selected={selectedKey === item.key}
                      onSelect={onSelect}
                      selectOnFocus={selectOnFocus}
                    />
                  ))}
                </ul>
              ) : (
                <p className="muted calendar-day-empty">{t("pages.calendar.dayEmpty")}</p>
              )}
            </>
          );
          // Week columns scroll on their own, so each one carries its own edge fade.
          return showEmpty ? (
            <EdgeScroller
              key={group.day}
              axis="vertical"
              as="section"
              windowClassName="calendar-day-window"
              refreshKey={`${group.day}:${group.entries.length}:${loading}`}
              data-tv-scroll-container
              data-tv-scroll-axis="vertical"
              data-navigation-scroll-key={`calendar:day:${group.day}`}
              {...dayProps}
            >
              {content}
            </EdgeScroller>
          ) : (
            <section key={group.day} {...dayProps}>
              {content}
            </section>
          );
        })}
    </div>
  );
}

/** Week view: one wide column per day on a horizontally scrolling, snapping track. */
function WeekTrack(props: Parameters<typeof DaySections>[0]) {
  return (
    <EdgeScroller
      axis="horizontal"
      className="calendar-week-scroll"
      data-tv-scroll-container
      data-tv-scroll-axis="horizontal"
      data-navigation-scroll-key="calendar:week-x"
      data-tv-nav-geometric
      refreshKey={props.days.length}
    >
      <DaySections {...props} />
    </EdgeScroller>
  );
}

/**
 * Vertical space one month-cell chip and a cell's own chrome (padding, day number, "+N more") need, in rem so
 * they follow the root font size (a TV stage restates it), used to decide how many chips fit before "+N more".
 */
const CHIP_ROW_REM = 1.625;
const CELL_CHROME_REM = 3.25;

export function MonthGrid({
  anchor,
  firstDay,
  groups,
  today,
  t,
  locale,
  loading,
  selectedKey,
  onSelect,
  onMore,
}: {
  anchor: Day;
  firstDay: number;
  groups: readonly DayGroup[];
  today: Day;
  t: TFunction;
  locale: string;
  loading?: boolean;
  onMore: (day: Day) => void;
} & SelectHandlers) {
  const weeks = buildMonthGrid(anchor, firstDay, groups, today);
  const weekdayFormat = utcFormatter(locale, { weekday: "short" });
  const bodyRef = useRef<HTMLDivElement>(null);
  const [chipLimit, setChipLimit] = useState(MONTH_CHIP_LIMIT);

  // The grid always fills the space below the header (loading and loaded alike);
  // cells share it equally and show as many chips as fit, then "+N more".
  useEffect(() => {
    const element = bodyRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const cellHeight = element.clientHeight / weeks.length;
      setChipLimit(
        Math.max(1, Math.min(MONTH_CHIP_LIMIT + 2, Math.floor((cellHeight - CELL_CHROME_REM * rem) / (CHIP_ROW_REM * rem))))
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [weeks.length]);

  return (
    <EdgeScroller
      axis="horizontal"
      className="calendar-month-scroll"
      data-tv-scroll-container
      data-tv-scroll-axis="horizontal"
      data-navigation-scroll-key="calendar:month-x"
      data-tv-nav-geometric
      aria-busy={loading ? true : undefined}
      refreshKey={weeks.length}
    >
      <div className="calendar-month" role="group" aria-label={formatRangeLabel("month", anchor, firstDay, locale)}>
        <div className="calendar-month-head">
          {weeks[0]!.map((cell) => (
            <div key={cell.day} className="calendar-month-weekday">
              {weekdayFormat.format(parseDay(cell.day))}
            </div>
          ))}
        </div>
        <div
          ref={bodyRef}
          className="calendar-month-body"
          style={{ gridTemplateRows: `repeat(${weeks.length}, minmax(0, 1fr))` }}
        >
          {weeks.map((week, weekIndex) => (
            <div key={week[0]!.day} className="calendar-month-row">
              {week.map((cell, cellIndex) => {
                const items = groupSeriesEpisodes(cell.entries);
                const overflow = items.length > chipLimit;
                const shown = overflow ? items.slice(0, Math.max(1, chipLimit - 1)) : items;
                const hidden = items.length - shown.length;
                return (
                  <div
                    key={cell.day}
                    className={`calendar-month-cell${cell.inMonth ? "" : " is-outside"}${cell.isToday ? " is-today" : ""}`}
                  >
                    <time dateTime={cell.day} className="calendar-month-day">
                      {parseDay(cell.day).getUTCDate()}
                    </time>
                    <ul>
                      {loading && (weekIndex + cellIndex) % 3 !== 0 ? (
                        <li aria-hidden="true">
                          <SkeletonBlock className="calendar-chip-skeleton" />
                        </li>
                      ) : null}
                      {shown.map((item) => {
                        const entry = itemEntry(item);
                        const chipText = item.kind === "series" ? `${item.title} · ${item.entries.length}×` : entry.title;
                        return (
                          <li key={item.key}>
                            <button
                              type="button"
                              className={`media-card media-card-solid calendar-chip calendar-availability-${itemAvailability(item)}${item.kind === "series" ? " calendar-chip-group" : ""}${selectedKey === item.key ? " is-selected" : ""}`}
                              title={
                                item.kind === "series"
                                  ? `${item.title} · ${t("pages.calendar.groupSummary", {
                                      count: item.entries.length,
                                      codes: item.codes,
                                    })}`
                                  : [entry.title, entrySubtitle(entry)].filter(Boolean).join(" · ")
                              }
                              aria-label={`${chipText}, ${formatDayHeading(cell.day, locale)}`}
                              data-navigation-focus-key={`calendar:${item.key}`}
                              onClick={(event) => onSelect(item, event.currentTarget)}
                            >
                              {chipText}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                    {hidden > 0 ? (
                      <button type="button" className="calendar-more" onClick={() => onMore(cell.day)}>
                        {t("pages.calendar.more", { count: hidden })}
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </EdgeScroller>
  );
}

/** Details of the selected item in the shared details panel: pills for its state, then Play, Open, Request, Watchlist. */
function ItemDetails({
  item,
  t,
  locale,
  today,
  onOpen,
  onPlay,
  stage = false,
}: {
  item: CalendarItem;
  t: TFunction;
  locale: string;
  today: Day;
  /** The Library-style stage placement (agenda); otherwise in flow (the week and month sheet). */
  stage?: boolean;
  onOpen: ((route: string) => void) | null;
  onPlay: ((mediaFileId: string, title: string) => void) | null;
}) {
  const first = itemEntry(item);
  const time = entryTime(first);
  const { plan, target } = planItemActions(item);
  const route = workRouteForEntry(target);
  const subtitle = item.kind === "series"
    ? t("pages.calendar.groupSummary", { count: item.entries.length, codes: item.codes })
    : entrySubtitle(first);
  // A server without computed actions gets the earlier behaviour: open when the
  // entry is in the catalogue, otherwise request and watchlist.
  const openRoute = plan.legacy ? route : (plan.open?.route ?? null);
  const snapshot = plan.snapshot ?? legacySnapshot(target);
  // A group names the episode Play starts, so the button never hides which one it is.
  const code = item.kind === "series" ? episodeCode(target) : null;
  const playLabel = plan.play
    ? code
      ? t(plan.play.resume ? "pages.calendar.resumeEpisode" : "pages.calendar.playEpisode", { code })
      : t(plan.play.resume ? "discovery.action.resume" : "discovery.action.play")
    : "";
  const showRequest = plan.legacy ? !openRoute : plan.request !== null;
  const showWatchlist = plan.legacy ? !openRoute : plan.watchlist !== null;
  const tone = itemPillTone(item, today);
  const requested = Boolean(plan.request?.requested);
  const when = time ? (
    <time dateTime={first.release_at ?? undefined}>
      {new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "short" }).format(time)}
    </time>
  ) : (
    <>
      <time dateTime={first.date}>{formatDayHeading(first.date, locale)}</time>
      {" · "}
      {t("pages.calendar.allDay")}
    </>
  );
  const hints = [
    plan.request && !plan.request.enabled && plan.request.reason ? plan.request.reason : null,
    plan.watchlist && !plan.watchlist.enabled && plan.watchlist.reason ? plan.watchlist.reason : null,
  ].filter((hint): hint is string => Boolean(hint));
  return (
    <DetailsPanel
      placement={stage ? "stage" : "flow"}
      className={stage ? "calendar-details tv-library-preview" : "calendar-details"}
      eyebrow={`${t(KIND_KEYS[first.media_kind])} · ${t(RELEASE_KEYS[first.release_type])}`}
      title={<span id="calendar-details-title">{itemTitle(item)}</span>}
      meta={
        <>
          {subtitle ? <span>{subtitle}</span> : null}
          <span>{when}</span>
        </>
      }
      pills={
        <>
          <TonePill tone={tone} t={t} />
          {requested ? <StatusPill tone="requested">{t("pages.calendar.pillRequested")}</StatusPill> : null}
          {first.average_lag_seconds != null ? (
            <StatusPill>
              {t("pages.workDetail.availabilityLag", {
                duration: formatHumanDuration(first.average_lag_seconds, locale),
              })}
            </StatusPill>
          ) : null}
        </>
      }
      actions={
        <>
          {plan.play && onPlay ? (
            <Button variant="primary" onClick={() => onPlay(plan.play!.mediaFileId, first.title)}>
              {playLabel}
            </Button>
          ) : null}
          {openRoute && onOpen ? (
            <Button variant={plan.play ? "secondary" : "primary"} onClick={() => onOpen(openRoute)}>
              {first.media_kind === "episode" ? t("pages.calendar.openSeries") : t("pages.calendar.open")}
            </Button>
          ) : null}
          {showRequest ? (
            <RequestButton
              snapshot={snapshot}
              className={buttonClassName({ variant: openRoute ? "secondary" : "primary" })}
              disabled={plan.request ? !plan.request.enabled && !plan.request.requested : false}
              alreadyRequested={plan.request?.requested}
            />
          ) : null}
          {showWatchlist && !(plan.watchlist && !plan.watchlist.enabled) ? (
            <WatchlistToggle
              snapshot={snapshot}
              initialListed={plan.watchlist?.listed}
              className={buttonClassName({ variant: "secondary" })}
            />
          ) : null}
        </>
      }
    >
      {!openRoute && !plan.play ? <p className="hint">{t("pages.calendar.sheetNotInCatalogue")}</p> : null}
      {hints.map((hint) => (
        <p key={hint} className="hint">
          {hint}
        </p>
      ))}
      {item.kind === "series" ? (
        <ul className="calendar-group-episodes" aria-label={t("pages.calendar.sheetEpisodes")}>
          {item.entries.map((entry) => (
            <li key={entry.id}>
              <span className="calendar-group-code">{episodeCode(entry)}</span>
              <span className="calendar-group-name">{entry.subtitle ?? entry.title}</span>
              <TonePill tone={entryPillTone(entry, today)} t={t} />
            </li>
          ))}
        </ul>
      ) : null}
    </DetailsPanel>
  );
}

function DetailsSkeleton() {
  return (
    <div className="calendar-details details-panel is-stage tv-library-preview" aria-hidden="true">
      <SkeletonBlock width="30%" height="0.8rem" />
      <SkeletonBlock width="80%" height="2rem" />
      <SkeletonBlock width="50%" height="1rem" />
      <SkeletonLines count={4} />
      <SkeletonBlock width="9rem" height="2.75rem" />
    </div>
  );
}

/** Modal details for the month/week views (agenda shows them in its left pane). */
function DetailSheet({
  children,
  closeLabel,
  onClose,
}: {
  children: React.ReactNode;
  closeLabel: string;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isBackKey(event)) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose]);

  return (
    <div className="calendar-sheet-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="calendar-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="calendar-details-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
        <Button ref={closeRef} variant="secondary" onClick={onClose}>
          {closeLabel}
        </Button>
      </section>
    </div>
  );
}


const VIEW_ICONS: Record<CalendarView, "list" | "screen" | "cover"> = {
  agenda: "list",
  week: "screen",
  month: "cover",
};

/**
 * Aggregated release calendar: agenda, week and month views over every connected library source.
 * All state (view, date, filters, selection, open panel) lives in the URL.
 */
export function CalendarPage() {
  const { t, language } = useLanguage();
  const locale = localeTagFor(language);
  const client = useApiClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  useDocumentTitle(t("pages.calendar.title"));

  const firstDay = useMemo(() => weekStartsOn(locale), [locale]);
  const today = useToday();
  const isPhoneWidth = useMediaQuery("(max-width: 760px)");
  const [defaultView] = useState<CalendarView>(() =>
    defaultCalendarView({
      isTv: IS_TV,
      matches: (query) =>
        typeof window !== "undefined" && typeof window.matchMedia === "function"
          ? window.matchMedia(query).matches
          : false,
    })
  );

  const searchKey = searchParams.toString();
  // Filters depend only on the filter params: moving the selection must not
  // produce a new filters object and re-group the whole list.
  const filterKey = useMemo(() => {
    const params = new URLSearchParams(searchKey);
    for (const key of ["selected", "panel", "view", "date"]) params.delete(key);
    return params.toString();
  }, [searchKey]);
  const filters = useMemo(() => parseCalendarFilters(new URLSearchParams(filterKey)), [filterKey]);
  const urlState = useMemo(() => parseCalendarUrl(new URLSearchParams(searchKey)), [searchKey]);
  const view: CalendarView = urlState.view ?? defaultView;
  const anchor: Day = anchorForView(view, urlState.date ?? filters.from ?? today);
  const stepperRef = useRef<ReturnType<typeof createAnchorStepper> | null>(null);
  stepperRef.current ??= createAnchorStepper();
  const stepAnchor = (direction: -1 | 1) => setAnchor(stepperRef.current!.step(view, anchor, direction));
  const panel = urlState.panel;

  const updateParams = useCallback(
    (mutate: (params: URLSearchParams) => URLSearchParams) => {
      setSearchParams((current) => mutate(new URLSearchParams(current)), { replace: true });
    },
    [setSearchParams]
  );
  const setAnchor = (next: Day) => updateParams((params) => writeCalendarUrl(params, { date: next }));
  const setFilters = (next: CalendarFilters) => updateParams((params) => writeCalendarFilters(params, next));
  const setPanel = (next: "filters" | "link" | "period" | null) =>
    updateParams((params) => writeCalendarUrl(params, { panel: next }));

  const [reloadNonce, setReloadNonce] = useState(0);
  const openerRef = useRef<HTMLElement | null>(null);
  const [focusSelected, setFocusSelected] = useState<string | null>(null);
  const focusSelectionRef = useRef(
    createFocusSelection(FOCUS_URL_DEBOUNCE_MS, (key) => {
      commitSelectedRef.current(key);
    })
  );
  const commitSelectedRef = useRef<(key: string | null) => void>(() => undefined);
  commitSelectedRef.current = (key) => {
    updateParams((params) => writeCalendarUrl(params, { selected: key }));
    setFocusSelected(null);
  };

  const range = visibleRange(view, anchor, firstDay);
  const fetchRange = fetchWindow(range);
  const liveCalendar = useLiveSubscription({ areas: ["calendar"] });
  const state = useAsyncData<CalendarResponse>(
    () => client.getCalendar({ start: fetchRange.start, end: fetchRange.end }),
    [client, fetchRange.start, fetchRange.end, reloadNonce],
    {
      subscribe: liveCalendar,
      cache: { store: client.queries, key: calendarCacheKey(fetchRange.start, fetchRange.end), tags: CALENDAR_QUERY_TAGS },
    }
  );
  // Once this period has painted, load the previous and next ones so a step renders at once.
  const ready = state.status === "ready";
  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => {
      for (const window_ of adjacentFetchWindows(view, anchor, firstDay)) prefetchCalendar(client, window_);
    }, ADJACENT_PREFETCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [ready, client, view, anchor, firstDay]);

  const data = state.status === "ready" ? state.data : null;
  const loading = state.status !== "ready" && state.status !== "error";
  const groups = useMemo(
    () => (data ? groupByLocalDay(applyCalendarFilters(data.entries, filters, today), range) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, filters, today, range.start, range.end]
  );
  const items = useMemo(() => groups.flatMap((group) => groupSeriesEpisodes(group.entries)), [groups]);
  const sourceOptions = useMemo(
    () => (data?.sources ?? []).map((source) => ({ value: source.source_instance_id, label: source.display_label ?? source.name })),
    [data]
  );

  // Back from a title or the player lands on the entry that was open (audit A19).
  useNavigationLayer(`calendar:${items.length}:${view}`, !loading, !loading && data !== null);

  const selectedKey = focusSelected ?? urlState.selected;
  const selectedItem = items.find((item) => item.key === selectedKey) ?? null;
  // Agenda is master-detail: with nothing explicitly selected the first item is previewed.
  const detailItem = view === "agenda" ? (selectedItem ?? items[0] ?? null) : selectedItem;

  // A live refresh can remove or regroup the open item. The sheet then unmounts with focus inside it, so
  // drop the stale selection and put focus back where it came from (no notice: nothing here is an error).
  const staleSelection = view !== "agenda" && !loading && data !== null && urlState.selected !== null && selectedItem === null;
  useEffect(() => {
    if (!staleSelection) return;
    updateParams((params) => writeCalendarUrl(params, { selected: null }));
    const opener = openerRef.current;
    (opener?.isConnected ? opener : document.querySelector<HTMLElement>(".calendar-scroll [data-navigation-focus-key]"))?.focus({
      preventScroll: true,
    });
  }, [staleSelection, updateParams]);

  function select(item: CalendarItem, target: HTMLElement, source?: "focus") {
    openerRef.current = target;
    if (source !== "focus") {
      setFocusSelected(null);
      focusSelectionRef.current.commitNow(item.key);
      return;
    }
    // D-pad focus moves the details panel at once; the URL follows once the
    // focus settles, so key repeat does not run a router navigation per press.
    setFocusSelected(item.key);
    focusSelectionRef.current.focus(item.key);
  }
  const selectRef = useRef(select);
  selectRef.current = select;
  const stableSelect = useCallback(
    (item: CalendarItem, target: HTMLElement, source?: "focus") => selectRef.current(item, target, source),
    []
  );
  useEffect(() => {
    const selection = focusSelectionRef.current;
    return () => selection.cancel();
  }, []);
  /** The search string with any selection still waiting to be written to the URL. */
  const currentSearch = () => {
    const pending = focusSelectionRef.current.pending();
    if (pending === null) return location.search;
    const next = writeCalendarUrl(new URLSearchParams(location.search), { selected: pending }).toString();
    return next ? `?${next}` : "";
  };

  function clearSelection() {
    setFocusSelected(null);
    focusSelectionRef.current.commitNow(null);
    openerRef.current?.focus({ preventScroll: true });
  }
  const clearSelectionCb = useCallback(clearSelection, [updateParams]); // eslint-disable-line react-hooks/exhaustive-deps

  function openRoute(route: string) {
    const origin = captureNavigationLayer(location.pathname, location.key, openerRef.current);
    navigate(route, { state: { backTo: `/calendar${currentSearch()}`, navigationOrigin: origin } });
  }

  function playFile(mediaFileId: string, title: string) {
    const origin = captureNavigationLayer(location.pathname, location.key, openerRef.current);
    navigate(`/player/${mediaFileId}`, {
      state: { title, backTo: `/calendar${currentSearch()}`, mediaFileId, navigationOrigin: origin },
    });
  }

  function changeView(next: CalendarView) {
    if (next === view) return;
    updateParams((params) =>
      writeCalendarUrl(params, { view: next, date: anchorForView(next, anchor), selected: null })
    );
  }

  // Phones hide the stage's left panel (as on Library), so an agenda selection opens the sheet there.
  const rangeLabel = formatRangeLabel(view, anchor, firstDay, locale);
  const rangeButtonLabel = formatRangeButtonLabel(view, anchor, firstDay, locale);
  const visibleCount = groups.reduce((total, group) => total + group.entries.length, 0);
  const activeCount = activeFilterCount(filters);
  const selectProps: SelectHandlers = { selectedKey: view === "agenda" ? (detailItem?.key ?? null) : (selectedItem?.key ?? null), onSelect: stableSelect };

  const stateMessage =
    state.status === "error" ? (
      <ErrorState
        graphic="details"
        title={t("pages.calendar.loadError")}
        description={state.message}
        onRetry={() => setReloadNonce((n) => n + 1)}
        retryLabel={t("pages.calendar.retry")}
      />
    ) : state.status === "ready" && visibleCount === 0 ? (
      <EmptyState
        graphic="details"
        title={t("pages.calendar.emptyTitle")}
        description={activeCount > 0 ? t("pages.calendar.emptyFiltered") : t("pages.calendar.emptyDescription")}
      />
    ) : null;

  const skeletonDays = (): { day: Day; entries: CalendarEntry[] }[] =>
    Array.from({ length: view === "week" ? 7 : 4 }, (_, i) => ({
      day: addDays(view === "week" ? range.start : anchor, i),
      entries: [],
    }));

  let body: ReactNode = null;
  if (view === "month") {
    body = (
      <MonthGrid
        anchor={anchor}
        firstDay={firstDay}
        groups={groups}
        today={today}
        t={t}
        locale={locale}
        loading={loading}
        {...selectProps}
        onMore={(day) =>
          updateParams((params) => writeCalendarUrl(params, { view: "agenda", date: day, selected: null }))
        }
      />
    );
  } else if (view === "week") {
    body = (
      <WeekTrack
        days={loading ? skeletonDays() : buildWeekDays(anchor, firstDay, groups, today)}
        t={t}
        locale={locale}
        today={today}
        showEmpty
        loading={loading}
        {...selectProps}
      />
    );
  }

  // The agenda shows the previewed release's poster as the background art, like Home and Library.
  const agendaPoster = view === "agenda" && detailItem ? itemEntry(detailItem).poster_url : null;
  const agendaArt = agendaPoster
    ? {
        artKey: agendaPoster,
        art: <img src={sizedPosterUrl(agendaPoster, 780)} alt="" decoding="async" referrerPolicy="no-referrer" />,
      }
    : undefined;

  const pageHeader: PageHeaderProps = {
    title: t("pages.calendar.title"),
      back: { label: t("pages.calendar.backToHome"), to: "/" },
      actions: [
        {
          kind: "panel",
          id: "range",
          label: rangeButtonLabel,
          ariaLabel: t("pages.calendar.rangeButtonLabel", { range: rangeLabel }),
          icon: "calendar",
          open: panel === "period",
          onToggle: () => setPanel(panel === "period" ? null : "period"),
          controls: "calendar-period-drawer",
          buttonProps: { "data-tv-focus-default": true, "data-range-button": true },
        },
        {
          kind: "panel",
          id: "subscription",
          label: t("pages.calendar.subscription.title"),
          icon: "bell",
          open: panel === "link",
          onToggle: () => setPanel(panel === "link" ? null : "link"),
          controls: "calendar-subscribe-drawer",
        },
        {
          kind: "filters",
          label: t("pages.library.filters"),
          open: panel === "filters",
          onToggle: () => setPanel(panel === "filters" ? null : "filters"),
          controls: "calendar-filters-drawer",
          activeCount,
        },
      ],
  };

  const drawers = (
    <>
      <FiltersDrawer
        id="calendar-period-drawer"
        open={panel === "period"}
        kicker={t("pages.calendar.title")}
        title={t("pages.calendar.navigationLabel")}
        ariaLabel={t("pages.calendar.navigationLabel")}
        closeLabel={t("pages.library.closeFilters")}
        onClose={() => setPanel(null)}
      >
        <FilterSection title={rangeLabel}>
          <div className="calendar-nav" role="group" aria-label={t("pages.calendar.navigationLabel")}>
            <Button variant="icon" aria-label={t("pages.calendar.previous")} onClick={() => stepAnchor(-1)}>
              <span aria-hidden="true">←</span>
            </Button>
            <Button variant="secondary" onClick={() => setAnchor(anchorForView(view, localDayOf(new Date())))}>
              {t("pages.calendar.today")}
            </Button>
            <Button variant="icon" aria-label={t("pages.calendar.next")} onClick={() => stepAnchor(1)}>
              <span aria-hidden="true">→</span>
            </Button>
          </div>
        </FilterSection>
      </FiltersDrawer>

      <FiltersDrawer
        id="calendar-filters-drawer"
        open={panel === "filters"}
        kicker={t("pages.calendar.title")}
        title={t("pages.library.filters")}
        ariaLabel={t("pages.calendar.filterDrawerAriaLabel")}
        closeLabel={t("pages.library.closeFilters")}
        onClose={() => setPanel(null)}
      >
        <FilterSection title={t("pages.library.view")}>
          <ViewToggle
            ariaLabel={t("pages.calendar.viewsLabel")}
            value={view}
            onChange={changeView}
            options={CALENDAR_VIEWS.map((value) => ({
              value,
              icon: VIEW_ICONS[value],
              label: t(VIEW_KEYS[value]),
            }))}
          />
        </FilterSection>
        <FilterSection title={t("pages.calendar.filterType")}>
          <MultiSelect
            ariaLabel={t("pages.calendar.filterLabel")}
            options={CALENDAR_TYPE_PARAMS.map((value) => ({ value, label: t(TYPE_KEYS[value]) }))}
            selected={filters.types}
            onChange={(types) => setFilters({ ...filters, types })}
          />
        </FilterSection>
        {sourceOptions.length > 0 ? (
          <FilterSection title={t("pages.calendar.filterSource")}>
            <MultiSelect
              ariaLabel={t("pages.calendar.filterSource")}
              options={sourceOptions}
              selected={filters.sources}
              onChange={(next) => setFilters({ ...filters, sources: next })}
            />
          </FilterSection>
        ) : null}
        <FilterSection title={t("pages.calendar.filterStatus")}>
          <MultiSelect
            ariaLabel={t("pages.calendar.filterStatus")}
            options={CALENDAR_STATUSES.map((value) => ({ value, label: t(STATUS_KEYS[value]) }))}
            selected={filters.statuses}
            onChange={(statuses) => setFilters({ ...filters, statuses })}
          />
        </FilterSection>
        <FilterSection title={t("pages.calendar.filterDateRange")}>
          <DateRangeField
            from={filters.from}
            to={filters.to}
            fromLabel={t("pages.calendar.rangeFrom")}
            toLabel={t("pages.calendar.rangeTo")}
            clearLabel={t("pages.calendar.rangeClear")}
            onChange={({ from, to }) => {
              updateParams((params) => {
                const next = writeCalendarFilters(params, { ...filters, from, to });
                return from ? writeCalendarUrl(next, { date: from }) : next;
              });
            }}
          />
        </FilterSection>
        <FilterSection title={t("pages.calendar.filterMonitored")}>
          <MultiSelect
            ariaLabel={t("pages.calendar.filterMonitored")}
            options={[{ value: "monitored", label: t("pages.calendar.monitoredOnly") }]}
            selected={new Set(filters.monitoredOnly ? ["monitored"] : [])}
            onChange={(next) => setFilters({ ...filters, monitoredOnly: next.has("monitored") })}
          />
        </FilterSection>
        {activeCount > 0 ? (
          <section>
            <div className="tv-filter-choice-grid">
              <button
                type="button"
                onClick={() =>
                  updateParams((params) =>
                    writeCalendarFilters(params, EMPTY_CALENDAR_FILTERS)
                  )
                }
              >
                {t("pages.calendar.clearFilters")}
              </button>
            </div>
          </section>
        ) : null}
      </FiltersDrawer>

      <FiltersDrawer
        id="calendar-subscribe-drawer"
        open={panel === "link"}
        kicker={t("pages.calendar.title")}
        title={t("pages.calendar.subscription.title")}
        ariaLabel={t("pages.calendar.subscription.title")}
        closeLabel={t("pages.library.closeFilters")}
        onClose={() => setPanel(null)}
      >
        <CalendarLink />
      </FiltersDrawer>
    </>
  );

  const announcer = <SettledAnnouncer text={rangeLabel} />;

  if (view === "agenda") {
    // The agenda is the Library's page: the shared stage (art, left details panel, right list panel).
    return (
      <PageLayout
        pageId="calendar"
        body="panel"
        className="calendar-page calendar-view-agenda tv-library tv-directory"
        ariaLabel={t("pages.calendar.title")}
        backdrop={agendaArt ?? { artKey: "calendar-agenda" }}
        header={pageHeader}
      >
        {loading ? (
          <DetailsSkeleton />
        ) : detailItem ? (
          <ItemDetails item={detailItem} t={t} locale={locale} today={today} onOpen={openRoute} onPlay={playFile} stage />
        ) : null}
        <ListPanel
          ariaLabel={t("pages.calendar.title")}
          scrollKey="calendar:list"
          refreshKey={`${items.length}:${loading}`}
          contentClassName="calendar-agenda-content"
        >
          {stateMessage ?? (
            <DaySections
              days={loading ? skeletonDays() : groups}
              t={t}
              locale={locale}
              today={today}
              showEmpty={false}
              loading={loading}
              {...selectProps}
              selectOnFocus
            />
          )}
        </ListPanel>
        {announcer}
        {drawers}
        {selectedItem && isPhoneWidth && urlState.selected ? (
          <DetailSheet closeLabel={t("pages.calendar.sheetClose")} onClose={clearSelectionCb}>
            <ItemDetails
              item={selectedItem}
              t={t}
              locale={locale}
              today={today}
              onOpen={(route) => {
                openRoute(route);
              }}
              onPlay={playFile}
            />
          </DetailSheet>
        ) : null}
      </PageLayout>
    );
  }

  return (
    <PageLayout
      pageId="calendar"
      body="bleed"
      className={`calendar-page calendar-view-${view}`}
      ariaLabel={t("pages.calendar.title")}
      header={pageHeader}
    >
      {stateMessage}
      <div
        className={`calendar-scroll${stateMessage ? " is-hidden" : ""}`}
        data-navigation-scroll-key="calendar:body"
      >
        {body}
      </div>

      {announcer}
      {drawers}

      {selectedItem ? (
        <DetailSheet closeLabel={t("pages.calendar.sheetClose")} onClose={clearSelectionCb}>
          <ItemDetails
            item={selectedItem}
            t={t}
            locale={locale}
            today={today}
            onOpen={(route) => {
              openRoute(route);
            }}
            onPlay={playFile}
          />
        </DetailSheet>
      ) : null}
    </PageLayout>
  );
}
