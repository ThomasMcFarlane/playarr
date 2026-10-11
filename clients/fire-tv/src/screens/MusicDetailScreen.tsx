/**
 * An artist's page at the web TV layout's measurements (`clients/tv-web/web/src/pages/MusicDetail.tsx`): the stage with the
 * artist's art, the selected album's copy on the left, a cover flow of the albums (the selected cover raised and the others
 * turned away, as the web's `perspective: 1200px` transforms do) and the selected album's track list below it.
 *
 * LEFT and RIGHT move through the albums, DOWN reaches the tracks. The cover flow here has no reflection filter or
 * brightness filter (Vega has neither): the covers beside the selected one are dimmed with a veil and the reflection is a
 * flipped copy under a gradient.
 */
import React, {useMemo, useRef, useState} from 'react';
import {Animated, Easing, Pressable, View} from 'react-native';
import type {Album, AlbumDetail, TrackDetail, WatchProgress, Work, WorkDetail} from '@playarr-tv/api-client';
import {useAsyncData, useWorkDetail} from '@playarr-tv/api-client/react';
import LinearGradient from '@amazon-devices/react-linear-gradient';
import {useApiClient} from '../api/ApiClientProvider';
import {albumArtworkUrl} from '../api/artworkUrl';
import {ArtworkImage} from '../components/ArtworkImage';
import {useLanguage} from '../i18n/LanguageProvider';
import type {RouteName} from '../navigation/routes';
import {mix} from '../theme/color';
import {useTheme} from '../theme/ThemeProvider';
import {EdgeFade} from '../tv/EdgeFade';
import {BalancedT, Box, T, u} from '../tv/kit';
import {PageHeader} from '../tv/PageHeader';
import {RailFrost, Stage} from '../tv/Stage';
import {stageArtUrl} from '../tv/ArtOfWork';
import {useScrollReveal} from '../tv/useScrollReveal';
import {useAccessToken} from './LibraryScreen';

/** Narrows `WorkDetailSchema.children` to its `Artist` variant. */
function artistChildren(children: WorkDetail['children']): AlbumDetail[] {
  return typeof children === 'object' && children !== null && 'Artist' in children ? children.Artist : [];
}

