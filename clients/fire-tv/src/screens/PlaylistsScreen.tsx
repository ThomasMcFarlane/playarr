/**
 * Playlists, drawn on the web TV layout (`clients/tv-web/web/src/pages/Playlists.tsx`): the page copy on the left, the Create
 * and Filters tiles in the action column and a track of titles for each top-level playlist on the right (the web's directory
 * of playlists). With no playlists it is the web's empty state.
 *
 * Not on this platform yet: creating a playlist, sub-playlists and the filter drawer (their tiles are drawn); playlists are
 * made from a title page's "Add to Playlist".
 */
import React, {useEffect, useMemo, useState} from 'react';
import type {ApiClient, PlaylistItemResponse, PlaylistResponse, Work} from '@playarr-tv/api-client';
import {useAsyncData} from '@playarr-tv/api-client/react';
import {useApiClient} from '../api/ApiClientProvider';
import {preferredArtworkKind, workArtworkUrl} from '../api/artworkUrl';
import {useLanguage} from '../i18n/LanguageProvider';
import {useTvBackNavigation} from '../navigation/backPolicy';
import {ROUTES, type RouteName} from '../navigation/routes';
import {useTheme} from '../theme/ThemeProvider';
import {ActionTile} from '../tv/ActionTile';
import {EmptyState} from '../tv/EmptyState';
import {Box, T, u} from '../tv/kit';
import {PageHeader} from '../tv/PageHeader';
import {RailFrost, Stage} from '../tv/Stage';
import {TrackStack, type Track} from '../tv/TrackStack';
import {View} from 'react-native';
import {useAccessToken} from './LibraryScreen';

interface ResolvedPlaylistItem {
  item: PlaylistItemResponse;
  work: Work | null;
}

/** Items shown per playlist track; a playlist can hold hundreds. */
const ITEMS_PER_TRACK = 24;

async function loadTracks(client: ApiClient, playlists: PlaylistResponse[]): Promise<Array<{playlist: PlaylistResponse; items: ResolvedPlaylistItem[]; total: number}>> {
  return Promise.all(
    playlists.map(async (playlist) => {
      const items = await client.listPlaylistItems(playlist.id).catch(() => [] as PlaylistItemResponse[]);
      const shown = await Promise.all(
        items.slice(0, ITEMS_PER_TRACK).map(async (item) => {
          try {
            // `getWork` returns the full detail; a card only needs its `.work`.
            const detail = await client.getWork(item.work_id);
            return {item, work: detail.work};
          } catch {
            return {item, work: null};
          }
        }),
      );
      return {playlist, items: shown, total: items.length};
    }),
  );
}

export interface PlaylistsScreenNavigation {
  navigate: (route: RouteName, params?: Record<string, unknown>) => void;
}

export interface PlaylistsScreenProps {
  navigation: PlaylistsScreenNavigation;
}

export function PlaylistsScreen({navigation}: PlaylistsScreenProps): React.ReactElement {
  const client = useApiClient();
  const token = useAccessToken(client);
  const baseUrl = client.resolveUrl('/');
  const {t} = useLanguage();
  const {colour, scheme} = useTheme();
  useTvBackNavigation(ROUTES.home);

  const playlistsState = useAsyncData(() => client.listPlaylists(), [client]);
  const topLevel = useMemo(() => (playlistsState.status === 'ready' ? playlistsState.data.filter((playlist) => !playlist.parent_playlist_id) : []), [playlistsState]);
  const tracksState = useAsyncData(() => loadTracks(client, topLevel), [client, topLevel.map((playlist) => playlist.id).join(',')], {enabled: playlistsState.status === 'ready' && topLevel.length > 0});
  const [focus, setFocus] = useState<{track: number; item: number} | null>(null);
  useEffect(() => setFocus(null), [topLevel.length]);

  const tracks: Track[] = useMemo(
    () =>
      tracksState.status === 'ready'
        ? tracksState.data.map(({playlist, items, total}) => ({
            id: playlist.id,
            title: playlist.name,
            meta: total === 1 ? t('pages.playlists.itemCountOne', {count: total}) : t('pages.playlists.itemCountOther', {count: total}),
            items: items
              .filter((entry): entry is {item: PlaylistItemResponse; work: Work} => entry.work !== null)
              .map(({item, work}) => {
                const kind = preferredArtworkKind(work, ['backdrop', 'poster']);
                return {
                  id: item.id,
                  art: kind ? workArtworkUrl(baseUrl, work.id, kind) : undefined,
                  small: work.kind === 'series' ? t('pages.home.workKind.series') : work.kind === 'artist' ? t('pages.home.workKind.artist') : t('pages.home.workKind.movie'),
                  title: work.title,
                  onPress: () => navigation.navigate(work.kind === 'artist' ? ROUTES.musicDetail : ROUTES.workDetail, {workId: work.id, backTo: ROUTES.playlists}),
                };
              }),
          }))
        : [],
    [tracksState, baseUrl, t, navigation],
  );

  const count = topLevel.length;
  const empty = playlistsState.status === 'ready' && count === 0;

  return (
    <Stage>
      <PageHeader
        title={t('pages.playlists.title')}
        detail={playlistsState.status === 'ready' ? (count === 1 ? t('pages.playlists.playlistCountOne', {count}) : t('pages.playlists.playlistCountOther', {count})) : undefined}
        onBack={() => navigation.navigate(ROUTES.home)}
      />
      <Box x={153.6} y={259.2} w={540}>
        <T size={12.288} weight={820} ls={0.983} lh={18.4} color="#cf3157" upper>
          {t('pages.playlists.yourCollection')}
        </T>
        <View style={{marginTop: u(25.9)}}>
          <T size={69.12} weight={560} ls={-4.9766} lh={62.2} color={colour.ink}>
            {t('pages.playlists.title')}
          </T>
        </View>
        <View style={{marginTop: u(27), width: u(324)}}>
          <T size={12.864} weight={400} lh={20.3} color={colour.inkMuted}>
            {t('pages.playlists.createPlaylistPrompt')}
          </T>
        </View>
      </Box>
      <RailFrost dark={scheme === 'dark'} soft={colour.surfaceSoft} strong={colour.surfaceStrong} />
      <ActionTile icon="plus" label={t('pages.playlists.create')} slot={0} />
      <ActionTile icon="filters" label={t('pages.playlists.filters')} slot={1} />
      {empty ? <EmptyState x={729.6} width={1100} y={412} title={t('pages.playlists.noPlaylistsYetTitle')} description={t('pages.playlists.createPlaylistPrompt')} /> : null}
      {playlistsState.status === 'error' ? <EmptyState x={729.6} width={1100} y={412} title={t('pages.playlists.loadErrorTitle')} description={playlistsState.message} tone="error" /> : null}
      {tracks.length > 0 ? <TrackStack tracks={tracks} token={token} restY={410} focus={focus} onFocus={setFocus} initial={null} /> : null}
    </Stage>
  );
}
