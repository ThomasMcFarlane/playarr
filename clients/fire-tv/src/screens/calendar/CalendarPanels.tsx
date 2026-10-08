/**
 * The release calendar's panels: the filters drawer, the calendar-link drawer, the period picker and the details sheet that
 * the week and month views open.
 */
import React, {useCallback, useEffect, useState} from 'react';
import {Pressable, ScrollView, TextInput, View} from 'react-native';
import Svg, {Path} from '@amazon-devices/react-native-svg';
import type {CalendarSourceStatus} from '@playarr-tv/api-client';
import {useApiClient} from '../../api/ApiClientProvider';
import {QrCode} from '../../components/QrCode';
import {useLanguage} from '../../i18n/LanguageProvider';
import {CALENDAR_VIEWS, type CalendarView, type CalendarItem, type Day} from '../../lib/calendar';
import {
  CALENDAR_STATUSES,
  CALENDAR_TYPE_PARAMS,
  type CalendarFilters,
  EMPTY_CALENDAR_FILTERS,
  activeFilterCount,
} from '../../lib/calendarFilters';
import {
  type CalendarLinkFailure,
  classifyCalendarLinkError,
  loadStoredCalendarLink,
  openCalendarLink,
  resetCalendarLink,
  storeCalendarLink,
} from '../../lib/calendarLink';
import {Icon} from '../../shell/icons';
import {useBackLayer} from '../../navigation/backPolicy';
import {TvFocusScope} from '../../platform/focus';
import {mix} from '../../theme/color';
import {useTheme} from '../../theme/ThemeProvider';
import {CloseButton, FilterDrawer, type DrawerChip, type DrawerSection, DRAWER_W} from '../../tv/FilterDrawer';
import {Button} from '../../tv/forms';
import {T, u} from '../../tv/kit';
import {ItemDetails} from './CalendarParts';

const VIEW_KEYS = {agenda: 'pages.calendar.viewAgenda', week: 'pages.calendar.viewWeek', month: 'pages.calendar.viewMonth'} as const;
const VIEW_ICONS = {agenda: 'list', week: 'screen', month: 'cover'} as const;
const TYPE_KEYS = {tv: 'pages.calendar.typeTv', movie: 'pages.calendar.typeMovies', music: 'pages.calendar.typeMusic', book: 'pages.calendar.typeBooks'} as const;
const STATUS_KEYS = {aired: 'pages.calendar.statusAired', upcoming: 'pages.calendar.statusUpcoming', downloaded: 'pages.calendar.statusDownloaded', missing: 'pages.calendar.statusMissing'} as const;
const FAILURE_KEYS = {
  unreachable: 'pages.calendar.link.errorUnreachable',
  unsupported: 'pages.calendar.link.errorUnsupported',
  signin: 'pages.calendar.link.errorSignin',
  other: 'pages.calendar.link.errorOther',
} as const;

