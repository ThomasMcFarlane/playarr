/**
 * Search, drawn at the web TV layout's measurements (`clients/tv-web/web/src/pages/Search.tsx`): the search pill, the
 * focused result's key art and details on the left, and a three-column grid of results on the right.
 *
 * Not on this platform yet: the type and library filter drawer and playlist results (see the board row).
 */
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Animated, Easing, Pressable, TextInput, View} from 'react-native';
import type {WatchProgress, Work} from '@playarr-tv/api-client';
import {useAsyncData} from '@playarr-tv/api-client/react';
import {useApiClient} from '../api/ApiClientProvider';
import {preferredArtworkKind, workArtworkUrl} from '../api/artworkUrl';
import {ArtworkImage} from '../components/ArtworkImage';
import {useLanguage} from '../i18n/LanguageProvider';
import {ROUTES, type RouteName} from '../navigation/routes';
import {Icon} from '../shell/icons';
import {blend, mix} from '../theme/color';
import {sans} from '../theme/fonts';
import {useTheme} from '../theme/ThemeProvider';
import {EdgeFade} from '../tv/EdgeFade';
import {BalancedT, Box, T, u} from '../tv/kit';
import {MediaFocus} from '../tv/mediaFocus';
import {PageHeader} from '../tv/PageHeader';
import {RailFrost, Stage} from '../tv/Stage';
import {indexWatchProgressByWork, WatchState} from '../tv/WatchState';
import {useAccessToken} from './LibraryScreen';

/** Matches the web's `SEARCH_LIMIT`: one results screen, no pagination. */
const SEARCH_LIMIT = 60;
/** How long to wait after the last keystroke before searching. */
const DEBOUNCE_MS = 350;

const COLUMNS = 3;
const GRID_X = 825.6;
const GRID_Y = 172.8;
// The web's bigger search cards: 327.2 x 184 art, 353.1 px apart across and 251.2 px down.
const COL_PITCH = 353.1;
const ROW_PITCH = 251.2;
const ART_W = 327.2;
const ART_H = 184;
const GRID_CLIP_TOP = 150;

export interface SearchScreenNavigation {
  navigate: (route: RouteName, params?: Record<string, unknown>) => void;
}

export interface SearchScreenProps {
  navigation: SearchScreenNavigation;
}

