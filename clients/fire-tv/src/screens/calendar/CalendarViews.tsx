/**
 * The release calendar's three views at the web TV layout's measurements: the agenda (details on the left, the day-by-day
 * list on the right), the week (one 440 px column per day on a horizontal track, each column scrolling on its own) and the
 * month grid. Every scrolling area fades at the edges where content continues.
 */
import React, {useRef, useState} from 'react';
import {Animated, Pressable, View} from 'react-native';
import type {CalendarEntry} from '@playarr-tv/api-client';
import {useLanguage} from '../../i18n/LanguageProvider';
import {type CalendarItem, type Day, type DayGroup, type MonthCell, buildMonthGrid, buildWeekDays, groupSeriesEpisodes, itemAvailability, parseDay} from '../../lib/calendar';
import {mix} from '../../theme/color';
import {useTheme} from '../../theme/ThemeProvider';
import {EdgeFade} from '../../tv/EdgeFade';
import {Box, T, u} from '../../tv/kit';
import {useScrollReveal} from '../../tv/useScrollReveal';
import {EntryCard, ItemDetails, itemEntry, itemTitle} from './CalendarParts';

export const BODY_BOTTOM = 961.3;
const AGENDA_X = 786.4;
const AGENDA_W = 1048.8;
const DAY_GAP = 32;
const HEADING_H = 27.6;
const HEADING_GAP = 6.4;
const ENTRY_GAP = 13.6;
const WEEK_X = 153.6;
const WEEK_W = 1689.6;
const COLUMN_W = 440;
const COLUMN_PITCH = 460;

export interface ViewShared {
  today: Day;
  locale: string;
  contentTop: number;
  selectedKey: string | null;
  onSelect: (item: CalendarItem) => void;
  onOpenRoute: (route: string) => void;
}

/** "Thursday 8 October": the weekday, then the day and month, with no comma whatever the platform's Intl does. */
function dayHeading(day: Day, locale: string): string {
  const date = parseDay(day);
  const weekday = new Intl.DateTimeFormat(locale, {weekday: 'long', timeZone: 'UTC'}).format(date);
  const rest = new Intl.DateTimeFormat(locale, {day: 'numeric', month: 'long', timeZone: 'UTC'}).format(date);
  return `${weekday} ${rest}`;
}

function DayHeading({day, today, locale}: {day: Day; today: Day; locale: string}): React.ReactElement {
  const {colour} = useTheme();
  const {t} = useLanguage();
  return (
    <View style={{flexDirection: 'row', alignItems: 'center', height: u(HEADING_H)}}>
      <T size={18.4} weight={640} lh={HEADING_H} color={day === today ? colour.accent : colour.ink}>
        {dayHeading(day, locale)}
      </T>
      {day === today ? (
        <View style={{marginLeft: u(9.6), height: u(19.2), paddingHorizontal: u(8), borderRadius: 999, borderWidth: 1, borderColor: colour.accent, justifyContent: 'center'}}>
          <T size={11.2} weight={640} ls={0.896} lh={14} color={colour.accent} upper>
            {t('pages.calendar.today')}
          </T>
        </View>
      ) : null}
    </View>
  );
}

