/**
 * RN port of `clients/tv-web/web/src/pages/Playlists.tsx` -- backs
 * `ROUTES.playlists` (design doc §7: "Read + play. Reorder/edit deferred").
 *
 * Scope narrowing, in the same spirit as every other screen in this
 * directory's own top comment: tv-web's version (1815 lines) is a full
 * playlist MANAGER -- nested sub-playlist directories with breadcrumbs,
 * create/rename/delete drawers, drag-reordering, and a visibility/media-type
 * filter drawer. Design doc §7 itself only asks for "Read + play" in v1, so
 * this screen delivers exactly that: browse top-level playlists, open one,
 * see (and open) its items. Creating, renaming, deleting, reordering, and
 * descending into a NESTED sub-playlist (`parent_playlist_id` pointing at
 * another playlist rather than `null`) are all deliberately not attempted --
 * each is real, additive work explicitly out of this pass's own scope, not
 * a corner cut silently.
 *
 * One real API-shape constraint worth stating plainly, because it explains
 * why this screen's item list looks the way it does: `PlaylistItemResponse`
 * (`GET /api/v1/playlists/{id}/items`) carries only `work_id`/`track_id`
 * REFERENCES, not an embedded `Work`/`Track` -- there is no batch "resolve
 * these ids to titles" endpoint in the spec today. This screen resolves
 * each item's `Work` with its own `client.getWork(item.work_id)` call
 * (`resolvePlaylistItems` below), in parallel, and reuses `PosterCard` (the
 * same component `LibraryScreen`/`SearchScreen`/`WorkDetailScreen` already
 * use) to render and open each one -- which also means an AUDIO playlist's
 * items (each `work_id` is the track's owning ARTIST work, per
 * `Track.album_id -> Album.artist_work_id`, since `PlaylistItemResponse`
 * carries no `album_id` to resolve a track's own title through) open that
 * artist's `MusicDetailScreen` rather than jumping straight to one track --
 * an honest reflection of what the API actually returns, not a bug in this
 * screen. A real per-track title/thumbnail would need a dedicated lookup
 * this spec does not offer yet; N+1 `getWork` calls is an acceptable cost
 * for a personal-collection playlist's usual size, not a scalability
 * strategy for an arbitrarily large one.
 */
import React, {useMemo, useState} from 'react';
import {ActivityIndicator, FlatList, Pressable, Text, View} from 'react-native';
import type {ApiClient, PlaylistItemResponse, PlaylistResponse, Work} from '@playarr-tv/api-client';
import {useAsyncData} from '@playarr-tv/api-client/react';
import {useApiClient} from '../api/ApiClientProvider';
import {colour} from '../theme/tokens';
import {layout, text} from '../theme/styles';
import {sh, sw} from '../theme/scale';
import {PosterCard, useAccessToken} from './LibraryScreen';
import {ROUTES, type RouteName} from '../navigation/routes';

interface ResolvedPlaylistItem {
  item: PlaylistItemResponse;
  work: Work | null;
}

/** See this file's top comment for why per-item resolution is a real, individual `getWork` call rather than a single batch request. A failed lookup (a deleted/inaccessible work) resolves to `work: null` and is skipped at render time, rather than failing the whole playlist's item list over one bad reference. */
async function resolvePlaylistItems(client: ApiClient, items: PlaylistItemResponse[]): Promise<ResolvedPlaylistItem[]> {
  return Promise.all(
    items.map(async (item) => {
      try {
        // ApiClient.getWork returns a full WorkDetailSchema (children,
        // media_file_id, runtime_ms, ...), not a bare Work -- this screen
        // only ever needs the `.work` projection PosterCard renders.
        const detail = await client.getWork(item.work_id);
        return {item, work: detail.work};
      } catch {
        return {item, work: null};
      }
    })
  );
}

async function loadPlaylistItems(client: ApiClient, playlistId: string): Promise<ResolvedPlaylistItem[]> {
  const items = await client.listPlaylistItems(playlistId);
  return resolvePlaylistItems(client, items);
}

export interface PlaylistsScreenNavigation {
  navigate: (route: RouteName, params?: Record<string, unknown>) => void;
}

export interface PlaylistsScreenProps {
  navigation: PlaylistsScreenNavigation;
}

