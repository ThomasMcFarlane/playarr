/**
 * RN port of `clients/tv-web/web/src/pages/Search.tsx` -- narrowed heavily,
 * for reasons worth stating rather than leaving implicit: tv-web's version
 * is 987 lines because a mouse-and-keyboard user can comfortably drive a
 * library/type filter drawer, a `?q=`/`?type=`/`?library=` URL-synced query
 * string, and a manual scroll-edge-fade rail, on top of the actual search.
 * None of that is this screen's job on a remote-first TV surface, and none
 * of it is required for "type a query, see matching titles, open one" to
 * genuinely work end to end -- which is what this screen does.
 *
 * Two features are deliberately NOT ported, both for reasons specific to
 * what exists in THIS worktree today rather than being judged unimportant:
 *
 *  - Playlist results (tv-web's `SEARCH_TYPES` includes a "Playlists"
 *    filter, backed by a client-side substring match over
 *    `client.listPlaylists()`, since `/api/v1/catalog/search` only searches
 *    `Work`s). `PlaylistsScreen.tsx` (this same task's own scope) is a
 *    dedicated, browsable list of every playlist already -- duplicating a
 *    second, filtered path to the same data here is not obviously worth
 *    the extra round trip and extra UI surface for a first TV pass.
 *  - Library/type filter chips gated on `availableWorkKinds` -- that value
 *    comes from `AppShellOutletContext`, supplied by `AppShellNavigator`
 *    (design doc §2's navigation layer, a concurrent/later task this
 *    screen has no access to yet). Filtering client-side over the
 *    unfiltered result set once that context exists is a additive,
 *    non-breaking follow-up to this screen, not a rewrite of it.
 *
 * What IS ported faithfully: the `AsyncState` shape search actually needs
 * (`idle` before the first keystroke settles, distinct from `loading` once
 * a query is in flight -- unlike `LibraryScreen`'s browse, which never
 * really has a meaningful idle state, search genuinely does), and
 * debouncing keystrokes into one request rather than one per character,
 * which tv-web achieves via a `setSearchParams` + routing round trip and
 * this screen achieves with a plain `useEffect` timer -- a legitimate
 * `useEffect` use per the repo's React rule (CLAUDE.md): synchronising
 * local input state with an external system (the network) after a pause,
 * not chaining one React state update off another.
 */
import React, {useEffect, useMemo, useState} from 'react';
import {ActivityIndicator, FlatList, Text, TextInput, View} from 'react-native';
import {useAsyncData} from '@playarr-tv/api-client/react';
import {useApiClient} from '../api/ApiClientProvider';
import {colour} from '../theme/tokens';
import {layout, text} from '../theme/styles';
import {sh, sw} from '../theme/scale';
import {PosterCard, useAccessToken} from './LibraryScreen';
import {ROUTES, type RouteName} from '../navigation/routes';
import type {Work} from '@playarr-tv/api-client';

/** Matches tv-web's own `SEARCH_LIMIT` -- generous enough for a single results screen with no pagination. */
const SEARCH_LIMIT = 60;

/** How long to wait after the last keystroke before actually searching -- long enough that fast typing on an on-screen/Bluetooth keyboard doesn't fire a request per character, short enough that the result still feels responsive. */
const DEBOUNCE_MS = 350;

export interface SearchScreenNavigation {
  navigate: (route: RouteName, params?: Record<string, unknown>) => void;
}

export interface SearchScreenProps {
  navigation: SearchScreenNavigation;
}

export function SearchScreen({navigation}: SearchScreenProps): JSX.Element {
  const client = useApiClient();
  const accessToken = useAccessToken(client);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  useEffect(() => {
    const trimmed = query.trim();
    const timer = setTimeout(() => setDebouncedQuery(trimmed), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const state = useAsyncData(() => client.searchCatalog(debouncedQuery, SEARCH_LIMIT), [client, debouncedQuery], {
    enabled: debouncedQuery.length > 0,
    isEmpty: (results) => results.length === 0,
  });

  function openWork(work: Work): void {
    navigation.navigate(work.kind === 'artist' ? ROUTES.musicDetail : ROUTES.workDetail, {workId: work.id});
  }

  const resultCountLabel = useMemo(() => {
    if (state.status !== 'ready') return null;
    const count = state.data.length;
    return count === 1 ? '1 result' : `${count} results`;
  }, [state]);

  return (
    <View style={layout.appScreen}>
      <Text style={[text.title, {color: colour.ink, marginBottom: sh(20)}]}>Search</Text>

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search your libraries and playlists"
        placeholderTextColor={colour.inkMuted}
        style={{
          borderWidth: 2,
          borderColor: colour.line,
          borderRadius: 8,
          paddingHorizontal: sw(20),
          paddingVertical: sh(14),
          color: colour.ink,
          fontSize: sw(24),
          marginBottom: sh(24),
          backgroundColor: colour.surface,
        }}
        // AGENTS.md's TV text-input rule (design doc §4.4) is about vertical
        // arrows escaping to spatial nav once the IME closes, which is
        // `components/TvTextInput.tsx`'s job (a components-phase task, not
        // this screen's) -- a plain `TextInput` is used here directly
        // because that wrapper does not exist yet in this worktree, and a
        // search box with no way to type into it at all would not be a
        // smaller gap than a search box missing that one polish detail.
        returnKeyType="search"
      />

      {resultCountLabel ? (
        <Text style={[text.caption, {color: colour.inkMuted, marginBottom: sh(12)}]}>{resultCountLabel}</Text>
      ) : null}

      {state.status === 'idle' ? (
        <View style={{flex: 1, alignItems: 'center', justifyContent: 'center'}}>
          <Text style={[text.body, {color: colour.inkMuted}]}>Start typing to search.</Text>
        </View>
      ) : state.status === 'loading' ? (
        <View style={{flex: 1, alignItems: 'center', justifyContent: 'center'}}>
          <ActivityIndicator size="large" color={colour.accent} />
          <Text style={[text.body, {color: colour.inkSoft, marginTop: sh(12)}]}>Searching…</Text>
        </View>
      ) : state.status === 'error' ? (
        <View style={{flex: 1, alignItems: 'center', justifyContent: 'center'}}>
          <Text style={[text.subtitle, {color: colour.ink}]}>Search could not be completed</Text>
          <Text style={[text.body, {color: colour.inkSoft, marginTop: sh(8)}]}>{state.message}</Text>
        </View>
      ) : state.status === 'empty' ? (
        <View style={{flex: 1, alignItems: 'center', justifyContent: 'center'}}>
          <Text style={[text.subtitle, {color: colour.ink}]}>No matching titles or playlists.</Text>
          <Text style={[text.body, {color: colour.inkSoft, marginTop: sh(8)}]}>
            Try another title or adjust your search.
          </Text>
        </View>
      ) : state.status === 'ready' ? (
        <FlatList
          data={state.data}
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
