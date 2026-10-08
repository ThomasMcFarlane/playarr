/**
 * RN port of `clients/tv-web/web/src/pages/Library.tsx` -- one screen for
 * all four of Movies/Series/Sites/Music (`kind` picks which), backing
 * `ROUTES.movies`/`ROUTES.series`/`ROUTES.sites`/`ROUTES.music` (design doc
 * §7's screen table: "One screen, kind param").
 *
 * Scope narrowing, stated explicitly because tv-web's version is 850 lines
 * and this is not: that size comes from features this v1 Vega pass
 * deliberately does not attempt yet, each for its own reason --
 *
 *  - Infinite scroll / "load more" pagination, alphabet-letter jump list,
 *    and a `view`/`artworkSize`/`sort`/`order` picker drawer, all persisted
 *    per-kind to `localStorage`. tv-web's version needs these because a
 *    mouse-and-keyboard user can comfortably operate a drawer of controls
 *    and a jump-to-letter rail; a D-pad-only remote cannot as easily, and
 *    `components/TvMediaTrack.tsx` / a real filter-drawer component (both
 *    components-phase, out of this screen's scope) are what a genuinely
 *    TV-native version of these controls should be built on rather than
 *    this screen improvising a one-off drawer with raw `View`s.
 *  - `useCatalogBrowse` (this screen's actual data source, `@playarr-tv/
 *    api-client/react`, reused verbatim per this task's brief) fetches one
 *    page and does not expose a "fetch page 2" affordance of its own --
 *    reimplementing tv-web's own hand-rolled offset/limit paging loop on
 *    top of it would mean not actually reusing the shared hook's contract,
 *    just its first call. `limit` below is generous (120) specifically so a
 *    typical personal-media library's whole catalog for one kind fits in
 *    that one page; a library that genuinely exceeds it degrades to
 *    "the newest/first-sorted 120 titles", not a crash or an empty screen.
 *  - Per-title watch-progress overlays (`GET /api/v1/playback/progress`) --
 *    a real feature, not attempted here because it is its own round trip
 *    and its own overlay component design doc §7 doesn't scope to this
 *    screen specifically.
 *
 * What IS ported faithfully: the `AsyncState` contract (idle is never
 * reachable here -- `useCatalogBrowse` has no `enabled` gate, so loading
 * starts immediately on mount), the empty-vs-error distinction, and
 * navigating a selected title to the correct detail screen -- `artist`
 * results open `MusicDetailScreen`, everything else opens `WorkDetailScreen`
 * (design doc §7: "WorkDetail backs /series/:id, /movies/:id, ...").
 */
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ActivityIndicator, Animated, Easing, FlatList, Image, Pressable, Text, View} from 'react-native';
import type {ApiClient, WatchProgress, Work, WorkKind} from '@playarr-tv/api-client';
import {ArtworkImage} from '../components/ArtworkImage';
import {useLanguage} from '../i18n/LanguageProvider';
import {useTvBackNavigation} from '../navigation/backPolicy';
import {mix} from '../theme/color';
import {useTheme} from '../theme/ThemeProvider';
import {Icon} from '../shell/icons';
import {ActionTile} from '../tv/ActionTile';
import {Button} from '../tv/forms';
import {EdgeFade} from '../tv/EdgeFade';
import {MediaFocus} from '../tv/mediaFocus';
import {Box, T, u} from '../tv/kit';
import {PageHeader} from '../tv/PageHeader';
import {Preview} from '../tv/Preview';
import {RailFrost, Stage} from '../tv/Stage';
import {indexWatchProgressByWork, WatchState} from '../tv/WatchState';
import {cardArtUrl, stageArtUrl} from '../tv/ArtOfWork';
import {FilterDrawer, type DrawerChip, type DrawerSection} from '../tv/FilterDrawer';
import {
  type ArtworkSize,
  type LibrarySort,
  type LibraryView,
  type SortOrder,
  rememberLibraryView,
  storedLibraryView,
} from '../lib/libraryView';
import {languageDisplayName, toggleLanguage} from '../lib/languageFilters';
import type {LanguageFacets} from '@playarr-tv/api-client';
import {useCatalogBrowse} from '@playarr-tv/api-client/react';
import {useApiClient} from '../api/ApiClientProvider';
import {artworkAuthHeaders, preferredArtworkKind, workArtworkUrl} from '../api/artworkUrl';
import {CAPABILITIES} from '../platform/capabilities';
import {colour} from '../theme/tokens';
import {layout, text} from '../theme/styles';
import {sh, sw} from '../theme/scale';
import {ROUTES, type RouteName} from '../navigation/routes';

