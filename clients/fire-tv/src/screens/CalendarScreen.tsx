/**
 * The release calendar at the web TV layout's measurements (`clients/tv-web/web/src/pages/Calendar.tsx`): the period
 * navigation in the header, the period label, the banner for sources that could not be read, and one of the three views
 * (agenda, week, month). The Filters and Calendar link tiles sit in the shell's action column and open the two drawers.
 *
 * Owner rules: week view moves LEFT and RIGHT between days and UP and DOWN between entries; the agenda's details follow
 * focus; the entry's left border shows availability; every scrolling area fades at the edges where content continues.
 */
import React, {useCallback, useMemo, useState} from 'react';
import {Pressable, View} from 'react-native';
import {useNavigation, type NavigationProp, type ParamListBase} from '@amazon-devices/react-navigation__native';
import type {CalendarSourceStatus} from '@playarr-tv/api-client';
import {useAsyncData} from '@playarr-tv/api-client/react';
import {useApiClient} from '../api/ApiClientProvider';
import {useLanguage} from '../i18n/LanguageProvider';
import {
  type CalendarItem,
  type CalendarView,
  type Day,
  anchorForView,
  failedSources,
  fetchWindow,
  groupByLocalDay,
  localDayOf,
  parseDay,
  shiftAnchor,
  visibleRange,
  weekStartsOn,
} from '../lib/calendar';
import {type CalendarFilters, EMPTY_CALENDAR_FILTERS, activeFilterCount, applyCalendarFilters} from '../lib/calendarFilters';
import {useBackLayer, useTvBackNavigation} from '../navigation/backPolicy';
import {ROUTES} from '../navigation/routes';
import {mix} from '../theme/color';
import {useTheme} from '../theme/ThemeProvider';
import {ActionTile} from '../tv/ActionTile';
import {EmptyState} from '../tv/EmptyState';
import {FocusRing} from '../tv/FocusRing';
import {BackButton} from '../tv/PageHeader';
import {Box, T, u} from '../tv/kit';
import {Stage} from '../tv/Stage';
import {DetailSheet, FiltersPanel, LinkPanel, PeriodPicker} from './calendar/CalendarPanels';
import {AgendaView, MonthView, WeekView, type ViewShared} from './calendar/CalendarViews';