function PlaylistRow({
  playlist,
  selected,
  onSelect,
  autoFocus,
}: {
  playlist: PlaylistResponse;
  selected: boolean;
  onSelect: () => void;
  autoFocus: boolean;
}): JSX.Element {
  const [focused, setFocused] = useState(false);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${playlist.name}`}
      hasTVPreferredFocus={autoFocus}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onSelect}
      style={{
        paddingVertical: sh(12),
        paddingHorizontal: sw(18),
        borderRadius: 8,
        marginBottom: sh(4),
        backgroundColor: selected ? colour.surfaceSoft : focused ? colour.surface : 'transparent',
        borderWidth: focused ? 2 : 0,
        borderColor: colour.focusRing,
      }}
    >
      <Text style={[text.body, {color: colour.ink}]} numberOfLines={1}>
        {playlist.name}
      </Text>
      <Text style={[text.caption, {color: colour.inkMuted}]}>
        {playlist.is_system ? 'System playlist' : 'Personal playlist'} · {playlist.media_type === 'audio' ? 'Audio' : 'Video'}
      </Text>
    </Pressable>
  );
}

export function PlaylistsScreen({navigation}: PlaylistsScreenProps): JSX.Element {
  const client = useApiClient();
  const accessToken = useAccessToken(client);

  const playlistsState = useAsyncData(() => client.listPlaylists(), [client], {
    isEmpty: (playlists) => playlists.length === 0,
  });

  const topLevelPlaylists = useMemo(() => {
    if (playlistsState.status !== 'ready') return [];
    return playlistsState.data.filter((playlist) => !playlist.parent_playlist_id);
  }, [playlistsState]);

  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const selectedPlaylist = topLevelPlaylists.find((playlist) => playlist.id === selectedPlaylistId) ?? null;

  const itemsState = useAsyncData(
    () => (selectedPlaylistId ? loadPlaylistItems(client, selectedPlaylistId) : Promise.resolve([])),
    [client, selectedPlaylistId],
    {enabled: Boolean(selectedPlaylistId), isEmpty: (items) => items.length === 0}
  );

  function openItem(work: Work): void {
    navigation.navigate(work.kind === 'artist' ? ROUTES.musicDetail : ROUTES.workDetail, {workId: work.id});
  }

  return (
    <View style={[layout.appScreen, {flexDirection: 'row'}]}>
      <View style={{width: sw(420), marginRight: sw(32)}}>
        <Text style={[text.title, {color: colour.ink, marginBottom: sh(20)}]}>Playlists</Text>

        {playlistsState.status === 'loading' ? (
          <ActivityIndicator size="large" color={colour.accent} />
        ) : playlistsState.status === 'error' ? (
          <>
            <Text style={[text.subtitle, {color: colour.ink}]}>Playlists could not be loaded</Text>
            <Text style={[text.body, {color: colour.inkSoft, marginTop: sh(8)}]}>{playlistsState.message}</Text>
          </>
        ) : playlistsState.status === 'empty' ? (
          <>
            <Text style={[text.subtitle, {color: colour.ink}]}>No playlists yet</Text>
            <Text style={[text.body, {color: colour.inkSoft, marginTop: sh(8)}]}>
              Create a playlist to organise films and series.
            </Text>
          </>
        ) : playlistsState.status === 'ready' ? (
          <FlatList
            data={topLevelPlaylists}
            keyExtractor={(playlist) => playlist.id}
            showsVerticalScrollIndicator={false}
            renderItem={({item, index}) => (
              <PlaylistRow
                playlist={item}
                selected={selectedPlaylist?.id === item.id}
                onSelect={() => setSelectedPlaylistId(item.id)}
                autoFocus={index === 0}
              />
            )}
          />
        ) : null}
      </View>

      <View style={{flex: 1}}>
        {!selectedPlaylist ? (
          <View style={{flex: 1, alignItems: 'center', justifyContent: 'center'}}>
            <Text style={[text.body, {color: colour.inkMuted}]}>Choose a playlist to open it.</Text>
          </View>
        ) : itemsState.status === 'loading' ? (
          <View style={{flex: 1, alignItems: 'center', justifyContent: 'center'}}>
            <ActivityIndicator size="large" color={colour.accent} />
          </View>
        ) : itemsState.status === 'error' ? (
          <Text style={[text.body, {color: colour.inkSoft}]}>{itemsState.message}</Text>
        ) : itemsState.status === 'empty' ? (
          <View style={{flex: 1, alignItems: 'center', justifyContent: 'center'}}>
            <Text style={[text.subtitle, {color: colour.ink}]}>Nothing here yet</Text>
            <Text style={[text.body, {color: colour.inkSoft, marginTop: sh(8)}]}>
              Add titles to {selectedPlaylist.name} to see them here.
            </Text>
          </View>
        ) : itemsState.status === 'ready' ? (
          <>
            <Text style={[text.subtitle, {color: colour.ink, marginBottom: sh(16)}]}>{selectedPlaylist.name}</Text>
            <FlatList
              data={itemsState.data.filter((resolved): resolved is ResolvedPlaylistItem & {work: Work} => resolved.work !== null)}
              keyExtractor={(resolved) => resolved.item.id}
              numColumns={5}
              showsVerticalScrollIndicator={false}
              renderItem={({item, index}) => (
                <PosterCard
                  work={item.work}
                  baseUrl={client.resolveUrl('/')}
                  accessToken={accessToken}
                  onSelect={openItem}
                  autoFocus={index === 0}
                />
              )}
            />
          </>
        ) : null}
      </View>
    </View>
  );
}
