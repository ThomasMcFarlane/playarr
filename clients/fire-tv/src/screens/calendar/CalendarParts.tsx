/**
 * The release calendar's shared pieces, drawn at the web TV layout's measurements
 * (`clients/tv-web/web/src/pages/Calendar.tsx` and `Calendar.css`): the entry card, the state badge, the details of one
 * release and the small helpers the three views share.
 */
import React, {useState} from 'react';
import {Pressable, View, type LayoutChangeEvent} from 'react-native';
import type {CalendarEntry} from '@playarr-tv/api-client';
import {useApiClient} from '../../api/ApiClientProvider';
import {ArtworkImage} from '../../components/ArtworkImage';
import {useLanguage} from '../../i18n/LanguageProvider';
import {
  type CalendarItem,
  entryState,
  episodeCode,
  formatEpisodeCodes,
  itemAvailability,
  parseDay,
  workRouteForEntry,
} from '../../lib/calendar';
import {useWatchlistToggle} from '../../lib/watchlist';
import {mix} from '../../theme/color';
import {useTheme} from '../../theme/ThemeProvider';
import {Button} from '../../tv/forms';
import {Box, T, u} from '../../tv/kit';

export type EntryStateName = 'inLibrary' | 'monitored' | 'notMonitored';

const GREEN = '#3f9d77';
const BLUE = '#5b7fd1';

const RELEASE_KEYS = {
  air: 'pages.calendar.releaseAir',
  cinema: 'pages.calendar.releaseCinema',
  digital: 'pages.calendar.releaseDigital',
  physical: 'pages.calendar.releasePhysical',
  release: 'pages.calendar.releaseGeneric',
} as const;
const KIND_KEYS = {
  episode: 'pages.calendar.kindEpisode',
  movie: 'pages.calendar.kindMovie',
  album: 'pages.calendar.kindAlbum',
  book: 'pages.calendar.kindBook',
} as const;
const STATE_KEYS = {
  inLibrary: 'pages.calendar.stateInLibrary',
  monitored: 'pages.calendar.stateMonitored',
  notMonitored: 'pages.calendar.stateNotMonitored',
} as const;

