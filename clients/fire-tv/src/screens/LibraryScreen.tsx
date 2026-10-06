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
import React, {useEffect, useMemo, useState} from 'react';
import {ActivityIndicator, FlatList, Image, Pressable, Text, View} from 'react-native';
import type {ApiClient, Work, WorkKind} from '@playarr-tv/api-client';
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

export function LibraryScreen({kind, navigation}: LibraryScreenProps): JSX.Element {
  const client = useApiClient();
  const accessToken = useAccessToken(client);
  const state = useCatalogBrowse(client, {kind, sort: 'title', order: 'asc', limit: PAGE_LIMIT});

  const label = KIND_LABEL[kind];
  const detailRoute = kind === 'artist' ? ROUTES.musicDetail : ROUTES.workDetail;

  const items = useMemo(() => (state.status === 'ready' ? state.data.items : []), [state]);

  function openWork(work: Work): void {
    navigation.navigate(detailRoute, {workId: work.id});
  }

  return (
    <View style={layout.appScreen}>
      <Text style={[text.title, {color: colour.ink, marginBottom: sh(20)}]}>{label}</Text>

      {state.status === 'loading' ? (
        <View style={{flex: 1, alignItems: 'center', justifyContent: 'center'}}>
          <ActivityIndicator size="large" color={colour.accent} />
          <Text style={[text.body, {color: colour.inkSoft, marginTop: sh(12)}]}>Loading {label.toLowerCase()}</Text>
        </View>
      ) : state.status === 'error' ? (
        <View style={{flex: 1, alignItems: 'center', justifyContent: 'center'}}>
          <Text style={[text.subtitle, {color: colour.ink}]}>The {label.toLowerCase()} library could not be loaded</Text>
          <Text style={[text.body, {color: colour.inkSoft, marginTop: sh(8)}]}>{state.message}</Text>
        </View>
      ) : state.status === 'empty' ? (
        <View style={{flex: 1, alignItems: 'center', justifyContent: 'center'}}>
          <Text style={[text.subtitle, {color: colour.ink}]}>No playable {label.toLowerCase()} yet</Text>
          <Text style={[text.body, {color: colour.inkSoft, marginTop: sh(8), textAlign: 'center', maxWidth: sw(560)}]}>
            Titles appear here once they finish syncing from a connected library.
          </Text>
        </View>
      ) : state.status === 'ready' ? (
        <FlatList
          data={items}
          key={kind}
          keyExtractor={(work) => work.id}
          numColumns={5}
          showsVerticalScrollIndicator={false}
          renderItem={({item, index}) => (
            <PosterCard
              work={item}
              baseUrl={client.resolveUrl('/')}
              accessToken={accessToken}
              onSelect={openWork}
              autoFocus={index === 0}
            />
          )}
        />
      ) : null}
    </View>
  );
}
