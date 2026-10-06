/**
 * RN port of `clients/tv-web/web/src/pages/MusicDetail.tsx` -- backs
 * `ROUTES.musicDetail`, reached whenever `LibraryScreen`/`SearchScreen`/
 * `WorkDetailScreen`/`PlaylistsScreen` open a work whose `kind === "artist"`
 * (design doc §7: "/music/:id -> MusicDetail.tsx | Albums/tracks + inline
 * music player").
 *
 * Scope narrowing, in the same spirit as `WorkDetailScreen.tsx`'s own top
 * comment: tv-web's version (970 lines) builds a full 3D "cover flow" album
 * carousel (`AlbumCoverFlow`, with its own circular-offset maths and
 * keyboard-driven rotation) as its primary browsing surface. That is a
 * genuinely DOM/CSS-3D-transform-shaped piece of UI with no direct Vega
 * equivalent to port -- `Animated`'s 2D transform model does not give the
 * same perspective/rotateY effect tv-web's CSS does, and building an
 * accurate 3D-carousel-on-Fabric from scratch is its own component-design
 * task, not a faithful "port" of the existing one. This screen instead
 * lists albums as a plain horizontal rail (the same `PosterCard`-shaped
 * interaction every other screen in this task uses) -- less visually
 * elaborate, but the actual functionality design doc §7 asks for (browse
 * albums, see a selected album's tracks) works identically either way.
 *
 * What IS ported faithfully: `useWorkDetail` (verbatim reuse, same as
 * `WorkDetailScreen`), the `artistChildren`/`playableTracks`/
 * `formatDuration`/`albumLabel` helpers (copied near-verbatim from tv-web's
 * own module-level functions -- these are plain, DOM-free data shaping over
 * `AlbumDetail`/`TrackDetail`, not UI, so there is no reason to write them
 * differently here), and per-track playback via the same injected
 * `onPlay(mediaFileId)` callback `WorkDetailScreen` uses, for the identical
 * reason stated there: `PlayerScreen.tsx` does not exist in this worktree
 * yet.
 */
import React, {useMemo, useState} from 'react';
import {ActivityIndicator, FlatList, Image, Pressable, ScrollView, Text, View} from 'react-native';
import type {Album, AlbumDetail, Track, TrackDetail, Work, WorkDetail} from '@playarr-tv/api-client';
import {useWorkDetail} from '@playarr-tv/api-client/react';
import {useApiClient} from '../api/ApiClientProvider';
import {albumArtworkUrl, artworkAuthHeaders} from '../api/artworkUrl';
import {CAPABILITIES} from '../platform/capabilities';
import {colour} from '../theme/tokens';
import {layout, text} from '../theme/styles';
import {sh, sw} from '../theme/scale';
import {useAccessToken} from './LibraryScreen';
import type {RouteName} from '../navigation/routes';

/** Narrows `WorkDetailSchema.children` to its `Artist` variant -- see `WorkDetailScreen.tsx`'s `seriesSeasons` for the sibling `Series` narrowing and the shared reasoning behind why this file has its own copy rather than a shared helper. */
function artistChildren(children: WorkDetail['children']): AlbumDetail[] {
  return typeof children === 'object' && children !== null && 'Artist' in children ? children.Artist : [];
}

/** Only tracks with a resolved `MediaFile` (i.e. actually synced) are playable -- mirrors tv-web's own filter exactly. */
function playableTracks(album: AlbumDetail): TrackDetail[] {
  return album.tracks.filter((track) => track.media_file_id != null);
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return 'Duration unavailable';
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

function albumLabel(album: Album): string {
  return album.release_date ? String(new Date(album.release_date).getUTCFullYear()) : album.album_type.replace('_', ' ');
}

export interface MusicDetailScreenNavigation {
  navigate: (route: RouteName, params?: Record<string, unknown>) => void;
}

export interface MusicDetailRouteParams {
  workId: string;
}

export interface MusicDetailScreenProps {
  route: {params: MusicDetailRouteParams};
  navigation: MusicDetailScreenNavigation;
  /** See `WorkDetailScreen.tsx`'s identical prop for why this is injected rather than a `navigation.navigate` call. */
  onPlay?: (mediaFileId: string) => void;
}

const ALBUM_COVER_SIZE = sw(200);

function AlbumCover({
  album,
  artistWorkId,
  baseUrl,
  accessToken,
  selected,
  onSelect,
}: {
  album: Album;
  artistWorkId: string;
  baseUrl: string;
  accessToken: string | undefined;
  selected: boolean;
  onSelect: () => void;
}): JSX.Element {
  const [focused, setFocused] = useState(false);
  const artworkKind = album.images.some((image) => image.kind === 'poster') ? 'poster' : undefined;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${album.title}`}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onSelect}
      style={{width: ALBUM_COVER_SIZE, marginRight: sw(20)}}
    >
      <View
        style={{
          width: ALBUM_COVER_SIZE,
          height: ALBUM_COVER_SIZE,
          borderRadius: 10,
          overflow: 'hidden',
          backgroundColor: colour.surface,
          borderWidth: focused || selected ? 3 : 0,
          borderColor: selected ? colour.accent : colour.focusRing,
        }}
      >
        {artworkKind && CAPABILITIES.artworkRequestHeaders ? (
          <Image
            source={{
              uri: albumArtworkUrl(baseUrl, artistWorkId, album.id, artworkKind),
              headers: artworkAuthHeaders(accessToken),
            }}
            style={{width: '100%', height: '100%'}}
            resizeMode="cover"
          />
        ) : null}
      </View>
      <Text style={[text.body, {color: selected ? colour.ink : colour.inkSoft, marginTop: sh(8)}]} numberOfLines={1}>
        {album.title}
      </Text>
      <Text style={[text.caption, {color: colour.inkMuted}]}>{albumLabel(album)}</Text>
    </Pressable>
  );
}

function TrackRow({
  track,
  index,
  onPlay,
}: {
  track: Track;
  index: number;
  onPlay: (() => void) | undefined;
}): JSX.Element {
  const [focused, setFocused] = useState(false);
  const playable = Boolean(onPlay);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Play ${track.title}`}
      accessibilityState={{disabled: !playable}}
      disabled={!playable}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPlay}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: sh(10),
        paddingHorizontal: sw(16),
        borderRadius: 8,
        marginBottom: sh(4),
        backgroundColor: focused ? colour.surfaceSoft : 'transparent',
        borderWidth: focused ? 2 : 0,
        borderColor: colour.focusRing,
        opacity: playable ? 1 : 0.5,
      }}
    >
      <Text style={[text.caption, {color: colour.inkMuted, width: sw(36)}]}>{index + 1}</Text>
      <Text style={[text.body, {color: colour.ink, flex: 1}]} numberOfLines={1}>
        {track.title}
      </Text>
      <Text style={[text.caption, {color: colour.inkMuted}]}>{formatDuration(track.duration_seconds)}</Text>
    </Pressable>
  );
}