/** Agenda: the previewed release's details on the left, the list on the right. */
function AgendaViewImpl({groups, selectedKey, onSelect, onOpenRoute, locale, today, contentTop}: ViewShared & {groups: readonly DayGroup[]}): React.ReactElement {
  const items = groups.flatMap((group) => groupSeriesEpisodes(group.entries).map((item) => ({day: group.day, item})));
  const selected = items.find((entry) => entry.item.key === selectedKey)?.item ?? items[0]?.item ?? null;
  const rows = useRef(new Map<string, {y: number; h: number}>()).current;
  const [contentH, setContentH] = useState(0);
  const top = contentTop - 4;
  const viewport = BODY_BOTTOM - top;
  const scroll = useScrollReveal({viewport, content: contentH + 8 + 32, margin: 24});
  let previous: Day | null = null;

  return (
    <>
      {selected ? (
        <Box x={153.6} y={contentTop} w={571.2}>
          <ItemDetails item={selected} locale={locale} onOpen={onOpenRoute} />
        </Box>
      ) : null}
      <Box x={AGENDA_X - 4} y={top} w={AGENDA_W + 24} h={viewport} style={{overflow: 'hidden'}} pointerEvents="box-none">
        <Animated.View style={{position: 'absolute', left: u(4), top: Animated.add(new Animated.Value(u(4)), scroll.offset), width: u(AGENDA_W)}} pointerEvents="box-none" onLayout={(event) => setContentH(event.nativeEvent.layout.height / (event.nativeEvent.layout.width / AGENDA_W))}>
          {items.map((entry, index) => {
            const heading = entry.day !== previous;
            previous = entry.day;
            return (
              <React.Fragment key={entry.item.key}>
                {heading ? (
                  <View style={{marginTop: u(index === 0 ? 0 : DAY_GAP - ENTRY_GAP), marginBottom: u(HEADING_GAP)}}>
                    <DayHeading day={entry.day} today={today} locale={locale} />
                  </View>
                ) : null}
                <View
                  style={{marginBottom: u(ENTRY_GAP)}}
                  onLayout={(event) => {
                    rows.set(entry.item.key, {y: event.nativeEvent.layout.y / (event.nativeEvent.layout.width / AGENDA_W), h: event.nativeEvent.layout.height / (event.nativeEvent.layout.width / AGENDA_W)});
                  }}
                >
                  <EntryCard
                    item={entry.item}
                    width={AGENDA_W}
                    selected={selected?.key === entry.item.key}
                                        onFocus={() => {
                      onSelect(entry.item);
                      const row = rows.get(entry.item.key);
                      if (row) scroll.reveal(row.y, row.h);
                    }}
                    onPress={() => {
                      const route = itemRoute(entry.item);
                      if (route) onOpenRoute(route);
                    }}
                  />
                </View>
              </React.Fragment>
            );
          })}
        </Animated.View>
      </Box>
      <EdgeFade side="top" active={scroll.scrolled > 0} x={AGENDA_X - 4} y={top} w={AGENDA_W + 24} h={viewport} />
      <EdgeFade side="bottom" active={scroll.scrolled < scroll.max - 1} x={AGENDA_X - 4} y={top} w={AGENDA_W + 24} h={viewport} />
    </>
  );
}

function itemRoute(item: CalendarItem): string | null {
  const entry = itemEntry(item);
  return entry.work_id ? `/${entry.media_kind === 'movie' ? 'movies' : entry.media_kind === 'album' ? 'music' : 'series'}/${entry.work_id}` : null;
}

/** One week column: its heading and entries, scrolling on their own inside a 440 px window. */
function DayColumn({group, x, height, shared, onColumnFocus, onOpen}: {group: DayGroup; x: number; height: number; shared: ViewShared; onColumnFocus: () => void; onOpen: (item: CalendarItem) => void}): React.ReactElement {
  const {colour} = useTheme();
  const {t} = useLanguage();
  const items = groupSeriesEpisodes(group.entries);
  const rows = useRef(new Map<string, {y: number; h: number}>()).current;
  const [contentH, setContentH] = useState(0);
  const scroll = useScrollReveal({viewport: height, content: contentH + 16, margin: 24});
  return (
    <>
      <Box x={x - 6} y={-6} w={COLUMN_W + 12} h={height + 12} style={{overflow: 'hidden'}} pointerEvents="box-none">
        <Animated.View style={{position: 'absolute', left: u(6), top: Animated.add(new Animated.Value(u(6)), scroll.offset), width: u(COLUMN_W)}} pointerEvents="box-none" onLayout={(event) => setContentH(event.nativeEvent.layout.height)}>
          <View style={{marginBottom: u(HEADING_GAP)}}>
            <DayHeading day={group.day} today={shared.today} locale={shared.locale} />
          </View>
          {items.length === 0 ? (
            <T size={12.8} weight={400} lh={19.2} color={colour.inkMuted}>
              {t('pages.calendar.dayEmpty')}
            </T>
          ) : null}
          {items.map((item) => (
            <View
              key={item.key}
              style={{marginBottom: u(ENTRY_GAP)}}
              onLayout={(event) => rows.set(item.key, {y: event.nativeEvent.layout.y, h: event.nativeEvent.layout.height})}
            >
              <EntryCard
                item={item}
                width={COLUMN_W}
                wrap
                selected={shared.selectedKey === item.key}
                onFocus={() => {
                  onColumnFocus();
                  const row = rows.get(item.key);
                  if (row) scroll.reveal(row.y, row.h);
                }}
                onPress={() => onOpen(item)}
              />
            </View>
          ))}
        </Animated.View>
      </Box>
      <EdgeFade side="top" active={scroll.scrolled > 0} x={x} y={0} w={COLUMN_W} h={height} />
      <EdgeFade side="bottom" active={scroll.scrolled < scroll.max - 1} x={x} y={0} w={COLUMN_W} h={height} />
    </>
  );
}

