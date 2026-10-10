/**
 * Home, drawn at the web TV layout's measurements (`clients/tv-web/web/src/pages/Home.tsx`): the stage with the focused
 * title's key art, the title panel on the left, and the vertical stack of rails on the right
 * (the merged "Start watching" rail first, then the server's rails, then the sites rails).
 */
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Animated, Easing, Pressable, View} from 'react-native';
import {useNavigation, type NavigationProp, type ParamListBase} from '@amazon-devices/react-navigation__native';
import type {ResumePlan, WatchProgress, Work} from '@playarr-tv/api-client';
import {useCatalogBrowse, useHomeRails, useWorkDetail} from '@playarr-tv/api-client/react';
import {useApiClient} from '../api/ApiClientProvider';
import {mediaThumbnailUrl, preferredArtworkKind, workArtworkUrl} from '../api/artworkUrl';
import {ArtworkImage} from '../components/ArtworkImage';
import {useLanguage} from '../i18n/LanguageProvider';
import {useTvBackNavigation} from '../navigation/backPolicy';
import {ROUTES} from '../navigation/routes';
import {useTheme} from '../theme/ThemeProvider';
import {focusNode, getFocusedTag, useDefaultFocus} from '../platform';
import {loadOnDeck, type OnDeckEntry} from '../lib/onDeck';
import {runtimeLabel} from '../lib/runtimeLabel';
import {blend} from '../theme/color';
import {EdgeFade, TRACK_GUTTER} from '../tv/EdgeFade';
import {MediaFocus} from '../tv/mediaFocus';
import {BalancedT, Box, T, u} from '../tv/kit';
import {indexWatchProgressByWork, WatchState} from '../tv/WatchState';
import {RailFrost, Stage} from '../tv/Stage';
import {useAccessToken} from './LibraryScreen';

interface HomeRail {
  id: string;
  title: string;
  items: Work[];
}

// The web's bigger Home cards (TV, 1920x1080): 327.2 px wide 16:9 art on a 352.1 px pitch, rails 365.9 px apart.
const RAIL_PITCH = 365.9;
const FIRST_HEADING_Y = 402;
const CARD_PITCH = 352.1;
const CARD_W = 327.2;
const ART_H = 184.05;
/** Art 184.05 + gap 11.25 + title 17.9 + gap 2.5 + subtitle 11.5. */
const CARD_H = 227.2;
/** How far the edge fades reach below the card art (the copy lines). */
const FADE_EXTRA = CARD_H - ART_H;
/**
 * The web snaps each card to a whole pixel from its fractional position (x = 881.6 + n * 352.1); the device's row layout
 * rounds every card's width and margin separately and drifts by a pixel per card, so cards are placed one by one instead.
 */