function toggled<V>(set: ReadonlySet<V>, value: V): Set<V> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export function FiltersPanel({
  view,
  onView,
  filters,
  onFilters,
  sources,
  onClose,
  onFocused,
}: {
  view: CalendarView;
  onView: (view: CalendarView) => void;
  filters: CalendarFilters;
  onFilters: (next: CalendarFilters) => void;
  sources: readonly CalendarSourceStatus[];
  onClose: () => void;
  onFocused?: () => void;
}): React.ReactElement {
  const {t} = useLanguage();
  const chips = <K extends string>(values: readonly K[], label: (value: K) => string, selected: ReadonlySet<K>, toggle: (value: K) => void): DrawerChip[] =>
    values.map((value) => ({key: value, label: label(value), selected: selected.has(value), onPress: () => toggle(value)}));
  const sections: DrawerSection[] = [
    {
      key: 'view',
      label: t('pages.library.view'),
      columns: 2,
      chips: CALENDAR_VIEWS.map((value) => ({key: value, label: t(VIEW_KEYS[value]), selected: view === value, icon: VIEW_ICONS[value], onPress: () => onView(value)})),
    },
    {key: 'type', label: t('pages.calendar.filterType'), columns: 3, chips: chips(CALENDAR_TYPE_PARAMS, (value) => t(TYPE_KEYS[value]), filters.types, (value) => onFilters({...filters, types: toggled(filters.types, value)}))},
  ];
  if (sources.length > 0) {
    sections.push({
      key: 'source',
      label: t('pages.calendar.filterSource'),
      columns: 3,
      chips: sources.map((source) => ({key: source.source_instance_id, label: source.name, selected: filters.sources.has(source.source_instance_id), onPress: () => onFilters({...filters, sources: toggled(filters.sources, source.source_instance_id)})})),
    });
  }
  sections.push(
    {key: 'status', label: t('pages.calendar.filterStatus'), columns: 3, chips: chips(CALENDAR_STATUSES, (value) => t(STATUS_KEYS[value]), filters.statuses, (value) => onFilters({...filters, statuses: toggled(filters.statuses, value)}))},
    {
      key: 'range',
      label: t('pages.calendar.filterDateRange'),
      height: 181.4,
      render: (top, reveal) => (
        <>
          <DateField label={t('pages.calendar.rangeFrom')} value={filters.from} y={top} onChange={(from) => onFilters({...filters, from})} onReveal={reveal} />
          <DateField label={t('pages.calendar.rangeTo')} value={filters.to} y={top + 82.6} onChange={(to) => onFilters({...filters, to})} onReveal={reveal} />
        </>
      ),
    },
    {
      key: 'monitoring',
      label: t('pages.calendar.filterMonitored'),
      columns: 3,
      chips: [{key: 'monitored', label: t('pages.calendar.monitoredOnly'), selected: filters.monitoredOnly, onPress: () => onFilters({...filters, monitoredOnly: !filters.monitoredOnly})}],
    },
  );
  const active = activeFilterCount(filters) > 0;
  return (
    <FilterDrawer
      kicker={t('pages.calendar.title')}
      title={t('pages.library.filters')}
      closeLabel={t('pages.library.closeFilters')}
      onClose={onClose}
      sections={sections}
      onFocused={onFocused}
      footerHeight={active ? 90 : 0}
      footer={
        active
          ? (end) => (
              <View style={{position: 'absolute', left: u(46), top: u(end + 26)}}>
                <Button label={t('pages.calendar.clearFilters')} variant="secondary" onPress={() => onFilters(EMPTY_CALENDAR_FILTERS)} />
              </View>
            )
          : undefined
      }
    />
  );
}

/** A day typed as dd/mm/yyyy: 268 x 52, labelled above, as the web's date input. */
function DateField({label, value, y, onChange, onReveal}: {label: string; value: Day | null; y: number; onChange: (day: Day | null) => void; onReveal: (y: number, h: number) => void}): React.ReactElement {
  const {colour} = useTheme();
  const [text, setText] = useState(value ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}` : '');
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    setText(value ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}` : '');
  }, [value]);
  const commit = (next: string): void => {
    setText(next);
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(next);
    if (match) onChange(`${match[3]}-${match[2]}-${match[1]}`);
    else if (next === '') onChange(null);
  };
  return (
    <View style={{position: 'absolute', left: u(46), top: u(y)}}>
      <T size={11.136} weight={680} lh={16.7} color={colour.inkMuted}>
        {label}
      </T>
      <View style={{marginTop: u(4)}}>
        <View pointerEvents="none" style={{position: 'absolute', right: u(12), top: u(19), zIndex: 2}}>
          <Icon name="calendar" size={u(12)} color={colour.ink} strokeWidth={2} />
        </View>
        <TextInput
          value={text}
          placeholder="dd/mm/yyyy"
          placeholderTextColor={colour.ink}
          keyboardType="numbers-and-punctuation"
          onChangeText={commit}
          onFocus={() => {
            setFocused(true);
            onReveal(y, 72);
          }}
          onBlur={() => setFocused(false)}
          style={{
            width: u(268),
            height: u(52),
            borderRadius: u(12),
            paddingHorizontal: u(12),
            paddingVertical: 0,
            textAlignVertical: 'center',
            color: colour.ink,
            fontSize: u(11.52),
            backgroundColor: colour.surfaceSoft,
            borderWidth: u(focused ? 2 : 0),
            borderColor: colour.ink,
          }}
        />
      </View>
    </View>
  );
}