export function entryTime(entry: CalendarEntry): Date | null {
  if (!entry.release_at) return null;
  const date = new Date(entry.release_at);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function itemEntry(item: CalendarItem): CalendarEntry {
  return item.kind === 'single' ? item.entry : item.entries[0]!;
}

export function itemTitle(item: CalendarItem): string {
  return item.kind === 'single' ? item.entry.title : item.title;
}

export function groupState(entries: CalendarEntry[]): EntryStateName {
  if (entries.every((entry) => entry.has_file)) return 'inLibrary';
  return entries.some((entry) => entry.monitored) ? 'monitored' : 'notMonitored';
}

export function itemState(item: CalendarItem): EntryStateName {
  return item.kind === 'series' ? groupState(item.entries) : entryState(itemEntry(item));
}

export function itemSubtitle(item: CalendarItem, t: (key: never, params?: Record<string, string | number>) => string): string | null {
  const first = itemEntry(item);
  if (item.kind === 'series') return (t as (key: string, params?: Record<string, string | number>) => string)('pages.calendar.groupSummary', {count: item.entries.length, codes: item.codes});
  return [episodeCode(first), first.subtitle].filter(Boolean).join(' · ') || null;
}

/** The left border: green when the title is in the library and playable, muted otherwise. */
export function useAvailabilityColour(item: CalendarItem): string {
  const {colour} = useTheme();
  return itemAvailability(item) === 'available' ? colour.success : colour.inkMuted;
}

export function Badge({state, label, size}: {state: EntryStateName; label: string; size: number}): React.ReactElement {
  const {colour} = useTheme();
  const tint = state === 'inLibrary' ? GREEN : state === 'monitored' ? BLUE : colour.surfaceSoft;
  return (
    <View style={{borderRadius: 999, backgroundColor: state === 'notMonitored' ? colour.surfaceSoft : mix(tint, 0.24), paddingHorizontal: u(size * 0.5), height: u(size * 1.5), justifyContent: 'center', alignSelf: 'flex-start'}}>
      <T size={size} weight={640} lh={size * 1.5} color={state === 'notMonitored' ? colour.inkSoft : colour.ink}>
        {label}
      </T>
    </View>
  );
}

export interface EntryCardProps {
  item: CalendarItem;
  width: number;
  /** Week columns let long titles and subtitles wrap; the agenda cuts them with an ellipsis. */
  wrap?: boolean;
  /** The card previewed in the agenda's details pane. */
  selected?: boolean;
  onFocus?: () => void;
  onPress: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
  hasTVPreferredFocus?: boolean;
}

/** `.calendar-entry`: a 12 px card with a 4 px availability border on the left, a 40 x 60 poster and up to three lines. */
export function EntryCard({item, width, wrap, selected, onFocus, onPress, onLayout, hasTVPreferredFocus}: EntryCardProps): React.ReactElement {
  const {colour} = useTheme();
  const {t, language} = useLanguage();
  const [focused, setFocused] = useState(false);
  const first = itemEntry(item);
  const time = entryTime(first);
  const kindColour = useAvailabilityColour(item);
  const subtitle = itemSubtitle(item, t as never);
  const locale = language === 'en' ? 'en-GB' : language;
  const state = itemState(item);
  const lines = wrap ? undefined : 1;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={itemTitle(item)}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onLayout={onLayout}
      onFocus={() => {
        setFocused(true);
        onFocus?.();
      }}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={{
        width: u(width),
        minHeight: u(78),
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: u(8),
        paddingLeft: u(13),
        paddingRight: u(11),
        borderRadius: u(12),
        borderWidth: 1,
        borderLeftWidth: u(4),
        borderColor: selected || focused ? colour.ink : colour.line,
        borderLeftColor: kindColour,
        backgroundColor: colour.surfaceStrong,
      }}
    >
      <View style={{width: u(40), height: u(60), borderRadius: u(6), overflow: 'hidden', backgroundColor: colour.surfaceSoft}}>
        {first.poster_url ? <ArtworkImage uri={first.poster_url} accessToken={undefined} style={{width: '100%', height: '100%'}} resizeMode="cover" /> : null}
      </View>
      <View style={{marginLeft: u(14.4), flex: 1}}>
        <T size={19.2} weight={640} lh={28.8} color={colour.ink} lines={lines}>
          {itemTitle(item)}
        </T>
        {subtitle ? (
          <View style={{marginTop: u(2.4)}}>
            <T size={19.2} weight={400} lh={28.8} color={colour.inkSoft} lines={lines}>
              {subtitle}
            </T>
          </View>
        ) : null}
        <View style={{flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: u(2.4)}}>
          <View style={{marginRight: u(12)}}>
            <T size={12.8} weight={400} lh={19.2} dy={-1} color={colour.inkMuted}>
              {time ? new Intl.DateTimeFormat(locale, {timeStyle: 'short'}).format(time) : t('pages.calendar.allDay')}
            </T>
          </View>
          <View style={{marginRight: u(12)}}>
            <T size={12.8} weight={400} lh={19.2} dy={-1} color={colour.inkMuted}>
              {t(RELEASE_KEYS[first.release_type])}
            </T>
          </View>
          {item.kind === 'series' ? null : (
            <View style={{marginRight: u(12)}}>
              <T size={12.8} weight={400} lh={19.2} dy={-1} color={colour.inkMuted}>
                {t(KIND_KEYS[first.media_kind])}
              </T>
            </View>
          )}
          <Badge state={state} label={t(STATE_KEYS[state])} size={12.8} />
        </View>
      </View>
      {selected || focused ? (
        <View pointerEvents="none" style={{position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, borderRadius: u(12), borderWidth: 1, borderColor: colour.ink}} />
      ) : null}
      {focused ? (
        <View pointerEvents="none" style={{position: 'absolute', left: u(-5), top: u(-5), right: u(-5), bottom: u(-5), borderRadius: u(17), borderWidth: u(3), borderColor: colour.ink}} />
      ) : null}
    </Pressable>
  );
}