export type LibraryKind = Extract<WorkKind, 'movie' | 'series' | 'site' | 'artist'>;

const KIND_LABEL: Record<LibraryKind, string> = {
  movie: 'Movies',
  series: 'Series',
  site: 'Sites',
  artist: 'Music',
};

/** A page's worth of titles for one kind -- generous enough that a typical personal library fits in it; see this file's top comment. */
const PAGE_LIMIT = 120;

/**
 * Resolves the access token once per `client` identity, so `<Image
 * source={{uri, headers}}>` (design doc assumption A4, `platform/
 * capabilities.ts`'s `artworkRequestHeaders` flag) has something to attach.
 * `ApiClientProvider` (design doc §4.5, deliberately reduced for this phase
 * of the project) does not yet expose the raw token itself -- only
 * `ApiClient.getAccessToken()`, which is async because its own
 * `ApiClientConfig.getAccessToken` contract allows a `Promise` return, even
 * though today's concrete implementation resolves synchronously. This is
 * genuinely a `useEffect` case per the repo's React rule (CLAUDE.md:
 * "useEffect is for synchronising with external systems") -- the token
 * lives in `@playarr-tv/device-auth`'s `TokenStore`, external to this
 * component's own render, not a value derivable from props/state.
 *
 * Duplicated (in near-identical form) across every screen in this
 * directory that renders artwork, rather than factored into a shared
 * hook, because the natural home for it -- `components/ArtworkImage.tsx`,
 * which this task's own constraints do not permit creating (that file is a
 * concurrent/later components-phase task; see this app's design doc §2) --
 * doesn't exist in this worktree yet. Consolidating this into that
 * component once it lands is a mechanical follow-up, not a rewrite of any
 * screen that uses it.
 *
 * Exported (rather than kept module-private) so `SearchScreen.tsx`,
 * `WorkDetailScreen.tsx`, `MusicDetailScreen.tsx`, and `PlaylistsScreen.tsx`
 * -- every other screen in this same task's scope that also renders poster
 * artwork -- import this one implementation instead of each growing its own
 * copy. Sharing it this way, by exporting from a sibling file this task
 * already owns, stays inside this task's own constraint against creating
 * new files beyond the ones explicitly scoped to it.
 */
