/**
 * Home, drawn at the web TV layout's measurements (`clients/tv-web/web/src/pages/Home.tsx`): the stage with the focused
 * title's key art, the title panel on the left, the Customise Home button, and the vertical stack of rails on the right
 * (the merged "Start watching" rail first, then the server's rails, then the sites rails).
 */
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Animated, Easing, Pressable, View} from 'react-native';
import {useNavigation, type NavigationProp, type ParamListBase} from '@amazon-devices/react-navigation__native';
import type {ResumePlan, WatchProgress, Work} from '@playarr-tv/api-client';
import {useCatalogBrowse, useHomeRails} from '@playarr-tv/api-client/react';
import {useApiClient} from '../api/ApiClientProvider';
import {mediaThumbnailUrl, preferredArtworkKind, workArtworkUrl} from '../api/artworkUrl';
import {ArtworkImage} from '../components/ArtworkImage';
import {useLanguage} from '../i18n/LanguageProvider';
import {useTvBackNavigation} from '../navigation/backPolicy';
import {ROUTES} from '../navigation/routes';
import {useTheme} from '../theme/ThemeProvider';
import {loadOnDeck, type OnDeckEntry} from '../lib/onDeck';
import {Box, T, u} from '../tv/kit';
import {indexWatchProgressByWork, WatchState} from '../tv/WatchState';
import {RailFrost, Stage} from '../tv/Stage';
import {useAccessToken} from './LibraryScreen';

interface HomeRail {
  id: string;
  title: string;
  items: Work[];
}

const RAIL_PITCH = 317.9;
const FIRST_HEADING_Y = 426.1;
const CARD_PITCH = 243.9;
const CARD_W = 218.9;
const RAIL_X = 881.6;

function mergeRecent(...groups: Work[][]): Work[] {
  return groups.flat().sort((a, b) => new Date(b.added_at).getTime() - new Date(a.added_at).getTime());
}

export function workYear(work: Pick<Work, 'release_date'>): number | null {
  if (!work.release_date) return null;
  const year = new Date(work.release_date).getUTCFullYear();
  return Number.isFinite(year) && year > 0 ? year : null;
}

export function labelWithYear(label: string, work: Pick<Work, 'release_date'>): string {
  const year = workYear(work);
  return year === null ? label : `${label} · ${year}`;
}

export function workKindLabel(work: Pick<Work, 'kind'>, t: ReturnType<typeof useLanguage>['t']): string {
  switch (work.kind) {
    case 'site':
      return t('pages.home.workKind.site');
    case 'series':
      return t('pages.home.workKind.series');
    case 'artist':
      return t('pages.home.workKind.artist');
    default:
      return t('pages.home.workKind.movie');
  }
}

const EMPTY: Work[] = [];

/** Longest Home holds its first render for the On Deck detail calls (the web's `ON_DECK_WAIT_MS`). */
const ON_DECK_WAIT_MS = 2500;