/** Week: LEFT and RIGHT move between days, UP and DOWN between entries of a day. */
function WeekViewImpl({groups, anchor, firstDay, shared}: {groups: readonly DayGroup[]; anchor: Day; firstDay: number; shared: ViewShared}): React.ReactElement {
  const days = buildWeekDays(anchor, firstDay, groups, shared.today);
  const top = 236;
  const height = 949 - top;
  const scroll = useScrollReveal({viewport: WEEK_W, content: days.length * COLUMN_PITCH - 20, snap: 0});
  return (
    <>
      <Box x={WEEK_X - 8} y={top - 8} w={WEEK_W + 16} h={height + 16} style={{overflow: 'hidden'}} pointerEvents="box-none">
        <Animated.View style={{position: 'absolute', left: Animated.add(new Animated.Value(u(8)), scroll.offset), top: u(8), width: u(days.length * COLUMN_PITCH), height: u(height)}} pointerEvents="box-none">
          {days.map((group, index) => {
            // Only the columns on screen (and one either side) are drawn: the device is slow to mount a week of posters.
            const first = Math.floor(scroll.scrolled / COLUMN_PITCH);
            if (index < first - 1 || index > first + 4) return null;
            return (
            <DayColumn
              key={group.day}
              group={group}
              x={index * COLUMN_PITCH}
              height={height}
              shared={shared}
              onColumnFocus={() => scroll.reveal(index * COLUMN_PITCH, COLUMN_W)}
              onOpen={shared.onSelect}
            />
            );
          })}
        </Animated.View>
      </Box>
      <WeekEdges scrolled={scroll.scrolled} max={scroll.max} top={top} height={height} />
    </>
  );
}

function WeekEdges({scrolled, max, top, height}: {scrolled: number; max: number; top: number; height: number}): React.ReactElement {
  return (
    <>
      <EdgeFade side="left" active={scrolled > 0} x={WEEK_X} y={top} w={WEEK_W} h={height} size={58} />
      <EdgeFade side="right" active={scrolled < max - 1} x={WEEK_X} y={top} w={WEEK_W} h={height} size={58} />
    </>
  );
}

const MONTH_X = 153.6;
const MONTH_W = 1689.6;
const MONTH_HEAD_Y = 236;
const MONTH_GRID_Y = 266.8;
const CELL_W = MONTH_W / 7;
const CHIP_LIMIT = 3;

/** Month: a seven-column grid whose cells show as many release chips as fit, then "+N more". */
function MonthViewImpl({groups, anchor, firstDay, shared, onMore}: {groups: readonly DayGroup[]; anchor: Day; firstDay: number; shared: ViewShared; onMore: (day: Day) => void}): React.ReactElement {
  const {colour} = useTheme();
  const {t, language} = useLanguage();
  const weeks = buildMonthGrid(anchor, firstDay, groups, shared.today);
  const rowH = (BODY_BOTTOM - MONTH_GRID_Y) / weeks.length;
  const chipLimit = Math.max(1, Math.min(CHIP_LIMIT + 2, Math.floor((rowH - 52) / 26)));
  const weekday = new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : language, {weekday: 'short', timeZone: 'UTC'});
  return (
    <>
      {weeks[0]!.map((cell, index) => (
        <Box key={cell.day} x={MONTH_X + index * CELL_W} y={MONTH_HEAD_Y} w={CELL_W} h={30.8}>
          <View style={{height: u(30.8), alignItems: 'center', justifyContent: 'center'}}>
            <T size={12} weight={400} ls={0.96} lh={18} color={colour.inkMuted} upper>
              {weekday.format(parseDay(cell.day))}
            </T>
          </View>
        </Box>
      ))}
      {weeks.map((week, weekIndex) =>
        week.map((cell, cellIndex) => (
          <MonthCellView key={cell.day} cell={cell} x={MONTH_X + cellIndex * CELL_W} y={MONTH_GRID_Y + weekIndex * rowH} h={rowH} chipLimit={chipLimit} shared={shared} onMore={onMore} moreLabel={(count) => t('pages.calendar.more', {count})} />
        )),
      )}
    </>
  );
}