export function MusicDetailScreen({route, onPlay}: MusicDetailScreenProps): JSX.Element {
  const client = useApiClient();
  const accessToken = useAccessToken(client);
  const workId = route.params.workId;
  const state = useWorkDetail(client, workId);

  const albums = useMemo(() => (state.status === 'ready' ? artistChildren(state.data.children) : []), [state]);
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(null);

  const selectedAlbum = useMemo(() => {
    if (albums.length === 0) return null;
    return albums.find((entry) => entry.album.id === selectedAlbumId) ?? albums[0] ?? null;
  }, [albums, selectedAlbumId]);

  if (state.status === 'loading' || state.status === 'idle') {
    return (
      <View style={[layout.appScreen, {alignItems: 'center', justifyContent: 'center'}]}>
        <ActivityIndicator size="large" color={colour.accent} />
        <Text style={[text.body, {color: colour.inkSoft, marginTop: sh(12)}]}>Loading artist details</Text>
      </View>
    );
  }

  if (state.status === 'error') {
    return (
      <View style={[layout.appScreen, {alignItems: 'center', justifyContent: 'center'}]}>
        <Text style={[text.subtitle, {color: colour.ink}]}>This artist could not be loaded</Text>
        <Text style={[text.body, {color: colour.inkSoft, marginTop: sh(8)}]}>{state.message}</Text>
      </View>
    );
  }

  // See WorkDetailScreen.tsx's identical guard: `useWorkDetail` never
  // actually reaches "empty" (no `isEmpty` option is passed internally),
  // but TypeScript's `AsyncState<WorkDetail>` still includes it.
  if (state.status === 'empty') {
    return (
      <View style={[layout.appScreen, {alignItems: 'center', justifyContent: 'center'}]}>
        <Text style={[text.subtitle, {color: colour.ink}]}>This artist could not be loaded</Text>
      </View>
    );
  }

  const artist: Work = state.data.work;
  const baseUrl = client.resolveUrl('/');

  return (
    <ScrollView style={layout.appScreen} showsVerticalScrollIndicator={false}>
      <Text style={[text.caption, {color: colour.stageKicker, textTransform: 'uppercase', letterSpacing: sw(2)}]}>
        Artist
      </Text>
      <Text style={[text.title, {color: colour.ink, marginTop: sh(4), marginBottom: sh(24)}]}>{artist.title}</Text>

      {albums.length === 0 ? (
        <Text style={[text.body, {color: colour.inkSoft}]}>No albums are available for this artist yet.</Text>
      ) : (
        <>
          <Text style={[text.subtitle, {color: colour.ink, marginBottom: sh(16)}]}>Albums</Text>
          <FlatList
            data={albums}
            horizontal
            keyExtractor={(entry) => entry.album.id}
            showsHorizontalScrollIndicator={false}
            style={{marginBottom: sh(28)}}
            renderItem={({item}) => (
              <AlbumCover
                album={item.album}
                artistWorkId={artist.id}
                baseUrl={baseUrl}
                accessToken={accessToken}
                selected={selectedAlbum?.album.id === item.album.id}
                onSelect={() => setSelectedAlbumId(item.album.id)}
              />
            )}
          />

          {selectedAlbum ? (
            <>
              <Text style={[text.subtitle, {color: colour.ink, marginBottom: sh(12)}]}>{selectedAlbum.album.title}</Text>
              {selectedAlbum.tracks.map((trackDetail, index) => (
                <TrackRow
                  key={trackDetail.track.id}
                  track={trackDetail.track}
                  index={index}
                  onPlay={
                    onPlay && trackDetail.media_file_id
                      ? () => onPlay(trackDetail.media_file_id as string)
                      : undefined
                  }
                />
              ))}
              {playableTracks(selectedAlbum).length === 0 ? (
                <Text style={[text.caption, {color: colour.inkMuted, marginTop: sh(8)}]}>
                  None of this album's tracks have finished syncing yet.
                </Text>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}