export function HomeScreen(): React.ReactElement {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const client = useApiClient();
  const token = useAccessToken(client);
  const baseUrl = client.resolveUrl('/');
  const {t, language} = useLanguage();
  const {colour, scheme} = useTheme();
  useTvBackNavigation();

  const railsState = useHomeRails(client, {lang: language});
  const siteState = useCatalogBrowse(client, {kind: 'site', available_only: true, sort: 'recent', limit: 36});
  const serverRails = railsState.status === 'ready' ? railsState.data.rails : [];
  const siteItems = siteState.status === 'ready' ? siteState.data.items : EMPTY;

  const [onDeck, setOnDeck] = useState<OnDeckEntry[]>([]);
  const [onDeckSettled, setOnDeckSettled] = useState(false);
  const [progressRows, setProgressRows] = useState<WatchProgress[] | null>(null);
  const [stackedPlans, setStackedPlans] = useState<Map<string, ResumePlan>>(new Map());
  useEffect(() => {
    let cancelled = false;
    // Home waits for On Deck, but never longer than the web does; later results still apply in place.
    const giveUp = setTimeout(() => setOnDeckSettled(true), ON_DECK_WAIT_MS);
    loadOnDeck(client, {
      isActive: () => !cancelled,
      onProgress: setProgressRows,
      onStackedPlans: setStackedPlans,
      onEntries: (entries) => {
        setOnDeck(entries);
        setOnDeckSettled(true);
      },
    }).catch(() => {
      if (!cancelled) {
        setOnDeck([]);
        setProgressRows(null);
        setOnDeckSettled(true);
      }
    });
    return () => {
      cancelled = true;
      clearTimeout(giveUp);
    };
  }, [client]);
  const onDeckByWork = useMemo(() => new Map(onDeck.map((entry) => [entry.work.id, entry])), [onDeck]);
  const progressByWork = useMemo(() => indexWatchProgressByWork(progressRows ?? []), [progressRows]);

  const rails = useMemo<HomeRail[]>(() => {
    const used = new Set<string>();
    const takeUnused = (source: Work[], count: number): Work[] => {
      const taken: Work[] = [];
      for (const work of source) {
        if (used.has(work.id)) continue;
        used.add(work.id);
        taken.push(work);
        if (taken.length >= count) break;
      }
      return taken;
    };
    const all = mergeRecent(...serverRails.map((rail) => rail.items as Work[]), siteItems as Work[]);
    const onDeckItems = onDeck.map((entry) => entry.work);
    const definitions: HomeRail[] = [
      {
        id: 'primary',
        title: onDeckItems.length > 0 ? t('pages.home.rail.onDeck') : t('pages.home.rail.startWatching'),
        items: onDeckItems.length > 0 ? takeUnused(onDeckItems, 10) : takeUnused(all, 8),
      },
      ...serverRails.map((rail) => ({id: rail.id, title: rail.title, items: rail.items as Work[]})),
      {id: 'sites-new', title: t('pages.home.rail.newSites'), items: takeUnused(siteItems as Work[], 12)},
      {id: 'sites-more', title: t('pages.home.rail.moreSites'), items: takeUnused(siteItems as Work[], 12)},
    ];
    return definitions.filter((rail) => rail.items.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [railsState, siteState, onDeck, t]);

  const [focus, setFocus] = useState<{rail: number; item: number}>({rail: 0, item: 0});
  const selected = rails[focus.rail]?.items[focus.item] ?? rails[0]?.items[0];

  const railY = useRef(new Animated.Value(0)).current;
  const scrollX = useRef(rails.map(() => new Animated.Value(0))).current;
  useEffect(() => {
    Animated.timing(railY, {toValue: -focus.rail * RAIL_PITCH, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true}).start();
  }, [focus.rail, railY]);
  const scrollTargets = useRef<number[]>([]);
  function focusItem(rail: number, item: number): void {
    setFocus({rail, item});
    const visible = 1920 - RAIL_X;
    const left = item * CARD_PITCH;
    let target = scrollTargets.current[rail] ?? 0;
    if (left + CARD_W + 46 > target + visible) target = left + CARD_W + 46 - visible;
    if (left < target + 8) target = Math.max(0, left - 8);
    scrollTargets.current[rail] = target;
    while (scrollX.length <= rail) scrollX.push(new Animated.Value(0));
    Animated.timing(scrollX[rail], {toValue: -target, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true}).start();
  }

  const homeSettled =
    onDeckSettled && (railsState.status === 'ready' || railsState.status === 'empty' || railsState.status === 'error') && siteState.status !== 'idle' && siteState.status !== 'loading';
  if (!selected || !homeSettled) {
    return <Stage />;
  }
  const selectedOnDeck = focus.rail === 0 && rails[0]?.id === 'primary' ? onDeckByWork.get(selected.id) : undefined;
  const selectedEpisode = selectedOnDeck?.episode;
  const pad = (n: number): string => String(n).padStart(2, '0');
  const featureTitle =
    selectedEpisode?.detail.episode.title ??
    (selectedEpisode ? t('pages.home.episodeLabel', {number: selectedEpisode.detail.episode.episode_number}) : selected.title);
  const featureOverview = selectedEpisode?.detail.episode.overview ?? selected.overview ?? t('pages.home.noSynopsis');
  const kicker = selectedEpisode
    ? t('pages.home.episodeProvider', {title: selected.title, season: pad(selectedEpisode.seasonNumber), episode: pad(selectedEpisode.detail.episode.episode_number)})
    : t('pages.home.kindGenre', {kind: workKindLabel(selected, t), genre: selected.genres[0] ?? t('pages.home.defaultGenre')});

  const artKind = preferredArtworkKind(selected, ['backdrop', 'poster']);
  const artUri = artKind ? workArtworkUrl(baseUrl, selected.id, artKind) : undefined;
  const dark = scheme === 'dark';

  return (
    <Stage artUri={artUri} accessToken={token}>
      <Box x={153.6} y={259.2} w={455}>
        <T size={12.288} weight={820} ls={0.983} color="#cf3157" upper lh={18.4}>
          {kicker}
        </T>
        <View style={{marginTop: u(25.9), width: u(373.2)}}>
          <T size={69.12} weight={560} ls={-4.9766} lh={62.2} color={colour.ink}>
            {featureTitle}
          </T>
        </View>
        <View style={{marginTop: u(21.6), width: u(324)}}>
          <T size={12.864} weight={400} lh={20.3} color={colour.inkMuted} lines={5}>
            {featureOverview}
          </T>
        </View>
      </Box>

      <RailFrost dark={dark} soft={colour.surfaceSoft} strong={colour.surfaceStrong} />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('pages.home.customise.open')}
        onPress={() => navigation.navigate(ROUTES.homeCustomise)}
        style={{
          position: 'absolute',
          left: u(1750.1),
          top: u(32),
          width: u(121.9),
          height: u(38),
          borderRadius: 999,
          backgroundColor: colour.surface,
          borderWidth: 1,
          borderColor: colour.line,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <T size={11.52} weight={720} color={colour.inkSoft}>
          {t('pages.home.customise.open')}
        </T>
      </Pressable>

      <Box x={729.6} y={0} w={1190.4} h={1080} style={{overflow: 'hidden'}} pointerEvents="box-none">
        <Animated.View style={{transform: [{translateY: railY}]}} pointerEvents="box-none">
          {rails.map((rail, railIndex) => {
            const headingY = FIRST_HEADING_Y + railIndex * RAIL_PITCH;
            const active = railIndex === focus.rail;
            return (
              <View key={rail.id} pointerEvents="box-none">
                <View
                  style={{
                    position: 'absolute',
                    left: u(RAIL_X - 729.6),
                    top: u(headingY),
                    transform: active ? [{translateX: u(-6.2)}, {translateY: -1}, {scale: 1.16}, {translateX: u(6.2)}] : [],
                  }}
                >
                  <T size={17.664} weight={610} ls={-0.53} lh={26.5} color={colour.ink}>
                    {rail.title}
                  </T>
                </View>
                <Animated.View
                  style={{
                    position: 'absolute',
                    left: u(RAIL_X - 729.6),
                    top: u(headingY + 26.5 + 17.28 + 18),
                    flexDirection: 'row',
                    transform: [{translateX: scrollX[railIndex] ?? 0}],
                  }}
                >
                  {rail.items.map((work, itemIndex) => {
                    const entry = rail.id === 'primary' ? onDeckByWork.get(work.id) : undefined;
                    const episode = entry?.episode;
                    const progress = entry?.progress ?? progressByWork.get(work.id);
                    const cardTitle =
                      episode?.detail.episode.title ?? (episode ? t('pages.home.episodeLabel', {number: episode.detail.episode.episode_number}) : work.title);
                    const subtitle = episode
                      ? t('pages.home.episodeProvider', {title: work.title, season: pad(episode.seasonNumber), episode: pad(episode.detail.episode.episode_number)})
                      : labelWithYear(workKindLabel(work, t), work);
                    return (
                    <HomeCard
                      key={work.id}
                      work={work}
                      mediaFileId={episode?.detail.media_file_id ?? undefined}
                      title={cardTitle}
                      progress={progress}
                      progressReady={progressRows !== null}
                      first={railIndex === 0 && itemIndex === 0}
                      baseUrl={baseUrl}
                      token={token}
                      selected={active && itemIndex === focus.item}
                      onFocus={() => focusItem(railIndex, itemIndex)}
                      onPress={() => navigation.navigate(ROUTES.workDetail, {workId: work.id, backTo: ROUTES.home})}
                      subtitle={subtitle}
                    />
                    );
                  })}
                </Animated.View>
              </View>
            );
          })}
        </Animated.View>
      </Box>
    </Stage>
  );
}

function HomeCard(props: {
  work: Work;
  /** The on-deck episode's media file: the card shows a frame from it, as the web's thumbnail view does. */
  mediaFileId?: string;
  title: string;
  progress: WatchProgress | undefined;
  progressReady: boolean;
  first: boolean;
  baseUrl: string;
  token: string | undefined;
  selected: boolean;
  subtitle: string;
  onFocus: () => void;
  onPress: () => void;
}): React.ReactElement {
  const {work, mediaFileId, title, progress, progressReady, first, baseUrl, token, selected, subtitle, onFocus, onPress} = props;
  const {colour} = useTheme();
  const kind = preferredArtworkKind(work, ['backdrop', 'poster']);
  const uri = mediaFileId ? mediaThumbnailUrl(baseUrl, mediaFileId) : kind ? workArtworkUrl(baseUrl, work.id, kind) : undefined;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={work.title}
      hasTVPreferredFocus={first}
      onFocus={onFocus}
      onPress={onPress}
      style={{width: u(CARD_W), marginRight: u(CARD_PITCH - CARD_W), transform: [{translateY: selected ? u(-6) : 0}]}}
    >
      <View
        style={{
          width: u(CARD_W),
          height: u(123.13),
          borderRadius: u(12.48),
          overflow: 'hidden',
          backgroundColor: colour.surfaceSoft,
          transform: [{scale: selected ? 1.025 : 1}],
        }}
      >
        <ArtworkImage uri={uri} accessToken={token} style={{width: '100%', height: '100%'}} resizeMode="cover" />
        <WatchState progress={progress} showUnwatched={progressReady} />
      </View>
      <View style={{marginTop: u(9.9)}}>
        <T size={11.328} weight={630} color={colour.ink} lh={17} lines={1}>
          {title}
        </T>
      </View>
      <View style={{marginTop: u(2.6)}}>
        <T size={8.64} weight={400} color={colour.inkMuted} lh={13} lines={1}>
          {subtitle}
        </T>
      </View>
    </Pressable>
  );
}
