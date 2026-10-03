import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type {
  CalendarEntry,
  CalendarMediaKind,
  CalendarResponse,
  CalendarSourceStatus,
} from "@playarr-tv/api-client";
import { useAsyncData } from "@playarr-tv/api-client/react";
import { CalendarSubscription } from "../components/CalendarSubscription";
import { useApiClient } from "../lib/ApiClientProvider";
import {
  CALENDAR_KINDS,
  CALENDAR_VIEWS,
  anchorForView,
  buildMonthGrid,
  buildWeekDays,
  defaultCalendarView,
  entryState,
  episodeCode,
  failedSources,
  fetchWindow,
  filterByKinds,
  formatHumanDuration,
  groupByLocalDay,
  localDayOf,
  parseDay,
  shiftAnchor,
  visibleRange,
  weekStartsOn,
  workRouteForEntry,
  type CalendarView,
  type Day,
  type DayGroup,
} from "../lib/calendar";
import { IS_TV } from "../lib/clientPlatform";
import { useLanguage } from "../lib/i18n/LanguageProvider";
import type { TranslationKey } from "../lib/i18n/translations";
import { captureNavigationLayer } from "../lib/navigationLayer";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import "./Calendar.css";

type TFunction = (key: TranslationKey, params?: Record<string, string | number>) => string;

const LOCALE_TAGS: Record<string, string> = { en: "en-GB", th: "th-TH", ja: "ja-JP" };
const MONTH_CHIP_LIMIT = 3;

