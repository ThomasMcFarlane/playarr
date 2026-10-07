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
import {EdgeFade} from '../tv/EdgeFade';
import {MediaFocus} from '../tv/mediaFocus';
import {Box, T, u} from '../tv/kit';
import {PageHeader} from '../tv/PageHeader';
import {Preview} from '../tv/Preview';
import {RailFrost, Stage} from '../tv/Stage';
import {indexWatchProgressByWork, WatchState} from '../tv/WatchState';
import {cardArtUrl, stageArtUrl} from '../tv/ArtOfWork';
import {workYear} from './HomeScreen';
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

const GRID_COLUMNS = 3;
const CARD_W = 327.2;
const CARD_H = 184;
const COL_PITCH = 353.05;
const ROW_PITCH = 240.4;
const GRID_X = 783.4;
const GRID_Y = 162;
/** The grid scrolls under the page header: clipped below it, with the web's edge fades. */
const GRID_CLIP_TOP = 150;
const PAGE_SIZE = 200;
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
  const {t} = useLanguage();
  const [items, setItems] = useState<Work[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  const [progressRows, setProgressRows] = useState<WatchProgress[] | null>(null);
  const loadingMore = useRef(false);
  const scrollY = useRef(new Animated.Value(0)).current;
  const detailRoute = kind === 'artist' ? ROUTES.musicDetail : ROUTES.workDetail;
  const label = KIND_LABEL[kind];
  const noun = kind === 'movie' ? 'titles' : kind === 'series' ? 'titles' : kind === 'artist' ? 'artists' : 'titles';

  useTvBackNavigation();

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setFailed(false);
    client
      .browseCatalog({kind, available_only: true, sort: 'title', order: 'asc', limit: PAGE_SIZE, offset: 0})
      .then((page) => {
        if (cancelled) return;
        setItems(orderWorksByTitle(page.items as Work[]));
        setTotal(page.total ?? page.items.length);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
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

  const progressByWork = useMemo(() => indexWatchProgressByWork(progressRows ?? []), [progressRows]);

  const loadMore = useCallback(() => {
    if (loadingMore.current || items === null || total === null || items.length >= total) return;
    loadingMore.current = true;
    client
      .browseCatalog({kind, available_only: true, sort: 'title', order: 'asc', limit: PAGE_SIZE, offset: items.length})
      .then((page) => setItems((current) => [...(current ?? []), ...orderWorksByTitle(page.items as Work[])]))
      .catch(() => undefined)
      .finally(() => {
        loadingMore.current = false;
      });
  }, [client, items, kind, total]);

  const selected = items?.[focusIndex] ?? items?.[0];
  const row = Math.floor(focusIndex / GRID_COLUMNS);
  useEffect(() => {
    // Keep the focused row inside the panel: the web scrolls the grid so the row stays visible.
    const rowTop = GRID_Y + row * ROW_PITCH;
    const target = Math.max(0, rowTop - 300);
    Animated.timing(scrollY, {toValue: -target, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true}).start();
    if (items && focusIndex > items.length - GRID_COLUMNS * 4) loadMore();
  }, [row, focusIndex, items, loadMore, scrollY]);

  const dark = scheme === 'dark';
  const activeLetter = selected ? workLetter(selected) : null;
  const visible = items === null ? [] : items.slice(Math.max(0, (row - 2) * GRID_COLUMNS), (row + 5) * GRID_COLUMNS);
  const firstVisible = Math.max(0, (row - 2) * GRID_COLUMNS);

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
      <Filters />
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
            const col = index % GRID_COLUMNS;
            const rowIndex = Math.floor(index / GRID_COLUMNS);
            return (
              <LibraryCard
                key={work.id}
                work={work}
                x={GRID_X + col * COL_PITCH}
                y={GRID_Y + rowIndex * ROW_PITCH}
                baseUrl={baseUrl}
                token={accessToken}
                selected={index === focusIndex}
                first={index === 0}
                progress={progressByWork.get(work.id)}
                progressReady={progressRows !== null}
                onFocus={() => setFocusIndex(index)}
                onPress={() => navigation.navigate(detailRoute, {workId: work.id})}
              />
            );
          })}
        </Animated.View>
      </Box>
      <EdgeFade side="top" active={row > 0} x={GRID_X - 24} y={GRID_CLIP_TOP} w={1920 - GRID_X + 24} h={1080 - GRID_CLIP_TOP} />
      <EdgeFade
        side="bottom"
        active={items !== null && Math.ceil((total ?? items.length) / GRID_COLUMNS) > row + 4}
        x={GRID_X - 24}
        y={GRID_CLIP_TOP}
        w={1920 - GRID_X + 24}
        h={1080 - GRID_CLIP_TOP}
      />
      <Alphabet active={activeLetter} onJump={(letter) => jumpTo(letter)} />
    </Stage>
  );

  function jumpTo(letter: string): void {
    if (!items) return;
    const index = items.findIndex((work) => workLetter(work) === letter);
    if (index >= 0) setFocusIndex(index);
  }
}

function releaseYearOf(work: Pick<Work, 'release_date'>): string | undefined {
  const year = workYear(work);
  return year === null ? undefined : String(year);
}

function Filters(): React.ReactElement {
  const {t} = useLanguage();
  return <ActionTile icon="filters" label={t('pages.library.filters')} />;
}

function LibraryCard(props: {
  work: Work;
  x: number;
  y: number;
  baseUrl: string;
  token: string | undefined;
  selected: boolean;
  first: boolean;
  progress: WatchProgress | undefined;
  progressReady: boolean;
  onFocus: () => void;
  onPress: () => void;
}): React.ReactElement {
  const {work, x, y, baseUrl, token, selected, first, progress, progressReady, onFocus, onPress} = props;
  const {colour} = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={work.title}
      hasTVPreferredFocus={first}
      onFocus={onFocus}
      onPress={onPress}
      style={{position: 'absolute', left: u(x), top: u(y), width: u(CARD_W)}}
    >
      <MediaFocus variant="library" focused={selected} width={CARD_W} height={CARD_H} radius={12.48}>
        <View style={{width: '100%', height: '100%', backgroundColor: colour.surfaceSoft}}>
          <ArtworkImage uri={cardArtUrl(baseUrl, work)} accessToken={token} style={{width: '100%', height: '100%'}} resizeMode="cover" />
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