export function useAccessToken(client: ApiClient): string | undefined {
  const [token, setToken] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    client
      .getAccessToken()
      .then((resolved) => {
        if (!cancelled) setToken(resolved);
      })
      .catch(() => {
        if (!cancelled) setToken(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  return token;
}

export interface LibraryScreenNavigation {
  navigate: (route: RouteName, params?: Record<string, unknown>) => void;
}

export interface LibraryScreenProps {
  /** Which of Movies/Series/Sites/Music this instance browses -- set by the navigator's screen registration, not a route param (design doc §7). */
  kind: LibraryKind;
  navigation: LibraryScreenNavigation;
}

/** Exported for the same reason as `useAccessToken` above -- `SearchScreen`/`WorkDetailScreen`/`PlaylistsScreen` all lay out poster grids/rails at this exact size, and a shared constant is what keeps a "similar titles" rail's cards the same size as this screen's own grid. */
export const POSTER_WIDTH = sw(220);
export const POSTER_HEIGHT = sh(330);

/**
 * One focusable work poster -- artwork (or a title-text fallback, per
 * `CAPABILITIES.artworkRequestHeaders`/assumption A4) plus a title caption
 * underneath, in the plain `onFocus`/`onBlur`-driven ring style design doc
 * §4.4 specifies for every custom focusable that isn't a bare `<Button>`/
 * `<TouchableOpacity>`. Exported for the same reason as `useAccessToken`
 * above.
 */
export function PosterCard({
  work,
  baseUrl,
  accessToken,
  onSelect,
  autoFocus,
}: {
  work: Work;
  baseUrl: string;
  accessToken: string | undefined;
  onSelect: (work: Work) => void;
  autoFocus: boolean;
}): JSX.Element {
  const [focused, setFocused] = useState(false);
  const artworkKind = preferredArtworkKind(work, ['poster', 'thumb']);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${work.title}`}
      hasTVPreferredFocus={autoFocus}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={() => onSelect(work)}
      style={{
        width: POSTER_WIDTH,
        marginRight: sw(20),
        marginBottom: sh(28),
      }}
    >
      <View
        style={{
          width: POSTER_WIDTH,
          height: POSTER_HEIGHT,
          borderRadius: 10,
          overflow: 'hidden',
          backgroundColor: colour.surface,
          borderWidth: focused ? 3 : 0,
          borderColor: colour.focusRing,
        }}
      >
        {artworkKind && CAPABILITIES.artworkRequestHeaders ? (
          <Image
            source={{
              uri: workArtworkUrl(baseUrl, work.id, artworkKind),
              headers: artworkAuthHeaders(accessToken),
            }}
            style={{width: '100%', height: '100%'}}
            resizeMode="cover"
          />
        ) : (
          <View style={{flex: 1, alignItems: 'center', justifyContent: 'center', padding: sw(12)}}>
            <Text style={[text.caption, {color: colour.inkMuted, textAlign: 'center'}]} numberOfLines={4}>
              {work.title}
            </Text>
          </View>
        )}
      </View>
      <Text style={[text.body, {color: focused ? colour.ink : colour.inkSoft, marginTop: sh(8)}]} numberOfLines={1}>
        {work.title}
      </Text>
    </Pressable>
  );
}

/** Card and grid measurements of each view and size, from the web layout (`.tv-library-grid-panel`). */
interface GridLayout {
  cols: number;
  cardW: number;
  cardH: number;
  colPitch: number;
  rowPitch: number;
  /** Poster-first artwork (cover view) or backdrop-first (screen view). */
  posters: boolean;
}
const SCREEN_LAYOUTS: Record<ArtworkSize, GridLayout> = {
  small: {cols: 4, cardW: 238.9, cardH: 134.4, colPitch: 264.8, rowPitch: 190.8, posters: false},
  medium: {cols: 3, cardW: 327.2, cardH: 184, colPitch: 353.05, rowPitch: 240.4, posters: false},
  large: {cols: 2, cardW: 503.7, cardH: 283.3, colPitch: 529.6, rowPitch: 339.7, posters: false},
};
const COVER_LAYOUTS: Record<ArtworkSize, GridLayout> = {
  small: {cols: 6, cardW: 156.2, cardH: 234.3, colPitch: 175.4, rowPitch: 296.1, posters: true},
  medium: {cols: 5, cardW: 191.3, cardH: 287, colPitch: 210.5, rowPitch: 348.8, posters: true},
  large: {cols: 4, cardW: 244, cardH: 365.9, colPitch: 263.1, rowPitch: 427.7, posters: true},
};
const LIST_ROW_PITCH = 121.9;
const LIST_ART_W = 172.8;
const LIST_ART_H = 97.2;
const GRID_X = 783.4;
const GRID_Y = 162;
/** The grid scrolls under the page header: clipped below it, with the web's edge fades. */
const GRID_CLIP_TOP = 150;
const PAGE_SIZE = 200;
const CARD_W = 327.2;
const CARD_H = 184;
const ALPHABET = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'] as const;

export function letterOf(title: string): string {
  const first = title
    .trim()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .charAt(0)
    .toUpperCase();
  return first >= 'A' && first <= 'Z' ? first : '#';
}

const COLLATOR: {compare: (a: string, b: string) => number} | null =
  typeof Intl !== 'undefined' && typeof Intl.Collator === 'function' ? new Intl.Collator(undefined, {numeric: true, sensitivity: 'base'}) : null;

/** The web's title order: case-insensitive with digit runs compared as numbers ("9" before "10"). */
export function compareTitles(a: string, b: string): number {
  if (COLLATOR) return COLLATOR.compare(a, b);
  const chunk = /(\d+)|(\D+)/g;
  const left = a.toLowerCase().match(chunk) ?? [];
  const right = b.toLowerCase().match(chunk) ?? [];
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const x = left[index]!;
    const y = right[index]!;
    if (x === y) continue;
    const numeric = /^\d/.test(x) && /^\d/.test(y);
    if (numeric) return Number(x) - Number(y) || x.length - y.length;
    return x < y ? -1 : 1;
  }
  return left.length - right.length;
}

export function orderWorksByTitle(items: readonly Work[]): Work[] {
  return [...items].sort((a, b) => compareTitles(a.sort_title || a.title, b.sort_title || b.title));
}

function workLetter(work: Work): string {
  return letterOf(work.sort_title || work.title);
}

export function LibraryScreen({kind, navigation}: LibraryScreenProps): JSX.Element {
  const client = useApiClient();
  const accessToken = useAccessToken(client);
  const baseUrl = client.resolveUrl('/');
  const {colour, scheme} = useTheme();
  const {t, language} = useLanguage();
  const [items, setItems] = useState<Work[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  const [progressRows, setProgressRows] = useState<WatchProgress[] | null>(null);
  const [look, setLook] = useState(() => storedLibraryView(kind));
  const [audioLangs, setAudioLangs] = useState<string[]>([]);
  const [subtitleLangs, setSubtitleLangs] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [drawerFocused, setDrawerFocused] = useState(false);
  const [facets, setFacets] = useState<LanguageFacets | null>(null);
  const loadingMore = useRef(false);
  const scrollY = useRef(new Animated.Value(0)).current;
  const detailRoute = kind === 'artist' ? ROUTES.musicDetail : ROUTES.workDetail;
  const label = KIND_LABEL[kind];
  const noun = kind === 'movie' ? 'titles' : kind === 'series' ? 'titles' : kind === 'artist' ? 'artists' : 'titles';
  const listView = look.view === 'list';
  const layout = look.view === 'cover' ? COVER_LAYOUTS[look.size] : SCREEN_LAYOUTS[look.size];
  const cols = listView ? 1 : layout.cols;
  const rowPitch = listView ? LIST_ROW_PITCH : layout.rowPitch;
  const query = useMemo(
    () => ({kind, available_only: true, sort: look.sort, order: look.order, audio_lang: audioLangs.join(',') || undefined, subtitle_lang: subtitleLangs.join(',') || undefined}),
    [kind, look.sort, look.order, audioLangs, subtitleLangs],
  );
  const arrange = useCallback((page: readonly Work[]): Work[] => (look.sort === 'title' && look.order === 'asc' ? orderWorksByTitle(page) : [...page]), [look.sort, look.order]);

  useTvBackNavigation();

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setFailed(false);
    setFocusIndex(0);
    client
      .browseCatalog({...query, limit: PAGE_SIZE, offset: 0})
      .then((page) => {
        if (cancelled) return;
        setItems(arrange(page.items as Work[]));
        setTotal(page.total ?? page.items.length);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [client, query, arrange]);

  useEffect(() => {
    let cancelled = false;
    client
      .listWatchProgress()
      .then((rows) => {
        if (!cancelled) setProgressRows(rows);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [client, kind]);

  // The language facets follow the other active filters; they are only needed while the drawer is open.
  useEffect(() => {
    if (!filtersOpen) return undefined;
    let cancelled = false;
    client
      .catalogLanguages({kind, available_only: true, audio_lang: audioLangs.join(',') || undefined, subtitle_lang: subtitleLangs.join(',') || undefined})
      .then((next) => {
        if (!cancelled) setFacets(next);
      })
      .catch(() => {
        if (!cancelled) setFacets(null);
      });
    return () => {
      cancelled = true;
    };
  }, [client, filtersOpen, kind, audioLangs, subtitleLangs]);

  const progressByWork = useMemo(() => indexWatchProgressByWork(progressRows ?? []), [progressRows]);

  const loadMore = useCallback(() => {
    if (loadingMore.current || items === null || total === null || items.length >= total) return;
    loadingMore.current = true;
    client
      .browseCatalog({...query, limit: PAGE_SIZE, offset: items.length})
      .then((page) => setItems((current) => [...(current ?? []), ...arrange(page.items as Work[])]))
      .catch(() => undefined)
      .finally(() => {
        loadingMore.current = false;
      });
  }, [client, items, query, total, arrange]);

  const selected = items?.[focusIndex] ?? items?.[0];
  const row = Math.floor(focusIndex / cols);
  useEffect(() => {
    // Keep the focused row inside the panel: the web scrolls the grid so the row stays visible.
    const rowTop = GRID_Y + row * rowPitch;
    const target = Math.max(0, rowTop - 300);
    Animated.timing(scrollY, {toValue: -target, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true}).start();
    if (items && focusIndex > items.length - cols * 4) loadMore();
  }, [row, rowPitch, cols, focusIndex, items, loadMore, scrollY]);

  const dark = scheme === 'dark';
  const activeLetter = selected ? workLetter(selected) : null;
  const firstVisible = Math.max(0, (row - 2) * cols);
  const visible = items === null ? [] : items.slice(firstVisible, (row + (listView ? 8 : 5)) * cols);
  const locale = language === 'en' ? 'en-GB' : language;

  const update = (patch: Partial<{view: LibraryView; size: ArtworkSize; sort: LibrarySort; order: SortOrder}>): void => {
    rememberLibraryView(kind, patch);
    setLook((current) => ({...current, ...patch}));
  };
  const languageChips = (which: 'audio' | 'subs'): DrawerChip[] => {
    const selectedCodes = which === 'audio' ? audioLangs : subtitleLangs;
    const rows = ((which === 'audio' ? facets?.audio : facets?.subtitle) ?? []).map((facet) => ({code: facet.code, name: languageDisplayName(facet.code, locale, facet.name), count: facet.count as number | null}));
    for (const code of selectedCodes) if (!rows.some((entry) => entry.code === code)) rows.push({code, name: languageDisplayName(code, locale), count: null});
    return rows.map((entry) => ({
      key: entry.code,
      label: entry.count === null ? entry.name : `${entry.name} \u00b7 ${entry.count}`,
      selected: selectedCodes.includes(entry.code),
      onPress: () => (which === 'audio' ? setAudioLangs(toggleLanguage(audioLangs, entry.code)) : setSubtitleLangs(toggleLanguage(subtitleLangs, entry.code))),
    }));
  };
  const drawerSections = (): DrawerSection[] => {
    const views: LibraryView[] = kind === 'artist' ? ['list', 'screen', 'cover'] : ['list', 'screen', 'cover'];
    const viewKey = {list: 'pages.library.viewList', screen: 'pages.library.viewScreen', cover: 'pages.library.viewCover', 'cover-flow': 'pages.library.viewCoverFlow'} as const;
    const sizeKey = {small: 'pages.library.sizeSmall', medium: 'pages.library.sizeMedium', large: 'pages.library.sizeLarge'} as const;
    const out: DrawerSection[] = [
      {key: 'view', label: t('pages.library.view'), columns: 2, chips: views.map((value) => ({key: value, label: t(viewKey[value]), selected: look.view === value, icon: value as 'list' | 'screen' | 'cover', onPress: () => update({view: value})}))},
      {key: 'size', label: t('pages.library.artworkSize'), columns: 3, chips: (['small', 'medium', 'large'] as ArtworkSize[]).map((value) => ({key: value, label: t(sizeKey[value]), selected: look.size === value, onPress: () => update({size: value})}))},
      {
        key: 'sort',
        label: t('pages.library.sortBy'),
        columns: 2,
        chips: [
          {key: 'title', label: t('pages.library.sortTitle'), selected: look.sort === 'title', onPress: () => update({sort: 'title'})},
          {key: 'date_added', label: t('pages.library.sortDateAdded'), selected: look.sort === 'date_added', onPress: () => update({sort: 'date_added'})},
        ],
      },
      {
        key: 'order',
        label: t('pages.library.order'),
        columns: 2,
        chips: [
          {key: 'asc', label: look.sort === 'title' ? t('pages.library.sortAscAlpha') : t('pages.library.sortAscDate'), selected: look.order === 'asc', onPress: () => update({order: 'asc'})},
          {key: 'desc', label: look.sort === 'title' ? t('pages.library.sortDescAlpha') : t('pages.library.sortDescDate'), selected: look.order === 'desc', onPress: () => update({order: 'desc'})},
        ],
      },
    ];
    for (const which of ['audio', 'subs'] as const) {
      const chips = languageChips(which);
      if (chips.length > 0) out.push({key: which, label: which === 'audio' ? t('pages.library.audioLanguage') : t('pages.library.subtitleLanguage'), columns: 3, chips});
    }
    return out;
  };

  return (
    <Stage artUri={stageArtUrl(baseUrl, selected)} accessToken={accessToken}>
      <PageHeader title={label} detail={items === null ? undefined : `${(total ?? items.length).toLocaleString('en-GB')} ${noun}`} onBack={() => navigation.navigate(ROUTES.home)} />
      {selected ? (
        <Preview
          kicker={selected.genres[0]}
          title={selected.title}
          meta={[releaseYearOf(selected), selected.genres.join(' \u00b7 ')].filter((run): run is string => Boolean(run))}
          overview={selected.overview}
        />
      ) : null}
      <RailFrost dark={dark} soft={colour.surfaceSoft} strong={colour.surfaceStrong} />
      <ActionTile icon="filters" label={t('pages.library.filters')} active={filtersOpen} focusable={!drawerFocused} onPress={() => setFiltersOpen(!filtersOpen)} />
      {failed ? (
        <Box x={783} y={200} w={600}>
          <T size={17} weight={610} color={colour.ink}>
            {t('pages.library.errorTitle', {plural: label.toLowerCase()})}
          </T>
        </Box>
      ) : null}
      <Box x={GRID_X - 24} y={GRID_CLIP_TOP} w={1920 - GRID_X + 24} h={1080 - GRID_CLIP_TOP} style={{overflow: 'hidden'}} pointerEvents="box-none">
        <Animated.View style={{position: 'absolute', left: u(-(GRID_X - 24)), top: u(-GRID_CLIP_TOP), width: u(1920), transform: [{translateY: scrollY}]}} pointerEvents="box-none">
          {visible.map((work, offset) => {
            const index = firstVisible + offset;
            const col = index % cols;
            const rowIndex = Math.floor(index / cols);
            const common = {
              work,
              y: GRID_Y + rowIndex * rowPitch,
              baseUrl,
              token: accessToken,
              selected: index === focusIndex,
              first: index === 0,
              progress: progressByWork.get(work.id),
              progressReady: progressRows !== null,
              onFocus: () => setFocusIndex(index),
              onPress: () => navigation.navigate(detailRoute, {workId: work.id}),
            };
            return listView ? (
              <ListRow key={work.id} {...common} />
            ) : (
              <LibraryCard key={work.id} {...common} x={GRID_X + col * layout.colPitch} card={layout} />
            );
          })}
        </Animated.View>
      </Box>
      <EdgeFade side="top" active={row > 0} x={GRID_X - 24} y={GRID_CLIP_TOP} w={1920 - GRID_X + 24} h={1080 - GRID_CLIP_TOP} />
      <EdgeFade
        side="bottom"
        active={items !== null && Math.ceil((total ?? items.length) / cols) > row + (listView ? 7 : 4)}
        x={GRID_X - 24}
        y={GRID_CLIP_TOP}
        w={1920 - GRID_X + 24}
        h={1080 - GRID_CLIP_TOP}
      />
      {look.sort === 'title' ? <Alphabet active={activeLetter} onJump={(letter) => jumpTo(letter)} /> : null}
      {filtersOpen ? (
        <FilterDrawer
          kicker={t('pages.library.libraryControls')}
          title={t('pages.library.filters')}
          closeLabel={t('pages.library.closeFilters')}
          onClose={() => {
            setFiltersOpen(false);
            setDrawerFocused(false);
          }}
          onFocused={() => setDrawerFocused(true)}
          sections={drawerSections()}
          footerHeight={audioLangs.length + subtitleLangs.length > 0 ? 90 : 0}
          footer={
            audioLangs.length + subtitleLangs.length > 0
              ? (end) => (
                  <View style={{position: 'absolute', left: u(46), top: u(end + 26)}}>
                    <Button
                      label={t('pages.library.clearLanguages')}
                      variant="secondary"
                      onPress={() => {
                        setAudioLangs([]);
                        setSubtitleLangs([]);
                      }}
                    />
                  </View>
                )
              : undefined
          }
        />
      ) : null}
    </Stage>
  );

  function jumpTo(letter: string): void {
    if (!items) return;
    const index = items.findIndex((work) => workLetter(work) === letter);
    if (index >= 0) setFocusIndex(index);
  }
}

/** The year the web's library shows beside a title: the year it was added to the library, as `Library.tsx` does. */
function releaseYearOf(work: Pick<Work, 'added_at'>): string | undefined {
  const year = new Date(work.added_at).getFullYear();
  return Number.isNaN(year) ? undefined : String(year);
}

interface CardProps {
  work: Work;
  y: number;
  baseUrl: string;
  token: string | undefined;
  selected: boolean;
  first: boolean;
  progress: WatchProgress | undefined;
  progressReady: boolean;
  onFocus: () => void;
  onPress: () => void;
}

function LibraryCard(props: CardProps & {x: number; card: GridLayout}): React.ReactElement {
  const {work, x, y, card, baseUrl, token, selected, first, progress, progressReady, onFocus, onPress} = props;
  const {colour} = useTheme();
  const kinds: readonly ('backdrop' | 'poster')[] = card.posters ? ['poster', 'backdrop'] : ['backdrop', 'poster'];
  const artKind = preferredArtworkKind(work, kinds);
  const uri = artKind ? workArtworkUrl(baseUrl, work.id, artKind) : undefined;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={work.title}
      hasTVPreferredFocus={first}
      onFocus={onFocus}
      onPress={onPress}
      style={{position: 'absolute', left: u(x), top: u(y), width: u(card.cardW)}}
    >
      <MediaFocus variant="library" focused={selected} width={card.cardW} height={card.cardH} radius={12.48}>
        <View style={{width: '100%', height: '100%', backgroundColor: colour.surfaceSoft}}>
          <ArtworkImage uri={uri} accessToken={token} style={{width: '100%', height: '100%'}} resizeMode="cover" />
          <WatchState progress={progress} showUnwatched={progressReady} />
        </View>
      </MediaFocus>
      <View style={{marginTop: u(11.5), paddingHorizontal: u(1.9)}}>
        <T size={11.904} weight={610} ls={-0.1786} lh={17.9} color={colour.ink} lines={1}>
          {work.title}
        </T>
      </View>
    </Pressable>
  );
}

/** List view: a 172.8 x 97.2 thumbnail with the title and its genres and year beside it; the focused row is highlighted. */
function ListRow(props: CardProps): React.ReactElement {
  const {work, y, baseUrl, token, selected, first, progress, progressReady, onFocus, onPress} = props;
  const {colour} = useTheme();
  const artKind = preferredArtworkKind(work, ['backdrop', 'poster']);
  const uri = artKind ? workArtworkUrl(baseUrl, work.id, artKind) : undefined;
  const meta = [work.genres.slice(0, 2).join(' \u00b7 '), releaseYearOf(work)].filter((run): run is string => Boolean(run));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={work.title}
      hasTVPreferredFocus={first}
      onFocus={onFocus}
      onPress={onPress}
      style={{position: 'absolute', left: u(GRID_X + 4), top: u(y + 0.9), width: u(1034), height: u(LIST_ROW_PITCH - 3), borderRadius: u(16), backgroundColor: selected ? mix(colour.surfaceSoft, 0.55) : 'transparent'}}
    >
      <View style={{position: 'absolute', left: u(5), top: u(8)}}>
        <MediaFocus variant="library" focused={selected} width={LIST_ART_W} height={LIST_ART_H} radius={12.48}>
          <View style={{width: '100%', height: '100%', backgroundColor: colour.surfaceSoft}}>
            <ArtworkImage uri={uri} accessToken={token} style={{width: '100%', height: '100%'}} resizeMode="cover" />
            <WatchState progress={progress} showUnwatched={progressReady} />
          </View>
        </MediaFocus>
      </View>
      <View style={{position: 'absolute', left: u(212), top: u(32), width: u(813)}}>
        <T size={14.976} weight={610} ls={-0.22464} lh={22.5} color={colour.ink} lines={1}>
          {work.title}
        </T>
      </View>
      <View style={{position: 'absolute', left: u(212), top: u(67)}}>
        <T size={9.6} weight={400} lh={14.4} color={colour.inkMuted} lines={1}>
          {meta.join('   \u2022   ')}
        </T>
      </View>
    </Pressable>
  );
}

function Alphabet({active, onJump}: {active: string | null; onJump: (letter: string) => void}): React.ReactElement {
  const {colour} = useTheme();
  return (
    <>
      {ALPHABET.map((letter, index) => {
        const on = letter === active;
        return (
          <Pressable
            key={letter}
            accessibilityRole="button"
            accessibilityLabel={letter}
            onPress={() => onJump(letter)}
            style={{
              position: 'absolute',
              left: u(1864.5),
              top: u(269.8 + index * 25.62),
              width: u(24),
              height: u(24),
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {on ? <View style={{position: 'absolute', width: u(18.2), height: u(18.2), borderRadius: 999, backgroundColor: mix(colour.ink, 0.78)}} /> : null}
            <T size={9.216} weight={400} color={on ? colour.bg : colour.inkMuted} lh={11}>
              {letter}
            </T>
          </Pressable>
        );
      })}
    </>
  );
}