export function CalendarScreen(): React.ReactElement {
  const client = useApiClient();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const {t, language} = useLanguage();
  const {colour, scheme} = useTheme();
  const locale = language === 'en' ? 'en-GB' : language;
  const firstDay = weekStartsOn(locale);
  const today = useMemo(() => localDayOf(new Date()), []);
  const [view, setView] = useState<CalendarView>('agenda');
  const [anchor, setAnchor] = useState<Day>(today);
  const [panel, setPanelState] = useState<'filters' | 'link' | null>(null);
  // The action column stays out of the D-pad's reach once a drawer holds focus.
  const [drawerFocused, setDrawerFocused] = useState(false);
  const setPanel = (next: 'filters' | 'link' | null): void => {
    setPanelState(next);
    if (next === null) setDrawerFocused(false);
  };
  const [filters, setFilters] = useState<CalendarFilters>(EMPTY_CALENDAR_FILTERS);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [sheetItem, setSheetItem] = useState<CalendarItem | null>(null);
  useTvBackNavigation(ROUTES.home);

  const range = useMemo(() => visibleRange(view, anchor, firstDay), [view, anchor, firstDay]);
  const window = useMemo(() => fetchWindow(range), [range]);
  const state = useAsyncData(() => client.getCalendar({start: window.start, end: window.end}), [client, window.start, window.end]);
  const groups = useMemo(() => (state.status === 'ready' ? groupByLocalDay(applyCalendarFilters(state.data.entries, filters, today), range) : []), [state, filters, today, range]);
  const visibleCount = groups.reduce((total, group) => total + group.entries.length, 0);
  const sources: readonly CalendarSourceStatus[] = state.status === 'ready' ? state.data.sources : [];
  const failed = state.status === 'ready' ? failedSources(state.data.sources) : [];
  const dark = scheme === 'dark';
  const bannerHeight = failed.length > 0 ? 90 : 0;
  const contentTop = failed.length > 0 ? 340 : 240;

  const rangeLabel = useMemo(() => {
    const utc = (options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat => new Intl.DateTimeFormat(locale, {...options, timeZone: 'UTC'});
    if (view === 'month') return utc({month: 'long', year: 'numeric'}).format(parseDay(anchor));
    const short = utc({day: 'numeric', month: 'short'});
    const withYear = utc({day: 'numeric', month: 'short', year: 'numeric'});
    return `${short.format(parseDay(range.start))} – ${withYear.format(parseDay(range.end))}`;
  }, [locale, view, anchor, range]);

  const openRoute = useCallback(
    (route: string): void => {
      const match = /^\/(series|movies|music|library)\/(.+)$/.exec(route);
      if (!match) return;
      navigation.navigate(match[1] === 'music' ? ROUTES.musicDetail : ROUTES.workDetail, {workId: match[2], backTo: ROUTES.calendar});
    },
    [navigation],
  );
  const changeView = (next: CalendarView): void => {
    if (next === view) return;
    setView(next);
    setAnchor(anchorForView(next, anchor));
    setSelectedKey(null);
  };
  useBackLayer(sheetItem !== null && panel === null, () => setSheetItem(null));

  const onSelect = useCallback(
    (item: CalendarItem): void => {
      if (view === 'agenda') setSelectedKey(item.key);
      else setSheetItem(item);
    },
    [view],
  );
  const shared: ViewShared = useMemo(
    () => ({today, locale, contentTop, selectedKey, onSelect, onOpenRoute: openRoute}),
    [today, locale, contentTop, selectedKey, onSelect, openRoute],
  );
  const onMore = useCallback((day: Day): void => {
    setView('agenda');
    setAnchor(day);
  }, []);
  const ready = state.status === 'ready' && visibleCount > 0;
  const toggleLink = (): void => setPanel(panel === 'link' ? null : 'link');
  const toggleFilters = (): void => setPanel(panel === 'filters' ? null : 'filters');

  return (
    <Stage>
      <BackButton onPress={() => navigation.navigate(ROUTES.home)} />
      <Box x={226.6} y={56.2} w={600}>
        <T size={33.6} weight={580} ls={-1.512} lh={50.4} dy={1} color={colour.ink} lines={1}>
          {t('pages.calendar.title')}
        </T>
      </Box>

      <RoundNav x={1634.4} glyph={'←'} label={t('pages.calendar.previous')} onPress={() => setAnchor(shiftAnchor(view, anchor, -1))} />
      <TodayPill label={t('pages.calendar.today')} onPress={() => setAnchor(anchorForView(view, today))} />
      <RoundNav x={1783.6} glyph={'→'} label={t('pages.calendar.next')} onPress={() => setAnchor(shiftAnchor(view, anchor, 1))} />

      <PeriodPicker label={rangeLabel} anchor={anchor} locale={locale} onChange={setAnchor} />

      {failed.length > 0 ? (
        <View
          style={{
            position: 'absolute',
            left: u(153.6),
            top: u(236),
            width: u(1689.6),
            height: u(bannerHeight),
            borderRadius: u(12),
            borderWidth: 1,
            borderColor: mix(colour.danger, dark ? 0.55 : 0.8),
            backgroundColor: colour.dangerSoft,
            paddingHorizontal: u(17),
            paddingTop: u(14),
          }}
        >
          <T size={19.2} weight={700} lh={26} color={colour.danger}>
            {t('pages.calendar.sourcesBannerTitle', {count: failed.length})}
          </T>
          {failed.map((source) => (
            <View key={source.source_instance_id} style={{marginTop: u(8), flexDirection: 'row'}}>
              <T size={19.2} weight={400} lh={28.8} color={colour.danger}>
                {'•  '}
                {t('pages.calendar.sourceLine', {name: source.name, reason: source.error ? `${sourceStatus(t, source)} (${source.error})` : sourceStatus(t, source)})}
              </T>
            </View>
          ))}
        </View>
      ) : null}

      {state.status === 'loading' || state.status === 'idle' ? (
        <Box x={view === 'agenda' ? 786.4 : 153.6} y={contentTop} w={600}>
          <T size={14} weight={400} color={colour.inkMuted}>
            {t('pages.calendar.loading')}
          </T>
        </Box>
      ) : state.status === 'error' ? (
        <EmptyState x={686} width={1200} y={contentTop} title={t('pages.calendar.loadError')} description={state.message} tone="error" />
      ) : visibleCount === 0 && view !== 'month' ? (
        <EmptyState x={686} width={1200} y={contentTop} title={t('pages.calendar.emptyTitle')} description={activeFilterCount(filters) > 0 ? t('pages.calendar.emptyFiltered') : t('pages.calendar.emptyDescription')} />
      ) : null}

      {ready && view === 'agenda' ? <AgendaView groups={groups} {...shared} /> : null}
      {ready && view === 'week' ? <WeekView groups={groups} anchor={anchor} firstDay={firstDay} shared={shared} /> : null}
      {state.status === 'ready' && view === 'month' ? (
        <MonthView
          groups={groups}
          anchor={anchor}
          firstDay={firstDay}
          shared={shared}
          onMore={onMore}
        />
      ) : null}

      {/* The drawers cover the action column (the web blurs it away behind them). */}
      <ActionTile icon="bell" label={t('pages.calendar.subscription.title')} slot={0} active={panel === 'link'} focusable={!drawerFocused} onPress={toggleLink} />
      <ActionTile icon="filters" label={t('pages.library.filters')} slot={1} active={panel === 'filters'} focusable={!drawerFocused} onPress={toggleFilters} />

      {sheetItem && panel === null ? (
        <DetailSheet
          item={sheetItem}
          locale={locale}
          onClose={() => setSheetItem(null)}
          onOpen={(route) => {
            setSheetItem(null);
            openRoute(route);
          }}
        />
      ) : null}
      {panel === 'filters' ? <FiltersPanel view={view} onView={changeView} filters={filters} onFilters={setFilters} sources={sources} onClose={() => setPanel(null)} onFocused={() => setDrawerFocused(true)} /> : null}
      {panel === 'link' ? <LinkPanel onClose={() => setPanel(null)} onFocused={() => setDrawerFocused(true)} /> : null}

    </Stage>
  );
}

function sourceStatus(t: ReturnType<typeof useLanguage>['t'], source: CalendarSourceStatus): string {
  const key = source.status === 'unreachable' ? 'pages.calendar.sourceUnreachable' : source.status === 'rejected' ? 'pages.calendar.sourceRejected' : 'pages.calendar.sourceError';
  return t(key);
}

function RoundNav({x, glyph, label, onPress}: {x: number; glyph: string; label: string; onPress: () => void}): React.ReactElement {
  const {colour} = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={{position: 'absolute', left: u(x), top: u(56.3), width: u(50), height: u(50), borderRadius: 999, backgroundColor: focused ? colour.ink : colour.surface, borderWidth: 1, borderColor: colour.line, alignItems: 'center', justifyContent: 'center'}}
    >
      <T size={14.72} weight={720} dy={3} color={focused ? colour.bg : colour.inkSoft}>
        {glyph}
      </T>
      {focused ? <FocusRing /> : null}
    </Pressable>
  );
}

function TodayPill({label, onPress}: {label: string; onPress: () => void}): React.ReactElement {
  const {colour} = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hasTVPreferredFocus
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={{position: 'absolute', left: u(1690.2), top: u(55), width: u(87.7), height: u(52.8), borderRadius: 999, backgroundColor: colour.surface, borderWidth: 1, borderColor: colour.line, alignItems: 'center', justifyContent: 'center'}}
    >
      <T size={14.72} weight={720} color={colour.inkSoft}>
        {label}
      </T>
      {focused ? <FocusRing /> : null}
    </Pressable>
  );
}
