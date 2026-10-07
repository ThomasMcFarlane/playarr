/**
 * The release calendar's agenda view, drawn at the web TV layout's measurements (`clients/tv-web/web/src/pages/Calendar.tsx`):
 * the period navigation in the header, the period label, the banner for sources that could not be read, the selected
 * release's details on the left and the day-by-day list on the right.
 *
 * Not on this platform yet: the week and month views, the filter drawer and the calendar link (their tiles are drawn in the
 * action column; see the board row).
 */
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Animated, Easing, Pressable, View} from 'react-native';
import {useNavigation, type NavigationProp, type ParamListBase} from '@amazon-devices/react-navigation__native';
import type {CalendarEntry, CalendarSourceStatus} from '@playarr-tv/api-client';
import {useAsyncData} from '@playarr-tv/api-client/react';
import {useApiClient} from '../api/ApiClientProvider';
import {ArtworkImage} from '../components/ArtworkImage';
import {useLanguage} from '../i18n/LanguageProvider';
import {useTvBackNavigation} from '../navigation/backPolicy';
import {ROUTES} from '../navigation/routes';
import {
  type CalendarItem,
  type Day,
  addDays,
  entryState,
  episodeCode,
  failedSources,
  fetchWindow,
  formatEpisodeCodes,
  groupByLocalDay,
  groupSeriesEpisodes,
  itemAvailability,
  localDayOf,
  parseDay,
  shiftAnchor,
  visibleRange,
  weekStartsOn,
  workRouteForEntry,
} from '../lib/calendar';
import {snapshotFromWork, useWatchlistToggle} from '../lib/watchlist';
import {mix} from '../theme/color';
import {useTheme} from '../theme/ThemeProvider';
import {ActionTile} from '../tv/ActionTile';
import {EdgeFade} from '../tv/EdgeFade';
import {EmptyState} from '../tv/EmptyState';
import {FocusRing} from '../tv/FocusRing';
import {BackButton} from '../tv/PageHeader';
import {Box, T, u} from '../tv/kit';
import {Stage} from '../tv/Stage';

const ENTRY_H = 78;
const ENTRY_GAP = 13.6;
const LIST_X = 786.4;
const LIST_W = 1048.8;
const LIST_CLIP_Y = 340;

const GREEN = '#3f9d77';
const BLUE = '#5b7fd1';

function entryTime(entry: CalendarEntry): Date | null {
  if (!entry.release_at) return null;
  const date = new Date(entry.release_at);
  return Number.isNaN(date.getTime()) ? null : date;
}

function itemEntry(item: CalendarItem): CalendarEntry {
  return item.kind === 'single' ? item.entry : item.entries[0]!;
}

function itemTitle(item: CalendarItem): string {
  return item.kind === 'single' ? item.entry.title : item.title;
}

function groupState(entries: CalendarEntry[]): 'inLibrary' | 'monitored' | 'notMonitored' {
  if (entries.every((entry) => entry.has_file)) return 'inLibrary';
  return entries.some((entry) => entry.monitored) ? 'monitored' : 'notMonitored';
}

