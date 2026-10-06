/**
 * RN port of `clients/tv-web/web/src/pages/Home.tsx` -- design doc §7's
 * "Feature panel + vertical stack of `TvMediaTrack` rails".
 *
 * Built against the real shared components this worktree's concurrently-run
 * `components/`-phase pass landed while this screen was being written --
 * `components/TvStage.tsx` (the feature panel), `components/TvMediaTrack.tsx`
 * (each rail), `components/PosterCard.tsx` and `components/ArtworkImage.tsx`
 * (every poster), and `components/TvEmptyState.tsx` (the loading-adjacent
 * empty state) -- rather than the plain `View`/`Image`/`FlatList` primitives
 * an earlier draft of this file used before those existed. Nothing about
 * this screen's DATA layer changed in that rewrite: it is still
 * `useCatalogBrowse` called three times, unmodified, per the reasoning
 * below.
 *
 * Scope narrowing versus tv-web's 667-line original, stated explicitly:
 * that size also comes from a "primary" rail (merged movies+series+sites,
 * sorted, feeding a richer hero with per-item context) and three more
 * "more-<kind>" second-page rails past the ones kept here. The feature
 * panel below uses a simpler "most recently added item across all three
 * kinds" choice rather than that merged/curated primary rail, and only the
 * three first-page "new-<kind>" rails are kept -- three rails plus a real
 * feature panel is already a complete, useful Home screen, and doubling
 * the rail count or hand-curating the feature pick is optimising a screen
 * nobody has looked at running against a real server yet.
 *
 * `useCatalogBrowse` is called three times (once per kind), not once in a
 * loop over an array of kinds -- React's rules of hooks require a
 * stable number/order of hook calls per render, and this exactly mirrors
 * tv-web's own `Home.tsx` (`seriesState`/`movieState`/`siteState`, three
 * separate calls) for the same reason.
 */
import React, {useMemo, useState} from 'react';
import {ActivityIndicator, Pressable, Text, View} from 'react-native';
import {
  useNavigation,
  type NavigationProp,
  type ParamListBase,
} from '@amazon-devices/react-navigation__native';
import type {Work, WorkKind} from '@playarr-tv/api-client';
import {useCatalogBrowse} from '@playarr-tv/api-client/react';
import {useApiClient} from '../api/ApiClientProvider';
import {preferredArtworkKind, workArtworkUrl} from '../api/artworkUrl';
import {ArtworkImage} from '../components/ArtworkImage';
import {PosterCard} from '../components/PosterCard';
import {TvEmptyState} from '../components/TvEmptyState';
import {TvMediaTrack} from '../components/TvMediaTrack';
import {TvStage} from '../components/TvStage';
import {useAccessToken} from './LibraryScreen';
import {useTvBackNavigation} from '../navigation/backPolicy';
import {ROUTES} from '../navigation/routes';
import {colour} from '../theme/tokens';
import {layout, text} from '../theme/styles';
import {sh, sw} from '../theme/scale';

/** How many titles each rail fetches -- generous enough to fill a 1920-wide rail several cards past the edge of the screen without a second page, matching `LibraryScreen.tsx`'s own reasoning for its `PAGE_LIMIT`, just smaller since a rail (not a grid) is what is being filled. */
const RAIL_LIMIT = 20;

const RAIL_ITEM_WIDTH = sw(200);

const KIND_LABEL: Partial<Record<WorkKind, string>> = {
  movie: 'Movie',
  series: 'Series',
  site: 'Site',
};

interface FeaturedViewButtonProps {
  onPress: () => void;
}

function FeaturedViewButton({onPress}: FeaturedViewButtonProps): React.ReactElement {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="View title"
      hasTVPreferredFocus
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={{
        marginTop: sh(20),
        alignSelf: 'flex-start',
        paddingVertical: sh(10),
        paddingHorizontal: sw(26),
        borderRadius: 8,
        backgroundColor: focused ? colour.accent : colour.surfaceStrong,
      }}
    >
      <Text style={[text.bodyEmphasis, {color: focused ? colour.onAccent : colour.ink}]}>View</Text>
    </Pressable>
  );
}