export function SearchScreen({navigation}: SearchScreenProps): React.ReactElement {
  const client = useApiClient();
  const token = useAccessToken(client);
  const baseUrl = client.resolveUrl('/');
  const {t} = useLanguage();
  const {colour, scheme} = useTheme();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [focusIndex, setFocusIndex] = useState(0);
  const [inputFocused, setInputFocused] = useState(false);
  const [cardFocused, setCardFocused] = useState(false);
  const scrollY = useRef(new Animated.Value(u(-GRID_CLIP_TOP))).current;

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const state = useAsyncData(() => client.searchCatalog(debounced, SEARCH_LIMIT), [client, debounced], {
    enabled: debounced.length > 0,
    isEmpty: (results) => results.length === 0,
  });
  const progress = useAsyncData(() => client.listWatchProgress(), [client]);
  const progressByWork = useMemo(() => indexWatchProgressByWork(progress.status === 'ready' ? progress.data : []), [progress]);
  const results: Work[] = state.status === 'ready' ? state.data : [];
  const selected = results[Math.min(focusIndex, Math.max(0, results.length - 1))];
  const row = Math.floor(focusIndex / COLUMNS);

  useEffect(() => {
    setFocusIndex(0);
  }, [debounced]);

  useEffect(() => {
    const target = Math.max(0, row * ROW_PITCH - 120);
    Animated.timing(scrollY, {toValue: u(-GRID_CLIP_TOP) - u(target), duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: false}).start();
  }, [row, scrollY]);

  const kindLabel = (work: Work): string =>
    work.kind === 'series' ? t('pages.search.kindSeries') : work.kind === 'artist' ? t('pages.search.kindArtist') : work.kind === 'site' ? t('pages.search.kindSite') : t('pages.search.kindMovie');
  const year = (work: Work): string | null => (work.release_date ? String(new Date(work.release_date).getUTCFullYear()) : null);
  const open = (work: Work): void => navigation.navigate(work.kind === 'artist' ? ROUTES.musicDetail : ROUTES.workDetail, {workId: work.id, backTo: ROUTES.search});

  const detail =
    state.status === 'ready' ? (results.length === 1 ? t('pages.search.resultCountOne', {count: 1}) : t('pages.search.resultCountOther', {count: results.length})) : state.status === 'empty' ? t('pages.search.zeroResults') : undefined;
  const artKind = selected ? preferredArtworkKind(selected, ['backdrop', 'poster']) : undefined;
  const dark = scheme === 'dark';
  // The web details panel's --dp-soft: ink 88% over the surface.
  const soft = blend(colour.ink, colour.surface, 0.88);
  const visibleFrom = Math.max(0, (row - 1) * COLUMNS);
  const visibleTo = (row + 4) * COLUMNS;

  return (
    <Stage artUri={selected && artKind ? workArtworkUrl(baseUrl, selected.id, artKind) : undefined} accessToken={token}>
      <PageHeader title={t('pages.search.title')} detail={detail} onBack={() => navigation.navigate(ROUTES.home)} />

      {/* The search pill. A focused TextInput opens the system keyboard at once, which is how this platform's own search behaves. */}
      <View
        style={{
          position: 'absolute',
          left: u(153.6),
          top: u(172.8),
          width: u(590),
          height: u(76),
          borderRadius: 999,
          // Focused: the web's control focus ring (ink, no fill change).
          borderWidth: inputFocused ? 2 : 1,
          borderColor: inputFocused ? colour.ink : mix(colour.lineStrong, 0.76),
          backgroundColor: mix(colour.surfaceStrong, 0.88),
          flexDirection: 'row',
          alignItems: 'center',
          paddingLeft: u(24),
        }}
      >
        <Icon name="search" size={u(24)} color={colour.inkMuted} strokeWidth={1.8} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          onFocus={() => {
            setInputFocused(true);
            setCardFocused(false);
          }}
          onBlur={() => setInputFocused(false)}
          placeholder={t('pages.search.searchPlaceholder')}
          placeholderTextColor={colour.inkMuted}
          returnKeyType="search"
          hasTVPreferredFocus
          accessibilityLabel={t('pages.search.ariaSearchPlayarr')}
          style={{flex: 1, marginLeft: u(13), padding: 0, height: u(60), color: colour.ink, fontSize: u(17.28), textAlignVertical: 'center', ...sans(400)}}
        />
        {query.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('pages.search.clear')}
            onPress={() => setQuery('')}
            style={{width: u(68.3), height: u(54.8), marginRight: u(8), borderRadius: 999, alignItems: 'center', justifyContent: 'center'}}
          >
            <T size={10.944} weight={740} color={colour.inkMuted}>
              {t('pages.search.clear')}
            </T>
          </Pressable>
        ) : null}
      </View>

      {selected ? (
        // The web's details panel at the search stage's size (eyebrow, 49.92 px title, meta, five-line synopsis).
        <Box x={153.6} y={286.6} w={552.6}>
          <T size={12.288} weight={860} ls={0.983} lh={18.4} color={dark ? '#eaa6b6' : '#821e36'} upper>
            {`${kindLabel(selected)}${year(selected) ? ` · ${year(selected)}` : ''}`}
          </T>
          <View style={{marginTop: u(25.9)}}>
            <BalancedT key={selected.id} width={419.2} size={49.92} weight={560} ls={-2.995} lh={47.4} color={colour.ink}>
              {selected.title}
            </BalancedT>
          </View>
          <View style={{marginTop: u(27), flexDirection: 'row'}}>
            {year(selected) ? (
              <View style={{marginRight: u(12.8)}}>
                <T size={13.056} weight={600} lh={19.6} color={soft}>
                  {year(selected)}
                </T>
              </View>
            ) : null}
            {selected.genres.length > 0 ? (
              <T size={13.056} weight={600} lh={19.6} color={soft}>
                {selected.genres.slice(0, 2).join(' · ')}
              </T>
            ) : null}
          </View>
          <View style={{marginTop: u(21.6), width: u(348.1)}}>
            <T size={13.824} weight={600} lh={21.84} color={soft} lines={5}>
              {selected.overview ?? t('pages.search.noSynopsis')}
            </T>
          </View>
        </Box>
      ) : null}

      <RailFrost dark={dark} soft={colour.surfaceSoft} strong={colour.surfaceStrong} />

      {debounced.length === 0 ? (
        <Box x={826} y={172} w={700}>
          <T size={17.664} weight={610} color={colour.ink}>
            {t('pages.search.idleTitle')}
          </T>
          <View style={{marginTop: u(6)}}>
            <T size={12} weight={400} color={colour.inkMuted}>
              {t('pages.search.emptyPrompt')}
            </T>
          </View>
        </Box>
      ) : state.status === 'error' ? (
        <Box x={1304} y={350} w={500}>
          <T size={17.664} weight={610} color={colour.accent}>
            {t('pages.search.errorTitle')}
          </T>
        </Box>
      ) : state.status === 'empty' ? (
        <Box x={826} y={172} w={700}>
          <T size={17.664} weight={610} color={colour.ink}>
            {t('pages.search.noResultsTitle')}
          </T>
          <View style={{marginTop: u(6)}}>
            <T size={12} weight={400} color={colour.inkMuted}>
              {t('pages.search.noResultsDescription')}
            </T>
          </View>
        </Box>
      ) : null}

      <Box x={GRID_X - 20} y={GRID_CLIP_TOP} w={1920 - GRID_X + 20} h={1080 - GRID_CLIP_TOP} style={{overflow: 'hidden'}} pointerEvents="box-none">
        <Animated.View style={{position: 'absolute', left: u(-(GRID_X - 20)), top: scrollY, width: u(1920)}} pointerEvents="box-none">
          {results.slice(visibleFrom, visibleTo).map((work, offset) => {
            const index = visibleFrom + offset;
            return (
              <ResultCard
                key={work.id}
                work={work}
                x={GRID_X + (index % COLUMNS) * COL_PITCH}
                y={GRID_Y + Math.floor(index / COLUMNS) * ROW_PITCH}
                baseUrl={baseUrl}
                token={token}
                label={`${kindLabel(work)}${year(work) ? ` · ${year(work)}` : ''}`}
                selected={cardFocused && index === focusIndex}
                progress={progressByWork.get(work.id)}
                progressReady={progress.status === 'ready'}
                onFocus={() => {
                  setFocusIndex(index);
                  setCardFocused(true);
                }}
                onPress={() => open(work)}
              />
            );
          })}
        </Animated.View>
      </Box>
      <EdgeFade side="top" active={row > 0} x={GRID_X - 20} y={GRID_CLIP_TOP} w={1920 - GRID_X + 20} h={1080 - GRID_CLIP_TOP} />
      <EdgeFade side="bottom" active={Math.ceil(results.length / COLUMNS) > row + 3} x={GRID_X - 20} y={GRID_CLIP_TOP} w={1920 - GRID_X + 20} h={1080 - GRID_CLIP_TOP} />
    </Stage>
  );
}