export function CalendarScreen(): React.ReactElement {
  const client = useApiClient();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const {t, language} = useLanguage();
  const {colour, scheme} = useTheme();
  useTvBackNavigation(ROUTES.home);
  const locale = language === 'en' ? 'en-GB' : language;
  const firstDay = weekStartsOn(locale);
  const today = useMemo(() => localDayOf(new Date()), []);
  const [anchor, setAnchor] = useState<Day>(today);
  const range = useMemo(() => visibleRange('agenda', anchor, firstDay), [anchor, firstDay]);
  const window = useMemo(() => fetchWindow(range), [range]);
  const state = useAsyncData(() => client.getCalendar({start: window.start, end: window.end}), [client, window.start, window.end]);

  const groups = useMemo(() => (state.status === 'ready' ? groupByLocalDay(state.data.entries, range) : []), [state, range]);
  const items = useMemo(() => groups.flatMap((group) => groupSeriesEpisodes(group.entries).map((item) => ({day: group.day, item}))), [groups]);
  const failed: CalendarSourceStatus[] = state.status === 'ready' ? failedSources(state.data.sources) : [];

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [cardFocused, setCardFocused] = useState(false);
  const selected = items.find((entry) => entry.item.key === selectedKey)?.item ?? items[0]?.item ?? null;

  // Layout of the agenda: day headings and 78 px entries, in the web's order.
  const rows = useMemo(() => {
    let y = 0;
    const out: Array<{key: string; day: Day; heading: boolean; item?: CalendarItem; y: number}> = [];
    let previousDay: Day | null = null;
    for (const entry of items) {
      if (entry.day !== previousDay) {
        if (previousDay !== null) y += 32 - ENTRY_GAP;
        out.push({key: `h-${entry.day}`, day: entry.day, heading: true, y});
        y += 27.6 + 6.4;
        previousDay = entry.day;
      }
      out.push({key: entry.item.key, day: entry.day, heading: false, item: entry.item, y});
      y += ENTRY_H + ENTRY_GAP;
    }
    return out;
  }, [items]);

  const bannerHeight = failed.length > 0 ? 90 : 0;
  const contentTop = failed.length > 0 ? 358 : 258;
  const listTop = contentTop;
  const scrollY = useRef(new Animated.Value(0)).current;
  const [scrolled, setScrolled] = useState(0);
  const selectedRow = rows.find((row) => row.key === selected?.key);
  useEffect(() => {
    // Keep the selected entry inside the viewport (the list's top edge is the page's content top).
    const viewport = 1030 - listTop;
    if (!selectedRow) return;
    let target = scrolled;
    if (selectedRow.y + ENTRY_H + 40 > target + viewport) target = selectedRow.y + ENTRY_H + 40 - viewport;
    if (selectedRow.y - 40 < target) target = Math.max(0, selectedRow.y - 40);
    if (target !== scrolled) {
      setScrolled(target);
      Animated.timing(scrollY, {toValue: -u(target), duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: false}).start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRow?.y]);
  const listHeight = rows.length > 0 ? rows[rows.length - 1]!.y + ENTRY_H : 0;

  const rangeLabel = useMemo(() => {
    const short = new Intl.DateTimeFormat(locale, {day: 'numeric', month: 'short', timeZone: 'UTC'});
    const withYear = new Intl.DateTimeFormat(locale, {day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'});
    return `${short.format(parseDay(range.start))} – ${withYear.format(parseDay(range.end))}`;
  }, [locale, range]);

  const dayHeading = (day: Day): string => new Intl.DateTimeFormat(locale, {weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC'}).format(parseDay(day));
  const dark = scheme === 'dark';

  return (
    <Stage>
      <BackButton onPress={() => navigation.navigate(ROUTES.home)} />
      <Box x={226.6} y={56.2} w={600}>
        <T size={33.6} weight={580} ls={-1.512} lh={50.4} color={colour.ink} lines={1}>
          {t('pages.calendar.title')}
        </T>
      </Box>

      {/* Period navigation (stays in the header row). */}
      <RoundNav x={1634.4} glyph={'←'} label={t('pages.calendar.previous')} onPress={() => setAnchor(shiftAnchor('agenda', anchor, -1))} />
      <TodayPill label={t('pages.calendar.today')} onPress={() => setAnchor(today)} />
      <RoundNav x={1783.6} glyph={'→'} label={t('pages.calendar.next')} onPress={() => setAnchor(shiftAnchor('agenda', anchor, 1))} />

      {/* The action column. */}
      <ActionTile icon="bell" label="Calendar link" slot={0} />
      <ActionTile icon="filters" label="Filters" slot={1} />

      <Box x={153.6} y={162} w={272} h={62} r={999}>
        <View style={{flexDirection: 'row', alignItems: 'center', height: u(62), paddingLeft: u(21)}}>
          <T size={24} weight={640} lh={36} color={colour.ink}>
            {rangeLabel}
          </T>
          <View style={{marginLeft: u(10)}}>
            <T size={14.72} weight={720} color={colour.ink}>
              {'▾'}
            </T>
          </View>
        </View>
      </Box>

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
            borderColor: mix('#ee9297', dark ? 0.55 : 0.8),
            backgroundColor: dark ? '#392326' : '#f6dde0',
            paddingHorizontal: u(17),
            paddingTop: u(14),
          }}
        >
          <T size={19.2} weight={700} lh={26} color="#ee9297">
            {t('pages.calendar.sourcesBannerTitle', {count: failed.length})}
          </T>
          {failed.map((source) => (
            <View key={source.source_instance_id} style={{marginTop: u(8), flexDirection: 'row'}}>
              <T size={19.2} weight={400} lh={28.8} color="#ee9297">
                {'•  '}
                {t('pages.calendar.sourceLine', {name: source.name, reason: source.error ? `${t(`pages.calendar.source${source.status === 'unreachable' ? 'Unreachable' : source.status === 'rejected' ? 'Rejected' : 'Error'}` as const)} (${source.error})` : t(`pages.calendar.source${source.status === 'unreachable' ? 'Unreachable' : source.status === 'rejected' ? 'Rejected' : 'Error'}` as const)})}
              </T>
            </View>
          ))}
        </View>
      ) : null}

      {state.status === 'loading' || state.status === 'idle' ? (
        <Box x={LIST_X} y={contentTop} w={600}>
          <T size={14} weight={400} color={colour.inkMuted}>
            {t('pages.calendar.loading')}
          </T>
        </Box>
      ) : state.status === 'error' ? (
        <EmptyState x={LIST_X - 100} width={1200} y={contentTop} title={t('pages.calendar.loadError')} description={state.message} tone="error" />
      ) : items.length === 0 ? (
        <EmptyState x={LIST_X - 100} width={1200} y={contentTop} title={t('pages.calendar.emptyTitle')} description={t('pages.calendar.emptyDescription')} />
      ) : null}

      {selected ? <Details item={selected} top={contentTop} locale={locale} onOpen={(route) => openRoute(navigation, route)} /> : null}

      <Box x={LIST_X - 8} y={listTop - 10} w={LIST_W + 16} h={1080 - listTop - 40} style={{overflow: 'hidden'}} pointerEvents="box-none">
        <Animated.View style={{position: 'absolute', left: u(8), top: Animated.add(new Animated.Value(u(10)), scrollY), width: u(LIST_W)}} pointerEvents="box-none">
          {rows.map((row) =>
            row.heading ? (
              <View key={row.key} style={{position: 'absolute', left: 0, top: u(row.y)}}>
                <T size={18.4} weight={640} lh={27.6} color={colour.ink}>
                  {dayHeading(row.day)}
                </T>
              </View>
            ) : (
              <EntryRow
                key={row.key}
                item={row.item!}
                y={row.y}
                locale={locale}
                selected={cardFocused && selected?.key === row.key}
                onFocus={() => {
                  setSelectedKey(row.key);
                  setCardFocused(true);
                }}
                onPress={() => {
                  const route = workRouteForEntry(itemEntry(row.item!));
                  if (route) openRoute(navigation, route);
                }}
              />
            ),
          )}
          <View style={{height: u(listHeight + 60)}} pointerEvents="none" />
        </Animated.View>
      </Box>
      <EdgeFade side="top" active={scrolled > 0} x={LIST_X - 8} y={listTop - 10} w={LIST_W + 16} h={1080 - listTop - 40} />
      <EdgeFade side="bottom" active={listHeight + 34 - scrolled > 1030 - listTop} x={LIST_X - 8} y={listTop - 10} w={LIST_W + 16} h={1080 - listTop - 40} />
    </Stage>
  );
}

function openRoute(navigation: NavigationProp<ParamListBase>, route: string): void {
  const match = /^\/(series|movies|music|library)\/(.+)$/.exec(route);
  if (!match) return;
  navigation.navigate(match[1] === 'music' ? ROUTES.musicDetail : ROUTES.workDetail, {workId: match[2], backTo: ROUTES.calendar});
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
      <T size={14.72} weight={720} color={focused ? colour.bg : colour.inkSoft}>
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

function Badge({state, label, size}: {state: 'inLibrary' | 'monitored' | 'notMonitored'; label: string; size: number}): React.ReactElement {
  const {colour} = useTheme();
  const tint = state === 'inLibrary' ? GREEN : state === 'monitored' ? BLUE : colour.inkMuted;
  return (
    <View style={{borderRadius: 999, backgroundColor: mix(tint, 0.24), paddingHorizontal: u(size * 0.55), height: u(size * 1.5), justifyContent: 'center'}}>
      <T size={size} weight={640} color={colour.ink}>
        {label}
      </T>
    </View>
  );
}

function EntryRow({item, y, locale, selected, onFocus, onPress}: {item: CalendarItem; y: number; locale: string; selected: boolean; onFocus: () => void; onPress: () => void}): React.ReactElement {
  const {colour} = useTheme();
  const {t} = useLanguage();
  const first = itemEntry(item);
  const time = entryTime(first);
  const entries = item.kind === 'series' ? item.entries : [item.entry];
  const state = item.kind === 'series' ? groupState(item.entries) : entryState(first);
  const subtitle = item.kind === 'series' ? t('pages.calendar.groupSummary', {count: item.entries.length, codes: item.codes}) : [episodeCode(first), first.subtitle].filter(Boolean).join(' · ');
  const available = itemAvailability(item) === 'available';
  const releaseKey = {air: 'pages.calendar.releaseAir', cinema: 'pages.calendar.releaseCinema', digital: 'pages.calendar.releaseDigital', physical: 'pages.calendar.releasePhysical', release: 'pages.calendar.releaseGeneric'} as const;
  const kindKey = {episode: 'pages.calendar.kindEpisode', movie: 'pages.calendar.kindMovie', album: 'pages.calendar.kindAlbum', book: 'pages.calendar.kindBook'} as const;
  const stateKey = {inLibrary: 'pages.calendar.stateInLibrary', monitored: 'pages.calendar.stateMonitored', notMonitored: 'pages.calendar.stateNotMonitored'} as const;
  void entries;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={itemTitle(item)}
      onFocus={onFocus}
      onPress={onPress}
      style={{position: 'absolute', left: 0, top: u(y), width: u(LIST_W), height: u(ENTRY_H), borderRadius: u(12), backgroundColor: colour.surface, borderWidth: 1, borderColor: colour.line, overflow: 'hidden', flexDirection: 'row', alignItems: 'center'}}
    >
      <View style={{position: 'absolute', left: 0, top: 0, bottom: 0, width: u(3.4), backgroundColor: available ? GREEN : '#cf3157'}} />
      <View style={{marginLeft: u(16), width: u(40), height: u(60), borderRadius: u(6), overflow: 'hidden', backgroundColor: colour.surfaceSoft}}>
        {first.poster_url ? <ArtworkImage uri={first.poster_url} accessToken={undefined} style={{width: "100%", height: "100%"}} resizeMode="cover" /> : null}
      </View>
      <View style={{marginLeft: u(14.4), flex: 1}}>
        <T size={19.2} weight={640} lh={28.8} color={colour.ink} lines={1}>
          {itemTitle(item)}
        </T>
        {subtitle ? (
          <T size={12.8} weight={400} lh={19.2} color={colour.inkMuted} lines={1}>
            {subtitle}
          </T>
        ) : null}
        <View style={{flexDirection: 'row', alignItems: 'center', marginTop: u(subtitle ? 0 : 2)}}>
          <View style={{marginRight: u(12)}}>
            <T size={12.8} weight={400} lh={19.2} color={colour.inkMuted}>
              {time ? new Intl.DateTimeFormat(locale, {timeStyle: 'short'}).format(time) : t('pages.calendar.allDay')}
            </T>
          </View>
          <View style={{marginRight: u(12)}}>
            <T size={12.8} weight={400} lh={19.2} color={colour.inkMuted}>
              {t(releaseKey[first.release_type])}
            </T>
          </View>
          {item.kind === 'series' ? null : (
            <View style={{marginRight: u(12)}}>
              <T size={12.8} weight={400} lh={19.2} color={colour.inkMuted}>
                {t(kindKey[first.media_kind])}
              </T>
            </View>
          )}
          <Badge state={state} label={t(stateKey[state])} size={12.8} />
        </View>
      </View>
      {selected ? <FocusRing radius={12} offset={0} /> : null}
    </Pressable>
  );
}

function Details({item, top, locale, onOpen}: {item: CalendarItem; top: number; locale: string; onOpen: (route: string) => void}): React.ReactElement {
  const {colour} = useTheme();
  const {t} = useLanguage();
  const client = useApiClient();
  const first = itemEntry(item);
  const entries = item.kind === 'series' ? item.entries : [item.entry];
  const route = workRouteForEntry(first);
  const time = entryTime(first);
  const state = item.kind === 'series' ? groupState(item.entries) : entryState(first);
  const sources = [...new Map(entries.flatMap((entry) => entry.sources).map((source) => [source.source_instance_id, source])).values()];
  const subtitle = item.kind === 'series' ? t('pages.calendar.groupSummary', {count: item.entries.length, codes: formatEpisodeCodes(item.entries)}) : [episodeCode(first), first.subtitle].filter(Boolean).join(' · ');
  const releaseKey = {air: 'pages.calendar.releaseAir', cinema: 'pages.calendar.releaseCinema', digital: 'pages.calendar.releaseDigital', physical: 'pages.calendar.releasePhysical', release: 'pages.calendar.releaseGeneric'} as const;
  const kindKey = {episode: 'pages.calendar.kindEpisode', movie: 'pages.calendar.kindMovie', album: 'pages.calendar.kindAlbum', book: 'pages.calendar.kindBook'} as const;
  const stateKey = {inLibrary: 'pages.calendar.stateInLibrary', monitored: 'pages.calendar.stateMonitored', notMonitored: 'pages.calendar.stateNotMonitored'} as const;
  const when = time
    ? new Intl.DateTimeFormat(locale, {dateStyle: 'full', timeStyle: 'short'}).format(time)
    : `${new Intl.DateTimeFormat(locale, {weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC'}).format(parseDay(first.date))} · ${t('pages.calendar.allDay')}`;
  const watchlist = useWatchlistToggle(client, route ? null : {kind: first.media_kind === 'episode' ? 'series' : 'movie', title: first.title, year: null, work_id: null, external_refs: [], poster_url: first.poster_url ?? null} as never);
  void snapshotFromWork;

  const Label = ({children}: {children: string}): React.ReactElement => (
    <T size={11.52} weight={400} ls={1.152} lh={17.3} color={colour.inkMuted} upper>
      {children}
    </T>
  );
  return (
    <Box x={153.6} y={top} w={571.2}>
      <T size={11.84} weight={760} ls={2.13} lh={17.8} color={colour.inkMuted} upper>
        {`${t(kindKey[first.media_kind])} · ${t(releaseKey[first.release_type])}`}
      </T>
      <View style={{marginTop: u(14)}}>
        <T size={38.4} weight={590} ls={-1.536} lh={57.6} color={colour.ink}>
          {itemTitle(item)}
        </T>
      </View>
      {subtitle ? (
        <T size={19.2} weight={400} lh={28.8} color={colour.inkSoft}>
          {subtitle}
        </T>
      ) : null}
      <View style={{marginTop: u(12)}}>
        <Label>{t('pages.calendar.sheetWhen')}</Label>
        <T size={19.2} weight={400} lh={28.8} color={colour.ink}>
          {when}
        </T>
      </View>
      <View style={{marginTop: u(10.4)}}>
        <Label>{t('pages.calendar.sheetState')}</Label>
        <View style={{alignSelf: 'flex-start', marginTop: u(1)}}>
          <Badge state={state} label={t(stateKey[state])} size={19.2} />
        </View>
      </View>
      <View style={{marginTop: u(10.4)}}>
        <Label>{t('pages.calendar.sheetSources')}</Label>
        {sources.map((source) => (
          <View key={source.source_instance_id} style={{flexDirection: 'row'}}>
            <T size={19.2} weight={400} lh={28.8} color={colour.ink}>
              {`${source.source_name} `}
            </T>
            <T size={19.2} weight={400} lh={28.8} color={colour.inkMuted}>
              {`(${source.source_kind})`}
            </T>
          </View>
        ))}
      </View>
      <View style={{marginTop: u(14), flexDirection: 'row'}}>
        {route ? <ActionPill primary label={first.media_kind === 'episode' ? t('pages.calendar.openSeries') : t('pages.calendar.open')} onPress={() => onOpen(route)} /> : null}
        {!route ? (
          <ActionPill
            icon="+"
            label={watchlist.listed ? t('discovery.watchlist.remove') : t('discovery.watchlist.add')}
            disabled={watchlist.listed === null}
            onPress={watchlist.toggle}
          />
        ) : null}
      </View>
    </Box>
  );
}

function ActionPill({label, onPress, primary, icon, disabled}: {label: string; onPress: () => void; primary?: boolean; icon?: string; disabled?: boolean}): React.ReactElement {
  const {colour} = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={{height: u(58), marginRight: u(10), paddingHorizontal: u(22), borderRadius: 999, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: primary ? colour.ink : colour.surface, borderWidth: primary ? 0 : 1, borderColor: colour.line, opacity: disabled ? 0.5 : 1}}
    >
      {icon ? (
        <View style={{marginRight: u(10)}}>
          <T size={14.72} weight={720} color={colour.inkSoft}>
            {icon}
          </T>
        </View>
      ) : null}
      <T size={14.72} weight={720} color={primary ? colour.bg : colour.inkSoft}>
        {label}
      </T>
      {focused ? <FocusRing /> : null}
    </Pressable>
  );
}