function cardLeft(index: number): number {
  return Math.round(RAIL_X + index * CARD_PITCH) - RAIL_X;
}
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
  // A late On Deck answer rebuilds the rails and unmounts the focused card, which leaves nothing focused and the remote
  // dead. Put focus back on the selected card whenever the rails change and focus was lost (web keeps it in place).
  const selectedCardRef = useRef<View>(null);
  useDefaultFocus(selectedCardRef);
  useEffect(() => {
    if (!getFocusedTag()) focusNode(selectedCardRef);
  }, [rails]);

  const railY = useRef(new Animated.Value(0)).current;
  // The rails scroll through their LEFT offset (JS-driven), not a transform: Vega's focus engine measures layout frames and
  // ignores transforms, so a transform made UP and DOWN land on the same index instead of the card visually above or below.
  const railLeft = u(RAIL_X - 729.6);
  const scrollX = useRef(rails.map(() => new Animated.Value(railLeft))).current;
  useEffect(() => {
    Animated.timing(railY, {toValue: -focus.rail * RAIL_PITCH, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true}).start();
  }, [focus.rail, railY]);
  const scrollTargets = useRef<number[]>([]);
  const [scrolled, setScrolled] = useState<number[]>([]);
  function focusItem(rail: number, item: number): void {
    setFocus({rail, item});
    const visible = 1920 - RAIL_X;
    const left = item * CARD_PITCH;
    let target = scrollTargets.current[rail] ?? 0;
    if (left + CARD_W + 46 > target + visible) target = left + CARD_W + 46 - visible;
    if (left < target + 8) target = Math.max(0, left - 8);
    scrollTargets.current[rail] = target;
    setScrolled((current) => {
      const next = [...current];
      next[rail] = target;
      return next;
    });
    while (scrollX.length <= rail) scrollX.push(new Animated.Value(railLeft));
    Animated.timing(scrollX[rail], {toValue: railLeft - u(target), duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: false}).start();
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
  // The web details panel's --dp-soft: ink 88% over the surface.
  const soft = blend(colour.ink, colour.surface, 0.88);

  return (
    <Stage artUri={artUri} accessToken={token}>
      <Box x={153.6} y={259.2} w={455}>
        <T size={12.288} weight={860} ls={0.983} color={dark ? '#eaa6b6' : '#821e36'} upper lh={18.4}>
          {kicker}
        </T>
        <View style={{marginTop: u(25.9), left: u(2.5), top: u(3)}}>
          <BalancedT key={featureTitle} width={373.2} size={69.12} weight={560} ls={-4.9766} lh={62.2} color={colour.ink}>
            {featureTitle}
          </BalancedT>
        </View>
        <FeatureRuntime workId={selected.id} color={soft} />
        <View style={{marginTop: u(21.6), width: u(324), top: u(2)}}>
          <T size={12.864} weight={600} lh={20.3} color={soft} lines={5}>
            {featureOverview}
          </T>
        </View>
      </Box>

      <RailFrost dark={dark} soft={colour.surfaceSoft} strong={colour.surfaceStrong} />

      <Box x={729.6} y={0} w={1190.4} h={1080} style={{overflow: 'hidden'}} pointerEvents="box-none">
        <Animated.View style={{transform: [{translateY: railY}]}} pointerEvents="box-none">
          {rails.map((rail, railIndex) => {
            const headingY = FIRST_HEADING_Y + railIndex * RAIL_PITCH;
            const active = railIndex === focus.rail;
            return (
              <View key={rail.id} pointerEvents="box-none">
                <RailHeading title={rail.title} x={RAIL_X - 729.6} y={headingY} active={active} colour={colour.ink} />
                <Animated.View
                  style={{
                    position: 'absolute',
                    left: scrollX[railIndex] ?? railLeft,
                    top: u(headingY + 26.5 + 17.28 + 18),
                    width: u(rail.items.length * CARD_PITCH),
                    height: u(CARD_H),
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
                      cardRef={active && itemIndex === focus.item ? selectedCardRef : undefined}
                      index={itemIndex}
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
                <EdgeFade
                  kind="gutter"
                  tint
                  side="left"
                  active={(scrolled[railIndex] ?? 0) > 0}
                  x={0}
                  y={headingY + 26.5}
                  w={1190.4}
                  h={ART_H + FADE_EXTRA + 47}
                  size={TRACK_GUTTER}
                />
                <EdgeFade
                  kind="mask"
                  side="right"
                  active={rail.items.length * CARD_PITCH - (scrolled[railIndex] ?? 0) > 1920 - RAIL_X + 8}
                  x={0}
                  y={headingY + 44}
                  w={1190.4}
                  h={ART_H + 60}
                  size={70}
                  solid={8}
                />
              </View>
            );
          })}
        </Animated.View>
      </Box>
    </Stage>
  );
}

/** The web Home feature's runtime line ("2h 17m"), from the focused title's detail; nothing until it arrives. */
function FeatureRuntime({workId, color}: {workId: string; color: string}): React.ReactElement | null {
  const client = useApiClient();
  const {t} = useLanguage();
  const state = useWorkDetail(client, workId);
  const label = state.status === 'ready' ? runtimeLabel(state.data.runtime_ms, t) : null;
  if (!label) return null;
  return (
    <View style={{marginTop: u(22.6)}}>
      <T size={12.864} weight={600} lh={18} color={color} lines={1}>
        {label}
      </T>
    </View>
  );
}

/** A rail heading. The active one grows 16% from its left edge and rises 1 px, as the web's `.tv-media-track.is-active h2` does. */
function RailHeading({title, x, y, active, colour}: {title: string; x: number; y: number; active: boolean; colour: string}): React.ReactElement {
  const [width, setWidth] = useState(0);
  return (
    <View
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={{
        position: 'absolute',
        left: u(x),
        top: u(y),
        transform: active ? [{translateX: width * 0.08}, {translateY: -1}, {scale: 1.16}] : [],
      }}
    >
      <T size={17.664} weight={610} ls={-0.53} lh={26.5} color={colour}>
        {title}
      </T>
    </View>
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
  cardRef?: React.Ref<View>;
  index: number;
  baseUrl: string;
  token: string | undefined;
  selected: boolean;
  subtitle: string;
  onFocus: () => void;
  onPress: () => void;
}): React.ReactElement {
  const {work, mediaFileId, title, progress, progressReady, first, cardRef, index, baseUrl, token, selected, subtitle, onFocus, onPress} = props;
  const {colour} = useTheme();
  const kind = preferredArtworkKind(work, ['backdrop', 'poster']);
  const uri = mediaFileId ? mediaThumbnailUrl(baseUrl, mediaFileId) : kind ? workArtworkUrl(baseUrl, work.id, kind) : undefined;
  return (
    <Pressable
      ref={cardRef}
      accessibilityRole="button"
      accessibilityLabel={work.title}
      hasTVPreferredFocus={first}
      onFocus={onFocus}
      onPress={onPress}
      style={{position: 'absolute', top: 0, left: u(cardLeft(index)), width: u(CARD_W)}}
    >
      <MediaFocus variant="home" focused={selected} width={CARD_W} height={ART_H} radius={12.48}>
        <View style={{width: '100%', height: '100%', backgroundColor: colour.surfaceSoft}}>
          <ArtworkImage uri={uri} accessToken={token} style={{width: '100%', height: '100%'}} resizeMode="cover" />
          <WatchState progress={progress} showUnwatched={progressReady} />
        </View>
      </MediaFocus>
      <View style={{marginTop: u(11.25)}}>
        <T size={11.904} weight={610} ls={-0.17856} color={colour.ink} lh={17.9} lines={1} dy={-2}>
          {title}
        </T>
      </View>
      <View style={{marginTop: u(2.5)}}>
        <T size={8.832} weight={400} color={colour.inkMuted} lh={11.5} lines={1} dy={-2}>
          {subtitle}
        </T>
      </View>
    </Pressable>
  );
}