export function LinkPanel({onClose, onFocused}: {onClose: () => void; onFocused?: () => void}): React.ReactElement {
  const {colour} = useTheme();
  const {t} = useLanguage();
  const client = useApiClient();
  const [url, setUrl] = useState<string | null>(() => loadStoredCalendarLink());
  const [needsReset, setNeedsReset] = useState(false);
  const [failure, setFailure] = useState<CalendarLinkFailure | null>(null);
  const [busy, setBusy] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copy = async (): Promise<void> => {
    const clipboard = (globalThis as {navigator?: {clipboard?: {writeText?: (text: string) => Promise<void>}}}).navigator?.clipboard;
    try {
      if (!clipboard?.writeText || !url) throw new Error('no clipboard');
      await clipboard.writeText(url);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };

  const show = useCallback((link: string) => {
    storeCalendarLink(link);
    setUrl(link);
    setNeedsReset(false);
    setConfirming(false);
  }, []);
  const open = useCallback(async () => {
    setBusy(true);
    setFailure(null);
    try {
      const state = await openCalendarLink(client, loadStoredCalendarLink());
      if (state.kind === 'link') show(state.url);
      else setNeedsReset(true);
    } catch (error) {
      setFailure(classifyCalendarLinkError(error));
    } finally {
      setBusy(false);
    }
  }, [client, show]);
  const reset = useCallback(async () => {
    setBusy(true);
    setFailure(null);
    try {
      show(await resetCalendarLink(client));
    } catch (error) {
      setFailure(classifyCalendarLinkError(error));
    } finally {
      setBusy(false);
    }
  }, [client, show]);
  useEffect(() => {
    void open();
  }, [open]);
  useBackLayer(true, onClose);

  const left = 1606 - 1560;
  return (
    <>
      <View style={{position: 'absolute', left: u(1560), top: 0, width: u(DRAWER_W), height: u(1080), backgroundColor: colour.surfaceStrong}}>
        <TvFocusScope autoFocus trap={['up', 'down', 'left', 'right']} style={{width: u(DRAWER_W), height: u(1080)}}>
          <View style={{position: 'absolute', left: u(left), top: u(54)}}>
            <T size={9.6} weight={720} ls={0.672} lh={14.4} color={colour.inkMuted} upper>
              {t('pages.calendar.title')}
            </T>
          </View>
          <View style={{position: 'absolute', left: u(left), top: u(71.6), width: u(230)}}>
            <T size={38.4} weight={590} ls={-2.112} lh={57.6} color={colour.ink}>
              {t('pages.calendar.subscription.title')}
            </T>
          </View>
          <CloseButton label={t('pages.library.closeFilters')} onPress={onClose} onFocused={onFocused} />
          <View style={{position: 'absolute', left: u(left), top: u(159.4), width: u(268)}}>
            <T size={13.824} weight={400} lh={21} color={colour.inkMuted}>
              {t('pages.calendar.subscription.description')}
            </T>
          </View>
          {failure ? (
            <View style={{position: 'absolute', left: u(left), top: u(254.4), width: u(268)}}>
              <T size={13.824} weight={400} lh={21} color={colour.danger}>
                {t(FAILURE_KEYS[failure])}
              </T>
              <View style={{marginTop: u(8)}}>
                <Button label={t('pages.calendar.retry')} variant="secondary" onPress={() => void open()} />
              </View>
            </View>
          ) : null}
          {busy && !url ? (
            <View style={{position: 'absolute', left: u(left), top: u(254.4)}}>
              <T size={13.824} weight={400} lh={21} color={colour.inkMuted}>
                {t('pages.calendar.link.preparing')}
              </T>
            </View>
          ) : null}
          {url ? (
            <>
              <View style={{position: 'absolute', left: u(left), top: u(254.4), width: u(268), height: u(44), borderRadius: u(8), borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.surface, justifyContent: 'center', paddingHorizontal: u(12), overflow: 'hidden'}}>
                <T size={12.8} weight={400} mono lh={19} color={colour.ink} lines={1} style={{width: u(900)}}>
                  {url}
                </T>
              </View>
              <View style={{position: 'absolute', left: u(left), top: u(308)}}>
                <Button label={copyState === 'copied' ? t('pages.calendar.subscription.copied') : t('pages.calendar.subscription.copy')} onPress={() => void copy()} />
              </View>
              {copyState === 'failed' ? (
                <View style={{position: 'absolute', left: u(left + 118), top: u(326), width: u(150)}}>
                  <T size={11} weight={400} lh={14} color={colour.danger}>
                    {t('pages.calendar.subscription.copyFailed')}
                  </T>
                </View>
              ) : null}
              <View style={{position: 'absolute', left: u(left), top: u(375.5), width: u(240), height: u(240), borderRadius: u(18), backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center'}}>
                <QrCode value={url} size={216} accessibilityLabel={t('pages.calendar.subscription.qrLabel')} />
              </View>
            </>
          ) : null}
          <View style={{position: 'absolute', left: u(left), top: u(627.5)}}>
            <T size={9.6} weight={720} ls={0.672} lh={14.4} color={colour.inkMuted} upper>
              {t('pages.calendar.subscription.instructionsTitle')}
            </T>
          </View>
          <View style={{position: 'absolute', left: u(left), top: u(653.9), width: u(268)}}>
            {(['instructionGoogle', 'instructionApple', 'instructionOutlook'] as const).map((key) => (
              <View key={key} style={{height: u(41.5)}}>
                <View style={{position: 'absolute', left: u(-13)}}>
                  <T size={13.824} weight={400} lh={20.8} color={colour.ink}>
                    {'•'}
                  </T>
                </View>
                <View style={{flex: 1}}>
                  <T size={13.824} weight={400} lh={20.8} color={colour.ink}>
                    {t(`pages.calendar.subscription.${key}` as const)}
                  </T>
                </View>
              </View>
            ))}
          </View>
          {confirming ? (
            <View style={{position: 'absolute', left: u(left), top: u(790.3), width: u(268)}}>
              <T size={13.824} weight={400} lh={21} color={colour.ink}>
                {t('pages.calendar.subscription.confirmRegenerate')}
              </T>
              <View style={{marginTop: u(10), flexDirection: 'row'}}>
                <Button label={t('pages.calendar.subscription.regenerate')} disabled={busy} hasTVPreferredFocus onPress={() => void reset()} />
                <View style={{width: u(8)}} />
                <Button label={t('pages.calendar.subscription.cancel')} variant="secondary" disabled={busy} onPress={() => setConfirming(false)} />
              </View>
            </View>
          ) : url || needsReset ? (
            <View style={{position: 'absolute', left: u(left), top: u(790.3)}}>
              <GhostButton label={t('pages.calendar.subscription.regenerate')} disabled={busy} onPress={() => setConfirming(true)} />
            </View>
          ) : null}
        </TvFocusScope>
      </View>
    </>
  );
}

function GhostButton({label, onPress, disabled}: {label: string; onPress: () => void; disabled?: boolean}): React.ReactElement {
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
      style={{height: u(58), paddingHorizontal: u(21), borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: focused ? colour.surfaceSoft : 'transparent', opacity: disabled ? 0.55 : 1}}
    >
      <T size={14.72} weight={720} color={colour.ink}>
        {label}
      </T>
    </Pressable>
  );
}

/** The period label as a button; choosing a month and year jumps there. */
export function PeriodPicker({label, anchor, locale, onChange}: {label: string; anchor: Day; locale: string; onChange: (day: Day) => void}): React.ReactElement {
  const {colour} = useTheme();
  const {t} = useLanguage();
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const year = Number(anchor.slice(0, 4));
  const month = Number(anchor.slice(5, 7));
  const [draftYear, setDraftYear] = useState(year);
  useBackLayer(open, () => setOpen(false));
  const months = Array.from({length: 12}, (_, i) => new Intl.DateTimeFormat(locale, {month: 'long', timeZone: 'UTC'}).format(new Date(Date.UTC(2026, i, 1))));
  const years = Array.from({length: 31}, (_, i) => year - 15 + i);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onPress={() => {
          setDraftYear(year);
          setOpen(true);
        }}
        style={{position: 'absolute', left: u(153.6), top: u(162), height: u(62), paddingHorizontal: u(21), borderRadius: 999, flexDirection: 'row', alignItems: 'center', backgroundColor: focused ? colour.surfaceSoft : 'transparent'}}
      >
        <T size={24} weight={640} lh={36} color={colour.ink}>
          {label}
        </T>
        <View style={{marginLeft: u(10), width: u(7.4), height: u(7.4), marginTop: u(1)}}>
          <Svg width={u(7.4)} height={u(7.4)} viewBox="0 0 8 8">
            <Path d="M0 1H8L4 7.2Z" fill={colour.ink} />
          </Svg>
        </View>
      </Pressable>
      {open ? (
        <View style={{position: 'absolute', left: u(153.6), top: u(232), flexDirection: 'row', padding: u(9.6), borderRadius: u(18), borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.surfaceStrong, zIndex: 5}}>
          <TvFocusScope autoFocus trap={['up', 'down', 'left', 'right']}>
            <View style={{flexDirection: 'row'}}>
              <ScrollView style={{width: u(190), maxHeight: u(420)}} accessibilityLabel={t('pages.calendar.jumpMonth')}>
                {months.map((name, i) => (
                  <PickerOption
                    key={name}
                    label={name}
                    selected={draftYear === year && i + 1 === month}
                    hasTVPreferredFocus={draftYear === year && i + 1 === month}
                    onPress={() => {
                      onChange(`${String(draftYear).padStart(4, '0')}-${String(i + 1).padStart(2, '0')}-01`);
                      setOpen(false);
                    }}
                  />
                ))}
              </ScrollView>
              <View style={{width: u(8)}} />
              <ScrollView style={{width: u(190), maxHeight: u(420)}} accessibilityLabel={t('pages.calendar.jumpYear')}>
                {years.map((value) => (
                  <PickerOption key={value} label={String(value)} selected={value === draftYear} onPress={() => setDraftYear(value)} />
                ))}
              </ScrollView>
            </View>
          </TvFocusScope>
        </View>
      ) : null}
    </>
  );
}

function PickerOption({label, selected, onPress, hasTVPreferredFocus}: {label: string; selected: boolean; onPress: () => void; hasTVPreferredFocus?: boolean}): React.ReactElement {
  const {colour} = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={{height: u(44), borderRadius: u(12), paddingHorizontal: u(14.4), justifyContent: 'center', backgroundColor: selected ? colour.ink : 'transparent', borderWidth: focused ? 2 : 0, borderColor: colour.ink}}
    >
      <T size={16} weight={640} lh={24} color={selected ? colour.bg : colour.inkSoft}>
        {label}
      </T>
    </Pressable>
  );
}

/** Details of one release for the week and month views (the agenda shows them beside its list). */
export function DetailSheet({item, locale, onClose, onOpen}: {item: CalendarItem; locale: string; onClose: () => void; onOpen: (route: string) => void}): React.ReactElement {
  const {colour} = useTheme();
  const {t} = useLanguage();
  useBackLayer(true, onClose);
  return (
    <>
      <View pointerEvents="none" style={{position: 'absolute', left: 0, top: 0, width: u(1920), height: u(1080), backgroundColor: 'rgba(0, 0, 0, 0.5)'}} />
      <View style={{position: 'absolute', left: u(680), top: 0, width: u(560), height: u(1080), justifyContent: 'center'}} pointerEvents="box-none">
        <View style={{padding: u(24), borderRadius: u(18), borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.surfaceStrong}}>
          <TvFocusScope autoFocus trap={['up', 'down', 'left', 'right']}>
            <ItemDetails item={item} locale={locale} onOpen={onOpen} width={510} />
            <View style={{marginTop: u(12)}}>
              <Button label={t('pages.calendar.sheetClose')} variant="secondary" onPress={onClose} />
            </View>
          </TvFocusScope>
        </View>
      </View>
    </>
  );
}