/** The details of one release: facts and the actions that apply (open its title, or put it on the watchlist). */
export function ItemDetails({item, locale, onOpen, width = 571.2}: {item: CalendarItem; locale: string; onOpen: (route: string) => void; width?: number}): React.ReactElement {
  const {colour} = useTheme();
  const {t} = useLanguage();
  const client = useApiClient();
  const first = itemEntry(item);
  const entries = item.kind === 'series' ? item.entries : [item.entry];
  const route = workRouteForEntry(first);
  const time = entryTime(first);
  const state = itemState(item);
  const subtitle = item.kind === 'series' ? t('pages.calendar.groupSummary', {count: item.entries.length, codes: formatEpisodeCodes(item.entries)}) : [episodeCode(first), first.subtitle].filter(Boolean).join(' · ');
  const when = time
    ? new Intl.DateTimeFormat(locale, {dateStyle: 'full', timeStyle: 'short'}).format(time)
    : `${new Intl.DateTimeFormat(locale, {weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC'}).format(parseDay(first.date))} · ${t('pages.calendar.allDay')}`;
  const watchlist = useWatchlistToggle(client, route ? null : ({kind: first.media_kind === 'episode' ? 'series' : 'movie', title: first.title, year: null, work_id: null, external_refs: [], poster_url: first.poster_url ?? null} as never));

  const Label = ({children}: {children: string}): React.ReactElement => (
    <T size={11.52} weight={400} ls={1.152} lh={17.3} color={colour.inkMuted} upper>
      {children}
    </T>
  );
  return (
    <View style={{width: u(width)}}>
      <T size={11.84} weight={760} ls={2.1312} lh={17.8} color={colour.inkMuted} upper>
        {`${t(KIND_KEYS[first.media_kind])} · ${t(RELEASE_KEYS[first.release_type])}`}
      </T>
      <View style={{marginTop: u(14.4)}}>
        <T size={38.4} weight={590} ls={-1.536} lh={57.6} color={colour.ink}>
          {itemTitle(item)}
        </T>
      </View>
      {subtitle ? (
        <View style={{marginTop: u(14.4)}}>
          <T size={19.2} weight={400} lh={28.8} color={colour.ink}>
            {subtitle}
          </T>
        </View>
      ) : null}
      <View style={{marginTop: u(14.4)}}>
        <Label>{t('pages.calendar.sheetWhen')}</Label>
        <T size={19.2} weight={400} lh={26.2} dy={4} color={colour.ink}>
          {when}
        </T>
      </View>
      <View style={{marginTop: u(11.4)}}>
        <Label>{t('pages.calendar.sheetState')}</Label>
        <View style={{marginTop: u(1)}}>
          <Badge state={state} label={t(STATE_KEYS[state])} size={19.2} />
        </View>
      </View>
      <View style={{marginTop: u(14.4), flexDirection: 'row', alignItems: 'center'}}>
        {route ? (
          <Button label={first.media_kind === 'episode' ? t('pages.calendar.openSeries') : t('pages.calendar.open')} onPress={() => onOpen(route)} />
        ) : (
          <WatchlistPill listed={watchlist.listed} onPress={watchlist.toggle} />
        )}
        {route ? null : null}
      </View>
    </View>
  );
}

function WatchlistPill({listed, onPress}: {listed: boolean | null; onPress: () => void}): React.ReactElement {
  const {colour} = useTheme();
  const {t} = useLanguage();
  const [focused, setFocused] = useState(false);
  const label = listed ? t('discovery.watchlist.remove') : t('discovery.watchlist.add');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={listed === null}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={{
        height: u(58),
        paddingHorizontal: u(21),
        borderRadius: 999,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: focused ? colour.surfaceSoft : colour.surface,
        borderWidth: 1,
        borderColor: colour.lineStrong,
        opacity: listed === null ? 0.5 : 1,
      }}
    >
      <View style={{marginRight: u(9.6)}}>
        <T size={14.72} weight={720} color={colour.inkSoft}>
          {'+'}
        </T>
      </View>
      <T size={14.72} weight={900} color={colour.inkSoft}>
        {label}
      </T>
    </Pressable>
  );
}

export {Box};