const KIND_KEYS: Record<CalendarMediaKind, TranslationKey> = {
  episode: "pages.calendar.kindEpisode",
  movie: "pages.calendar.kindMovie",
  album: "pages.calendar.kindAlbum",
  book: "pages.calendar.kindBook",
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

const STATE_KEYS = {
  inLibrary: "pages.calendar.stateInLibrary",
  monitored: "pages.calendar.stateMonitored",
  notMonitored: "pages.calendar.stateNotMonitored",
} as const satisfies Record<string, TranslationKey>;

const SOURCE_STATUS_KEYS: Record<Exclude<CalendarSourceStatus["status"], "ok">, TranslationKey> = {
  unreachable: "pages.calendar.sourceUnreachable",
  rejected: "pages.calendar.sourceRejected",
  error: "pages.calendar.sourceError",
};

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

function entryTime(entry: CalendarEntry): Date | null {
  if (!entry.release_at) return null;
  const date = new Date(entry.release_at);
  return Number.isNaN(date.getTime()) ? null : date;
}

function entrySubtitle(entry: CalendarEntry): string | null {
  const parts = [episodeCode(entry), entry.subtitle ?? null].filter(
    (part): part is string => Boolean(part)
  );
  return parts.length > 0 ? parts.join(" · ") : null;
}

function sourceReason(source: CalendarSourceStatus, t: TFunction): string {
  const label = t(SOURCE_STATUS_KEYS[source.status as Exclude<CalendarSourceStatus["status"], "ok">]);
  return source.error ? `${label} (${source.error})` : label;
}

/** Visible banner for sources that did not answer cleanly; never collapsed away. */
export function CalendarSourceBanner({
  sources,
  t,
}: {
  sources: readonly CalendarSourceStatus[];
  t: TFunction;
}) {
  const failed = failedSources(sources);
  if (failed.length === 0) return null;
  return (
    <div className="calendar-banner" role="alert">
      <strong>{t("pages.calendar.sourcesBannerTitle", { count: failed.length })}</strong>
      <ul>
        {failed.map((source) => (
          <li key={source.source_instance_id}>
            {t("pages.calendar.sourceLine", { name: source.name, reason: sourceReason(source, t) })}
          </li>
        ))}
      </ul>
    </div>
  );
}

function StateBadge({ entry, t }: { entry: CalendarEntry; t: TFunction }) {
  const state = entryState(entry);
  return (
    <span className={`calendar-badge calendar-badge-${state}`}>{t(STATE_KEYS[state])}</span>
  );
}

interface EntryHandlers {
  onOpen: (entry: CalendarEntry, target: HTMLElement) => void;
}

function EntryRow({
  entry,
  t,
  locale,
  onOpen,
}: { entry: CalendarEntry; t: TFunction; locale: string } & EntryHandlers) {
  const time = entryTime(entry);
  const subtitle = entrySubtitle(entry);
  return (
    <li>
      <button
        type="button"
        className={`calendar-entry calendar-kind-${entry.media_kind}`}
        data-navigation-focus-key={`calendar:${entry.id}`}
        onClick={(event) => onOpen(entry, event.currentTarget)}
      >
        {entry.poster_url ? (
          <img
            className="calendar-poster"
            src={entry.poster_url}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="calendar-poster calendar-poster-empty" aria-hidden="true" />
        )}
        <span className="calendar-entry-body">
          <span className="calendar-entry-title">{entry.title}</span>
          {subtitle ? <span className="calendar-entry-subtitle">{subtitle}</span> : null}
          <span className="calendar-entry-meta">
            <span>
              {time
                ? new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(time)
                : t("pages.calendar.allDay")}
            </span>
            <span>{t(RELEASE_KEYS[entry.release_type])}</span>
            <span>{t(KIND_KEYS[entry.media_kind])}</span>
            <StateBadge entry={entry} t={t} />
          </span>
        </span>
      </button>
    </li>
  );
}

function DaySections({
  days,
  t,
  locale,
  today,
  showEmpty,
  onOpen,
}: {
  days: readonly { day: Day; entries: CalendarEntry[] }[];
  t: TFunction;
  locale: string;
  today: Day;
  showEmpty: boolean;
} & EntryHandlers) {
  return (
    <div className={`calendar-days calendar-days-${showEmpty ? "week" : "agenda"}`}>
      {days
        .filter((group) => showEmpty || group.entries.length > 0)
        .map((group) => (
          <section
            key={group.day}
            className={`calendar-day${group.day === today ? " is-today" : ""}`}
            aria-label={formatDayHeading(group.day, locale)}
          >
            <h3>
              <time dateTime={group.day}>{formatDayHeading(group.day, locale)}</time>
              {group.day === today ? <span className="calendar-today-tag">{t("pages.calendar.today")}</span> : null}
            </h3>
            {group.entries.length > 0 ? (
              <ul>
                {group.entries.map((entry) => (
                  <EntryRow key={entry.id} entry={entry} t={t} locale={locale} onOpen={onOpen} />
                ))}
              </ul>
            ) : (
              <p className="muted calendar-day-empty">{t("pages.calendar.dayEmpty")}</p>
            )}
          </section>
        ))}
    </div>
  );
}

function MonthGrid({
  anchor,
  firstDay,
  groups,
  today,
  t,
  locale,
  onOpen,
  onMore,
}: {
  anchor: Day;
  firstDay: number;
  groups: readonly DayGroup[];
  today: Day;
  t: TFunction;
  locale: string;
  onMore: (day: Day) => void;
} & EntryHandlers) {
  const weeks = buildMonthGrid(anchor, firstDay, groups, today);
  const weekdayFormat = utcFormatter(locale, { weekday: "short" });
  return (
    <div
      className="calendar-month-scroll"
      data-tv-scroll-container
      data-tv-scroll-axis="horizontal"
      data-navigation-scroll-key="calendar:month-x"
    >
      <table className="calendar-month">
        <thead>
          <tr>
            {weeks[0]!.map((cell) => (
              <th key={cell.day} scope="col">
                {weekdayFormat.format(parseDay(cell.day))}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0]!.day}>
              {week.map((cell) => {
                const shown = cell.entries.slice(0, MONTH_CHIP_LIMIT);
                const hidden = cell.entries.length - shown.length;
                return (
                  <td
                    key={cell.day}
                    className={`${cell.inMonth ? "" : "is-outside "}${cell.isToday ? "is-today" : ""}`}
                  >
                    <time dateTime={cell.day} className="calendar-month-day">
                      {parseDay(cell.day).getUTCDate()}
                    </time>
                    <ul>
                      {shown.map((entry) => (
                        <li key={entry.id}>
                          <button
                            type="button"
                            className={`calendar-chip calendar-kind-${entry.media_kind}`}
                            title={[entry.title, entrySubtitle(entry)].filter(Boolean).join(" · ")}
                            data-navigation-focus-key={`calendar:${entry.id}`}
                            onClick={(event) => onOpen(entry, event.currentTarget)}
                          >
                            {entry.title}
                          </button>
                        </li>
                      ))}
                    </ul>
                    {hidden > 0 ? (
                      <button type="button" className="calendar-more" onClick={() => onMore(cell.day)}>
                        {t("pages.calendar.more", { count: hidden })}
                      </button>
                    ) : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EntrySheet({
  entry,
  t,
  locale,
  onClose,
}: {
  entry: CalendarEntry;
  t: TFunction;
  locale: string;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const time = entryTime(entry);
  const subtitle = entrySubtitle(entry);

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" &&
        event.key !== "BrowserBack" &&
        event.key !== "GoBack" &&
        event.keyCode !== 10009 &&
        event.keyCode !== 461
      ) {
        return;
      }
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
        aria-labelledby="calendar-sheet-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <p className="page-kicker">
          {t(KIND_KEYS[entry.media_kind])} · {t(RELEASE_KEYS[entry.release_type])}
        </p>
        <h2 id="calendar-sheet-title">{entry.title}</h2>
        {subtitle ? <p className="calendar-sheet-subtitle">{subtitle}</p> : null}
        <dl className="calendar-sheet-facts">
          <div>
            <dt>{t("pages.calendar.sheetWhen")}</dt>
            <dd>
              {time ? (
                <time dateTime={entry.release_at ?? undefined}>
                  {new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "short" }).format(time)}
                </time>
              ) : (
                <>
                  <time dateTime={entry.date}>{formatDayHeading(entry.date, locale)}</time>
                  {" · "}
                  {t("pages.calendar.allDay")}
                </>
              )}
            </dd>
          </div>
          <div>
            <dt>{t("pages.calendar.sheetState")}</dt>
            <dd>
              <StateBadge entry={entry} t={t} />
            </dd>
          </div>
          {entry.average_lag_seconds != null ? (
            <div>
              <dt>{t("pages.calendar.sheetUsually")}</dt>
              <dd>
                {t("pages.workDetail.availabilityLag", {
                  duration: formatHumanDuration(entry.average_lag_seconds, locale),
                })}
              </dd>
            </div>
          ) : null}
          <div>
            <dt>{t("pages.calendar.sheetSources")}</dt>
            <dd>
              <ul className="calendar-sheet-sources">
                {entry.sources.map((source) => (
                  <li key={`${source.source_instance_id}:${source.arr_id}`}>
                    {source.source_name} <span className="muted">({source.source_kind})</span>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        </dl>
        {!entry.work_id ? <p className="hint">{t("pages.calendar.sheetNotInCatalogue")}</p> : null}
        <button ref={closeRef} type="button" className="btn btn-secondary" onClick={onClose}>
          {t("pages.calendar.sheetClose")}
        </button>
      </section>
    </div>
  );
}

/** Aggregated release calendar: agenda, week and month views over every connected *arr source. */
export function CalendarPage() {
  const { t, language } = useLanguage();
  const locale = LOCALE_TAGS[language] ?? "en-GB";
  const client = useApiClient();
  const navigate = useNavigate();
  const location = useLocation();
  useDocumentTitle(t("pages.calendar.title"));

  const firstDay = useMemo(() => weekStartsOn(locale), [locale]);
  const [view, setView] = useState<CalendarView>(() =>
    defaultCalendarView({
      isTv: IS_TV,
      matches: (query) =>
        typeof window !== "undefined" && typeof window.matchMedia === "function"
          ? window.matchMedia(query).matches
          : false,
    })
  );
  const [today] = useState<Day>(() => localDayOf(new Date()));
  const [anchor, setAnchor] = useState<Day>(() => anchorForView(view, today));
  const [kinds, setKinds] = useState<ReadonlySet<CalendarMediaKind>>(() => new Set());
  const [reloadNonce, setReloadNonce] = useState(0);
  const [selected, setSelected] = useState<{ entry: CalendarEntry; opener: HTMLElement } | null>(null);

  const range = visibleRange(view, anchor, firstDay);
  const fetchRange = fetchWindow(range);
  const state = useAsyncData<CalendarResponse>(
    () => client.getCalendar({ start: fetchRange.start, end: fetchRange.end }),
    [client, fetchRange.start, fetchRange.end, reloadNonce]
  );

  const data = state.status === "ready" ? state.data : null;
  const groups = useMemo(
    () => (data ? groupByLocalDay(filterByKinds(data.entries, kinds), range) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, kinds, range.start, range.end]
  );

  function changeView(next: CalendarView) {
    if (next === view) return;
    setView(next);
    setAnchor(anchorForView(next, anchor));
  }

  function toggleKind(kind: CalendarMediaKind) {
    setKinds((current) => {
      const next = new Set(current);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  function openEntry(entry: CalendarEntry, target: HTMLElement) {
    const route = workRouteForEntry(entry);
    if (route) {
      const origin = captureNavigationLayer(location.pathname, location.key, target);
      navigate(route, { state: { backTo: "/calendar", navigationOrigin: origin } });
      return;
    }
    setSelected({ entry, opener: target });
  }

  function closeSheet() {
    selected?.opener.focus({ preventScroll: true });
    setSelected(null);
  }

  const rangeLabel = formatRangeLabel(view, anchor, firstDay, locale);
  const visibleCount = groups.reduce((total, group) => total + group.entries.length, 0);
  const sources = data?.sources ?? [];

  let body;
  if (state.status === "error") {
    body = (
      <div className="calendar-state" role="alert">
        <h2 className="calendar-state-title error-text">{t("pages.calendar.loadError")}</h2>
        <p className="muted">{state.message}</p>
        <button type="button" className="btn btn-primary" onClick={() => setReloadNonce((n) => n + 1)}>
          {t("pages.calendar.retry")}
        </button>
      </div>
    );
  } else if (state.status !== "ready") {
    body = (
      <p className="calendar-state muted" role="status" aria-live="polite">
        {t("pages.calendar.loading")}
      </p>
    );
  } else if (visibleCount === 0) {
    body = (
      <div className="calendar-state">
        <h2 className="calendar-state-title">{t("pages.calendar.emptyTitle")}</h2>
        <p className="muted">
          {kinds.size > 0 ? t("pages.calendar.emptyFiltered") : t("pages.calendar.emptyDescription")}
        </p>
      </div>
    );
  } else if (view === "month") {
    body = (
      <MonthGrid
        anchor={anchor}
        firstDay={firstDay}
        groups={groups}
        today={today}
        t={t}
        locale={locale}
        onOpen={openEntry}
        onMore={(day) => {
          setView("agenda");
          setAnchor(day);
        }}
      />
    );
  } else if (view === "week") {
    body = (
      <DaySections
        days={buildWeekDays(anchor, firstDay, groups, today)}
        t={t}
        locale={locale}
        today={today}
        showEmpty
        onOpen={openEntry}
      />
    );
  } else {
    body = <DaySections days={groups} t={t} locale={locale} today={today} showEmpty={false} onOpen={openEntry} />;
  }

  return (
    <div className="calendar-page">
      <header className="calendar-header">
        <h1>{t("pages.calendar.title")}</h1>
        <div className="calendar-toolbar">
          <div className="calendar-nav" role="group" aria-label={t("pages.calendar.navigationLabel")}>
            <button
              type="button"
              className="btn btn-secondary calendar-icon-btn"
              aria-label={t("pages.calendar.previous")}
              onClick={() => setAnchor(shiftAnchor(view, anchor, -1))}
            >
              <span aria-hidden="true">←</span>
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              data-tv-focus-default
              onClick={() => setAnchor(anchorForView(view, localDayOf(new Date())))}
            >
              {t("pages.calendar.today")}
            </button>
            <button
              type="button"
              className="btn btn-secondary calendar-icon-btn"
              aria-label={t("pages.calendar.next")}
              onClick={() => setAnchor(shiftAnchor(view, anchor, 1))}
            >
              <span aria-hidden="true">→</span>
            </button>
          </div>
          <p className="calendar-range" aria-live="polite">
            {rangeLabel}
          </p>
          <div className="calendar-views" role="group" aria-label={t("pages.calendar.viewsLabel")}>
            {CALENDAR_VIEWS.map((option) => (
              <button
                key={option}
                type="button"
                className="btn calendar-view-btn"
                aria-pressed={view === option}
                onClick={() => changeView(option)}
              >
                {t(VIEW_KEYS[option])}
              </button>
            ))}
          </div>
        </div>
        <div className="calendar-filters" role="group" aria-label={t("pages.calendar.filterLabel")}>
          {CALENDAR_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              className="calendar-filter-chip"
              aria-pressed={kinds.has(kind)}
              onClick={() => toggleKind(kind)}
            >
              {t(KIND_KEYS[kind])}
            </button>
          ))}
        </div>
      </header>

      <div
        className="calendar-scroll"
        data-tv-scroll-container
        data-tv-scroll-axis="vertical"
        data-navigation-scroll-key="calendar:body"
      >
        <CalendarSourceBanner sources={sources} t={t} />
        {body}
        <CalendarSubscription localeTag={locale} />
      </div>

      {selected ? <EntrySheet entry={selected.entry} t={t} locale={locale} onClose={closeSheet} /> : null}
    </div>
  );
}