export function HomeScreen(): React.ReactElement {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const client = useApiClient();
  const accessToken = useAccessToken(client);
  const baseUrl = client.resolveUrl('/');

  const movieState = useCatalogBrowse(client, {kind: 'movie', sort: 'date_added', order: 'desc', limit: RAIL_LIMIT});
  const seriesState = useCatalogBrowse(client, {
    kind: 'series',
    sort: 'date_added',
    order: 'desc',
    limit: RAIL_LIMIT,
  });
  const siteState = useCatalogBrowse(client, {kind: 'site', sort: 'date_added', order: 'desc', limit: RAIL_LIMIT});

  const allLoading =
    movieState.status === 'loading' && seriesState.status === 'loading' && siteState.status === 'loading';

  function readyItems(state: typeof movieState): readonly Work[] {
    return state.status === 'ready' ? state.data.items : [];
  }

  const movies = readyItems(movieState);
  const series = readyItems(seriesState);
  const sites = readyItems(siteState);

  const allSettledEmpty =
    movieState.status !== 'loading' &&
    seriesState.status !== 'loading' &&
    siteState.status !== 'loading' &&
    movies.length === 0 &&
    series.length === 0 &&
    sites.length === 0;

  // The feature panel's pick: the single most-recently-added item across
  // whichever of the three rails have actually resolved -- see this file's
  // top comment for why this is a simpler stand-in for tv-web's own
  // hand-merged "primary" rail, not an attempt to reproduce it exactly.
  const featured = useMemo<Work | undefined>(() => {
    const combined = [...movies, ...series, ...sites];
    if (combined.length === 0) return undefined;
    return [...combined].sort(
      (a, b) => new Date(b.added_at).getTime() - new Date(a.added_at).getTime()
    )[0];
  }, [movies, series, sites]);

  const featuredArtKind = featured ? preferredArtworkKind(featured, ['backdrop', 'poster']) : null;
  const featuredArtUri =
    featured && featuredArtKind ? workArtworkUrl(baseUrl, featured.id, featuredArtKind) : undefined;

  function openWork(work: Work): void {
    // `backTo: ROUTES.home` is passed explicitly here -- the exact contract
    // `backPolicy.ts`'s own doc comment says every `workDetail` navigation
    // MUST supply, since the route name alone cannot recover which rail a
    // title was opened from. Home only ever has one sensible parent to
    // report (itself), which is also usefully the simplest possible
    // illustration of the contract for whoever wires
    // `series`/`movies`/`sites`/`music`'s own list screens the same way.
    navigation.navigate(ROUTES.workDetail, {workId: work.id, backTo: ROUTES.home});
  }

  // Home is the true root of the authenticated app shell --
  // `backPolicy.ts`'s `parentRoute(ROUTES.home)` resolves to itself, so
  // `useTvBackNavigation()` (called with no `fallbackBackTo`, since Home
  // has no parent to fall back to at all) correctly leaves a Back press
  // here unhandled, letting Vega's own default behaviour proceed -- e.g.
  // backgrounding or exiting the app, exactly as pressing Back at a
  // tv-web root pathname does today.
  useTvBackNavigation();

  if (allLoading) {
    return (
      <View style={[layout.appScreen, {alignItems: 'center', justifyContent: 'center'}]}>
        <ActivityIndicator size="large" color={colour.accent} />
      </View>
    );
  }

  if (allSettledEmpty || !featured) {
    return (
      <View style={layout.appScreen}>
        <TvEmptyState
          variant="page"
          graphic="home"
          title="Nothing here yet"
          description="Titles appear here once they finish syncing from a connected library."
        />
      </View>
    );
  }

  return (
    <View style={layout.appScreen}>
      <TvStage
        style={{flex: 0, height: sh(520), marginHorizontal: -sw(86), marginTop: -sh(38)}}
        keyArt={
          <ArtworkImage
            uri={featuredArtUri}
            accessToken={accessToken}
            style={{width: '100%', height: '100%'}}
            resizeMode="cover"
            fallback={<View style={{flex: 1, backgroundColor: colour.surface}} />}
          />
        }
        titlePanel={
          <View>
            {KIND_LABEL[featured.kind] ? (
              <Text style={[text.caption, {color: colour.stageKicker, textTransform: 'uppercase', letterSpacing: sw(2)}]}>
                {KIND_LABEL[featured.kind]}
              </Text>
            ) : null}
            <Text style={[text.display, {color: colour.ink, marginTop: sh(6)}]} numberOfLines={2}>
              {featured.title}
            </Text>
            {featured.overview ? (
              <Text style={[text.body, {color: colour.inkSoft, marginTop: sh(10)}]} numberOfLines={3}>
                {featured.overview}
              </Text>
            ) : null}
            <FeaturedViewButton onPress={() => openWork(featured)} />
          </View>
        }
      />

      <TvMediaTrack
        title="New Movies"
        data={movies}
        keyExtractor={(work) => work.id}
        estimatedItemSize={RAIL_ITEM_WIDTH}
        emptyState={<TvEmptyState variant="track" graphic="movies" title="No new movies" />}
        renderItem={({item, index}) => (
          <PosterCard
            title={item.title}
            width={RAIL_ITEM_WIDTH}
            accessibilityLabel={`Open ${item.title}`}
            onPress={() => openWork(item)}
            art={
              <ArtworkImage
                uri={(() => {
                  const kind = preferredArtworkKind(item, ['poster', 'thumb']);
                  return kind ? workArtworkUrl(baseUrl, item.id, kind) : undefined;
                })()}
                accessToken={accessToken}
                style={{width: '100%', height: '100%'}}
              />
            }
            style={index === movies.length - 1 ? undefined : {marginRight: sw(16)}}
          />
        )}
      />

      <TvMediaTrack
        title="New Series"
        data={series}
        keyExtractor={(work) => work.id}
        estimatedItemSize={RAIL_ITEM_WIDTH}
        emptyState={<TvEmptyState variant="track" graphic="series" title="No new series" />}
        renderItem={({item, index}) => (
          <PosterCard
            title={item.title}
            width={RAIL_ITEM_WIDTH}
            accessibilityLabel={`Open ${item.title}`}
            onPress={() => openWork(item)}
            art={
              <ArtworkImage
                uri={(() => {
                  const kind = preferredArtworkKind(item, ['poster', 'thumb']);
                  return kind ? workArtworkUrl(baseUrl, item.id, kind) : undefined;
                })()}
                accessToken={accessToken}
                style={{width: '100%', height: '100%'}}
              />
            }
            style={index === series.length - 1 ? undefined : {marginRight: sw(16)}}
          />
        )}
      />

      <TvMediaTrack
        title="New Sites"
        data={sites}
        keyExtractor={(work) => work.id}
        estimatedItemSize={RAIL_ITEM_WIDTH}
        emptyState={<TvEmptyState variant="track" graphic="movies" title="No new sites" />}
        renderItem={({item, index}) => (
          <PosterCard
            title={item.title}
            width={RAIL_ITEM_WIDTH}
            accessibilityLabel={`Open ${item.title}`}
            onPress={() => openWork(item)}
            art={
              <ArtworkImage
                uri={(() => {
                  const kind = preferredArtworkKind(item, ['poster', 'thumb']);
                  return kind ? workArtworkUrl(baseUrl, item.id, kind) : undefined;
                })()}
                accessToken={accessToken}
                style={{width: '100%', height: '100%'}}
              />
            }
            style={index === sites.length - 1 ? undefined : {marginRight: sw(16)}}
          />
        )}
      />
    </View>
  );
}