/** Only tracks with a resolved `MediaFile` (actually synced) are playable. */
function playableTracks(album: AlbumDetail): TrackDetail[] {
  return album.tracks.filter((track) => track.media_file_id != null);
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return '';
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}:${String(rest).padStart(2, '0')}`;
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
  /** Starts playback of a track's media file through the shell's player. */
  onPlay?: (mediaFileId: string) => void;
}

// ---------------------------------------------------------------------------------------------------- measurements
const FLOW_CENTRE_X = 1324.9;
const FLOW_CENTRE_Y = 307.5;
const CARD = 260;
const TRACK_X = 783.8;
const TRACK_W = 1081.9;
const TRACK_Y = 749.2;
const TRACK_H = 56.2;
const TRACK_PITCH = 63.2;
const TRACKS_CLIP_TOP = 735;

/** Places from `selected` to `index` going the short way round the albums (the flow wraps, as the web's does). */
export function circularOffset(index: number, selected: number, count: number): number {
  if (count <= 1) return 0;
  const forward = (index - selected + count) % count;
  const backward = forward - count;
  return Math.abs(forward) <= Math.abs(backward) ? forward : backward;
}

/** The web's `--music-flow-*` numbers for a cover `offset` places from the selected one. */
export function flowPlacement(offset: number): {x: number; rotate: number; scale: number; z: number} {
  const distance = Math.abs(offset);
  return {
    x: offset * 0.61 * CARD,
    rotate: offset === 0 ? 0 : offset < 0 ? 55 : -55,
    scale: offset === 0 ? 1.12 : Math.max(0.7, 0.91 - distance * 0.055),
    z: offset === 0 ? 40 : Math.max(1, 20 - distance),
  };
}

export function MusicDetailScreen({route, navigation, onPlay}: MusicDetailScreenProps): React.ReactElement {
  const client = useApiClient();
  const accessToken = useAccessToken(client);
  const {colour, scheme} = useTheme();
  const {t} = useLanguage();
  const workId = route.params.workId;
  const state = useWorkDetail(client, workId);
  const progress = useAsyncData<WatchProgress[]>(() => client.listWatchProgress().catch(() => [] as WatchProgress[]), [client]);
  const albums = useMemo(() => (state.status === 'ready' ? artistChildren(state.data.children).filter((entry) => playableTracks(entry).length > 0) : []), [state]);
  const [albumIndex, setAlbumIndex] = useState(0);
  const [trackIndex, setTrackIndex] = useState(0);
  const selectedAlbum = albums[Math.min(albumIndex, Math.max(0, albums.length - 1))] ?? null;
  const tracks = selectedAlbum ? playableTracks(selectedAlbum) : [];
  const trackRows = useRef(new Map<string, number>()).current;
  const tracksScroll = useScrollReveal({viewport: 1080 - TRACKS_CLIP_TOP, content: tracks.length * TRACK_PITCH + 40, margin: 14});
  const progressByMedia = useMemo(() => new Map((progress.status === 'ready' ? progress.data : []).map((row) => [row.media_file_id, row])), [progress]);
  const dark = scheme === 'dark';

  if (state.status !== 'ready') {
    return (
      <Stage>
        <PageHeader title={t('pages.musicDetail.music')} onBack={() => navigation.navigate('home' as RouteName)} />
        <Box x={783} y={200} w={700}>
          <T size={17} weight={610} color={colour.ink}>
            {state.status === 'error' ? t('pages.musicDetail.loadErrorTitle') : t('pages.musicDetail.loadingArtistDetails')}
          </T>
        </Box>
      </Stage>
    );
  }

  const artist: Work = state.data.work;
  const baseUrl = client.resolveUrl('/');
  const selectedTrack = tracks[trackIndex] ?? tracks[0] ?? null;
  const albumMeta = selectedAlbum
    ? [artist.title, albumLabel(selectedAlbum.album), `${tracks.length} ${tracks.length === 1 ? t('pages.musicDetail.trackSingular') : t('pages.musicDetail.trackPlural')}`, ...artist.genres.slice(0, 3)].filter(Boolean)
    : [];

  return (
    <Stage artUri={stageArtUrl(baseUrl, artist)} accessToken={accessToken}>
      <PageHeader title={t('pages.musicDetail.music')} detail={artist.title} onBack={() => navigation.navigate('music' as RouteName)} />
      <RailFrost dark={dark} soft={colour.surfaceSoft} strong={colour.surfaceStrong} x={776} />
      {selectedAlbum ? (
        <Box x={153.6} y={259.2} w={540}>
          <T size={12.288} weight={820} ls={0.983} lh={18.4} color="#cf3157" upper>
            {selectedAlbum.album.album_type.replace(/_/g, ' ')}
          </T>
          <View style={{marginTop: u(25.9)}}>
            <BalancedT key={selectedAlbum.album.id} width={373.2} size={69.12} weight={560} ls={-4.9766} lh={62.2} color={colour.ink}>
              {selectedAlbum.album.title}
            </BalancedT>
          </View>
          <View style={{marginTop: u(27), flexDirection: 'row', flexWrap: 'wrap', width: u(455)}}>
            {albumMeta.map((entry, index) => (
              <View key={`${index}:${entry}`} style={{marginRight: u(13.6)}}>
                <T size={10.56} weight={index === 0 ? 680 : 400} lh={15.8} color={index === 0 ? colour.inkSoft : colour.inkMuted}>
                  {entry}
                </T>
              </View>
            ))}
          </View>
          {selectedTrack ? (
            <View style={{marginTop: u(21.6), width: u(304)}}>
              <T size={21.12} weight={570} ls={-0.7392} lh={24.3} color={colour.inkSoft} lines={2}>
                {`${selectedTrack.track.title}${formatDuration(selectedTrack.track.duration_seconds) ? ` · ${formatDuration(selectedTrack.track.duration_seconds)}` : ''}`}
              </T>
            </View>
          ) : null}
          <View style={{marginTop: u(21.6), width: u(324)}}>
            <T size={12.864} weight={400} lh={20.3} color={colour.inkMuted}>
              {artist.overview ?? t('pages.musicDetail.overviewFallback')}
            </T>
          </View>
        </Box>
      ) : (
        <Box x={153.6} y={259.2} w={540}>
          <T size={12.864} weight={400} lh={20.3} color={colour.inkMuted}>
            {t('pages.musicDetail.noAlbumsTitle')}
          </T>
        </Box>
      )}

      {albums.map((entry, index) => {
        const offset = circularOffset(index, albumIndex, albums.length);
        if (Math.abs(offset) > 4) return null;
        return (
          <FlowCover
            key={entry.album.id}
            entry={entry}
            artistId={artist.id}
            baseUrl={baseUrl}
            token={accessToken}
            offset={offset}
            selected={offset === 0}
            onFocus={() => {
              setAlbumIndex(index);
              setTrackIndex(0);
            }}
            onPress={() => {
              const first = playableTracks(entry)[0];
              if (first?.media_file_id && onPlay) onPlay(first.media_file_id);
            }}
          />
        );
      })}

      {selectedAlbum ? (
        <>
          <Box x={TRACK_X - 6} y={TRACKS_CLIP_TOP} w={TRACK_W + 12} h={1080 - TRACKS_CLIP_TOP} style={{overflow: 'hidden'}} pointerEvents="box-none">
            <Animated.View style={{position: 'absolute', left: u(6), top: Animated.add(new Animated.Value(u(TRACK_Y - TRACKS_CLIP_TOP)), tracksScroll.offset), width: u(TRACK_W)}} pointerEvents="box-none">
              {tracks.map((trackDetail, index) => (
                <TrackRow
                  key={trackDetail.track.id}
                  number={index + 1}
                  title={trackDetail.track.title}
                  duration={formatDuration(trackDetail.track.duration_seconds)}
                  y={index * TRACK_PITCH}
                  selected={index === trackIndex}
                  unseen={progress.status === 'ready' && !progressByMedia.has(trackDetail.media_file_id as string)}
                  onFocus={() => {
                    setTrackIndex(index);
                    trackRows.set(trackDetail.track.id, index);
                    tracksScroll.reveal(index * TRACK_PITCH, TRACK_H);
                  }}
                  onPress={() => {
                    if (trackDetail.media_file_id && onPlay) onPlay(trackDetail.media_file_id);
                  }}
                />
              ))}
            </Animated.View>
          </Box>
          <EdgeFade side="top" active={tracksScroll.scrolled > 0} x={TRACK_X - 6} y={TRACKS_CLIP_TOP} w={TRACK_W + 12} h={1080 - TRACKS_CLIP_TOP} />
          <EdgeFade side="bottom" active={tracksScroll.scrolled < tracksScroll.max - 1} x={TRACK_X - 6} y={TRACKS_CLIP_TOP} w={TRACK_W + 12} h={1080 - TRACKS_CLIP_TOP} />
        </>
      ) : null}
    </Stage>
  );
}

/** One cover of the flow: turned and scaled by its distance from the selected one; the selected cover carries its caption. */
function FlowCover({entry, artistId, baseUrl, token, offset, selected, onFocus, onPress}: {entry: AlbumDetail; artistId: string; baseUrl: string; token: string | undefined; offset: number; selected: boolean; onFocus: () => void; onPress: () => void}): React.ReactElement {
  const {colour, scheme} = useTheme();
  const place = flowPlacement(offset);
  const kind = entry.album.images.some((image) => image.kind === 'poster') ? 'poster' : 'thumb';
  const uri = albumArtworkUrl(baseUrl, artistId, entry.album.id, kind as 'poster');
  const [focused, setFocused] = useState(false);
  const slide = useRef(new Animated.Value(offset)).current;
  const last = useRef(offset);
  if (last.current !== offset) {
    last.current = offset;
    Animated.timing(slide, {toValue: offset, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: false}).start();
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={entry.album.title}
      hasTVPreferredFocus={selected}
      onFocus={() => {
        setFocused(true);
        onFocus();
      }}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={{
        position: 'absolute',
        left: u(FLOW_CENTRE_X - CARD / 2),
        top: u(FLOW_CENTRE_Y - CARD / 2),
        width: u(CARD),
        height: u(CARD),
        zIndex: place.z,
        transform: [{perspective: u(1200)}, {translateX: u(place.x)}, {rotateY: `${place.rotate}deg`}, {scale: place.scale}],
      }}
    >
      <View style={{width: u(CARD), height: u(CARD), borderRadius: u(12.48), overflow: 'hidden', backgroundColor: colour.surfaceSoft}}>
        <ArtworkImage uri={uri} accessToken={token} style={{width: '100%', height: '100%'}} resizeMode="cover" />
        {selected ? null : <View pointerEvents="none" style={{position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: scheme === 'dark' ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.22)'}} />}
      </View>
      {/* The reflection: the cover's lower half, flipped, fading out. */}
      <View pointerEvents="none" style={{position: 'absolute', left: 0, top: u(CARD + 8), width: u(CARD), height: u(CARD * 0.42), overflow: 'hidden', borderRadius: u(12.48)}}>
        <View style={{width: u(CARD), height: u(CARD), transform: [{scaleY: -1}]}}>
          <ArtworkImage uri={uri} accessToken={token} style={{width: '100%', height: '100%'}} resizeMode="cover" />
        </View>
        <LinearGradient style={{position: 'absolute', left: 0, top: 0, right: 0, bottom: 0}} start={{x: 0, y: 0}} end={{x: 0, y: 1}} colors={[mix(colour.surface, 0.74), colour.surface]} />
      </View>
      {selected ? (
        <View style={{position: 'absolute', left: 0, top: u(CARD + 8), width: u(CARD), alignItems: 'center'}}>
          <T size={11.52} weight={610} ls={-0.1728} lh={19.3} color={colour.ink} lines={1}>
            {entry.album.title}
          </T>
          <T size={8.832} weight={700} lh={14.8} color={colour.inkMuted}>
            {albumLabel(entry.album)}
          </T>
        </View>
      ) : null}
      {focused ? <View pointerEvents="none" style={{position: 'absolute', left: u(-3), top: u(-3), width: u(CARD + 6), height: u(CARD * 1.58), borderWidth: u(2.7), borderColor: colour.ink}} /> : null}
    </Pressable>
  );
}

function TrackRow({number, title, duration, y, selected, unseen, onFocus, onPress}: {number: number; title: string; duration: string; y: number; selected: boolean; unseen: boolean; onFocus: () => void; onPress: () => void}): React.ReactElement {
  const {colour} = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onFocus={() => {
        setFocused(true);
        onFocus();
      }}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={{position: 'absolute', left: 0, top: u(y), width: u(TRACK_W), height: u(TRACK_H), borderRadius: u(10.56), backgroundColor: mix(colour.surfaceStrong, 0.68), borderWidth: focused ? u(2) : 0, borderColor: colour.ink, justifyContent: 'center'}}
    >
      <View style={{position: 'absolute', left: u(22)}}>
        <T size={9.6} weight={400} lh={14.4} color={colour.inkMuted}>
          {String(number).padStart(2, '0')}
        </T>
      </View>
      <View style={{position: 'absolute', left: u(84), width: u(942)}}>
        <T size={11.136} weight={610} lh={16.7} color={colour.ink} lines={1}>
          {title}
        </T>
      </View>
      <View style={{position: 'absolute', right: u(41)}}>
        <T size={9.6} weight={400} lh={14.4} color={colour.inkMuted}>
          {duration}
        </T>
      </View>
      {unseen ? <View style={{position: 'absolute', right: u(15), top: u(23.2), width: u(9), height: u(9), borderRadius: 999, backgroundColor: '#cf3157'}} /> : null}
      {selected && !focused ? <View pointerEvents="none" style={{position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, borderRadius: u(10.56), borderWidth: 1, borderColor: colour.lineStrong}} /> : null}
    </Pressable>
  );
}