function ResultCard(props: {
  work: Work;
  x: number;
  y: number;
  baseUrl: string;
  token: string | undefined;
  label: string;
  selected: boolean;
  progress: WatchProgress | undefined;
  progressReady: boolean;
  onFocus: () => void;
  onPress: () => void;
}): React.ReactElement {
  const {colour} = useTheme();
  const {work} = props;
  const kind = preferredArtworkKind(work, ['backdrop', 'poster']);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={work.title}
      onFocus={props.onFocus}
      onPress={props.onPress}
      style={{position: 'absolute', left: u(props.x), top: u(props.y), width: u(ART_W)}}
    >
      <MediaFocus variant="search" focused={props.selected} width={ART_W} height={ART_H} radius={12.48}>
        <View style={{width: '100%', height: '100%', backgroundColor: colour.surfaceStrong}}>
          {kind ? <ArtworkImage uri={workArtworkUrl(props.baseUrl, work.id, kind)} accessToken={props.token} style={{width: '100%', height: '100%'}} resizeMode="cover" /> : null}
          <WatchState progress={props.progress} showUnwatched={props.progressReady} />
        </View>
      </MediaFocus>
      <View style={{marginTop: u(11.5), flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: u(1.9)}}>
        <View style={{width: u(259.5)}}>
          <T size={11.904} weight={610} ls={-0.179} lh={17.9} color={colour.ink} lines={1}>
            {work.title}
          </T>
        </View>
        <T size={8.448} weight={720} lh={12.7} color={colour.inkMuted} upper>
          {props.label}
        </T>
      </View>
    </Pressable>
  );
}