function MonthCellView({cell, x, y, h, chipLimit, shared, onMore, moreLabel}: {cell: MonthCell; x: number; y: number; h: number; chipLimit: number; shared: ViewShared; onMore: (day: Day) => void; moreLabel: (count: number) => string}): React.ReactElement {
  const {colour} = useTheme();
  const items = groupSeriesEpisodes(cell.entries);
  const overflow = items.length > chipLimit;
  const shown = overflow ? items.slice(0, Math.max(1, chipLimit - 1)) : items;
  const hidden = items.length - shown.length;
  return (
    <>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: u(x),
          top: u(y),
          width: u(CELL_W),
          height: u(h),
          borderWidth: 1,
          borderColor: colour.line,
          backgroundColor: cell.inMonth ? 'transparent' : mix(colour.surfaceSoft, 0.4),
        }}
      />
      {cell.isToday ? <View pointerEvents="none" style={{position: 'absolute', left: u(x), top: u(y), width: u(CELL_W), height: u(h), borderWidth: u(2), borderColor: colour.accent}} /> : null}
      <Box x={x + 5.8} y={y + 5.8} w={CELL_W - 12}>
        <T size={12.8} weight={640} lh={19.2} dy={-1} color={cell.inMonth ? colour.ink : colour.inkMuted}>
          {String(parseDay(cell.day).getUTCDate())}
        </T>
      </Box>
      {shown.map((item, index) => (
        <Chip key={item.key} item={item} x={x + 5.8} y={y + 32.2 + index * 30.8} w={CELL_W - 12} onPress={() => shared.onSelect(item)} />
      ))}
      {hidden > 0 ? <MoreButton label={moreLabel(hidden)} x={x + 5.8} y={y + 32.2 + shown.length * 30.8 - 2} w={CELL_W - 12} onPress={() => onMore(cell.day)} /> : null}
    </>
  );
}

function Chip({item, x, y, w, onPress}: {item: CalendarItem; x: number; y: number; w: number; onPress: () => void}): React.ReactElement {
  const {colour} = useTheme();
  const [focused, setFocused] = useState(false);
  const available = itemAvailability(item) === 'available';
  const entry: CalendarEntry = itemEntry(item);
  void entry;
  const label = item.kind === 'series' ? `${item.title} · ${item.entries.length}×` : itemTitle(item);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={itemTitle(item)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={{position: 'absolute', left: u(x), top: u(y), width: u(w), height: u(24), borderRadius: u(4), borderLeftWidth: u(3), borderLeftColor: available ? colour.success : colour.inkMuted, backgroundColor: colour.surfaceSoft, justifyContent: 'center', paddingLeft: u(5.6), paddingRight: u(5.6), overflow: 'visible'}}
    >
      <T size={12} weight={item.kind === 'series' ? 680 : 400} lh={18} color={colour.ink} lines={1}>
        {label}
      </T>
      {focused ? <View pointerEvents="none" style={{position: 'absolute', left: u(-5), top: u(-5), right: u(-5), bottom: u(-5), borderRadius: u(9), borderWidth: u(3), borderColor: colour.ink}} /> : null}
    </Pressable>
  );
}

function MoreButton({label, x, y, w, onPress}: {label: string; x: number; y: number; w: number; onPress: () => void}): React.ReactElement {
  const {colour} = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={{position: 'absolute', left: u(x), top: u(y), width: u(w), height: u(24), borderRadius: u(4), justifyContent: 'center', paddingLeft: u(8.6)}}
    >
      <T size={12} weight={400} lh={18} color={colour.inkSoft} lines={1}>
        {label}
      </T>
      {focused ? <View pointerEvents="none" style={{position: 'absolute', left: u(-5), top: u(-5), right: u(-5), bottom: u(-5), borderRadius: u(9), borderWidth: u(3), borderColor: colour.ink}} /> : null}
    </Pressable>
  );
}

export const AgendaView = React.memo(AgendaViewImpl);
export const WeekView = React.memo(WeekViewImpl);
export const MonthView = React.memo(MonthViewImpl);
