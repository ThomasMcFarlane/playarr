/**
 * The title page for movies, series and sites, drawn at the web TV layout's measurements
 * (`clients/tv-web/web/src/pages/WorkDetail.tsx`): the stage with the key art, the header, the copy column on the left
 * (kicker, title, selected episode, meta, synopsis, actions) and the vertical stack of tracks on the right (chapters for a
 * film, a track per season for a series, then cast, crew and similar titles).
 *
 * Not on this platform: the Download button (the web shows it only where the device can download) and the playback-settings
 * drawer, which a later change adds.
 */
import React, {useCallback, useMemo, useState} from 'react';
import {Pressable, View} from 'react-native';
import type {CreditResponse, EpisodeDetail, MediaChapter, PlaylistResponse, ResumePlan, SeasonDetail, Work, WorkDetail} from '@playarr-tv/api-client';
import {useAsyncData, useWorkDetail} from '@playarr-tv/api-client/react';
import {useApiClient} from '../api/ApiClientProvider';
import {episodeArtworkUrl, mediaThumbnailUrl, preferredArtworkKind, workArtworkUrl} from '../api/artworkUrl';
import {useLanguage} from '../i18n/LanguageProvider';
import {ROUTES, type RouteName} from '../navigation/routes';
import {runtimeLabel} from '../lib/runtimeLabel';
import {snapshotFromWork, useWatchlistToggle} from '../lib/watchlist';
import {Icon} from '../shell/icons';
import {mix} from '../theme/color';
import {useTheme} from '../theme/ThemeProvider';
import {yearRangeLabel} from '../lib/workYear';
import {BalancedT, Box, T, u} from '../tv/kit';
import {FocusRing} from '../tv/FocusRing';
import {PageHeader} from '../tv/PageHeader';
import {Sheet, SheetOption} from '../tv/Sheet';
import {PlaybackSettingsDrawer, launchQuality} from './PlaybackSettingsDrawer';
import type {MediaPlaybackOptions} from '@playarr-tv/api-client';
import {RailFrost, Stage} from '../tv/Stage';
import {TrackStack, type Track} from '../tv/TrackStack';
import {useAccessToken} from './LibraryScreen';

// ----------------------------------------------------------------------------------------------- measurements

/** Where the first track's heading sits at rest, and where the focused track's heading sits. */
const REST_Y_MOVIE = 540;
const REST_Y_SERIES = 410;

// ----------------------------------------------------------------------------------------------- data helpers

type Navigate = (route: RouteName, params?: Record<string, unknown>) => void;

export interface WorkDetailScreenNavigation {
  navigate: Navigate;
}

export interface WorkDetailRouteParams {
  workId: string;
}

export interface PlayOptions {
  startPositionSeconds?: number;
  title?: string;
  /** The saved quality for the file: its id and the transcoding profile (`null` plays the original). */
  qualityId?: string;
  profile?: string | null;
}

export interface WorkDetailScreenProps {
  route: {params: WorkDetailRouteParams};
  navigation: WorkDetailScreenNavigation;
  /** Starts playback of a media file through the shell's player. */
  onPlay?: (mediaFileId: string, options?: PlayOptions) => void;
}

function seasonsOf(children: WorkDetail['children']): SeasonDetail[] {
  if (typeof children !== 'object' || children === null || !('Series' in children)) return [];
  return [...children.Series].sort((a, b) => a.season.season_number - b.season.season_number);
}

function playable(season: SeasonDetail): EpisodeDetail[] {
  return season.episodes.filter((episode) => episode.media_file_id != null);
}

const pad = (n: number): string => String(n).padStart(2, '0');

function formatClock(positionMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(positionMs / 1000));
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${totalMinutes}:${pad(seconds)}`;
}

function formatDetailDate(value: string, language: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : language, {day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'}).format(date);
}

function generatedChapters(runtimeMs: number): MediaChapter[] {
  if (runtimeMs <= 0) return [];
  const target = runtimeMs / 10;
  const options = [5, 10, 15, 20, 30].map((minutes) => minutes * 60_000);
  const interval = options.find((candidate) => candidate >= target) ?? options[options.length - 1]!;
  const count = Math.max(1, Math.ceil(runtimeMs / interval));
  return Array.from({length: count}, (_, index) => ({index, title: null, start_ms: index * interval, end_ms: Math.min(runtimeMs, (index + 1) * interval)}));
}

function groupCrew(credits: CreditResponse[], fallback: string): Array<{key: string; title: string; credits: CreditResponse[]}> {
  const groups = new Map<string, {key: string; title: string; credits: CreditResponse[]}>();
  for (const credit of credits) {
    const title = credit.department?.trim() || fallback;
    const key = title.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-') || 'crew';
    const existing = groups.get(key);
    if (existing) existing.credits.push(credit);
    else groups.set(key, {key, title, credits: [credit]});
  }
  return [...groups.values()];
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
}

function formatAverage(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h`;
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

// ----------------------------------------------------------------------------------------------- tracks

// ----------------------------------------------------------------------------------------------- screen

export function WorkDetailScreen({route, navigation, onPlay}: WorkDetailScreenProps): React.ReactElement {
  const client = useApiClient();
  const token = useAccessToken(client);
  const baseUrl = client.resolveUrl('/');
  const {t, language} = useLanguage();
  const {colour, scheme} = useTheme();
  const workId = route.params.workId;
  const state = useWorkDetail(client, workId);
  const credits = useAsyncData(() => client.getWorkCredits(workId), [client, workId]);
  const similar = useAsyncData(() => client.getSimilarWorks(workId), [client, workId]);
  const progressState = useAsyncData(() => client.listWatchProgress(), [client, workId]);
  const detailWork = state.status === 'ready' ? state.data.work : null;
  const isSeries = detailWork !== null && (detailWork.kind === 'series' || detailWork.kind === 'site');
  const plan = useAsyncData<ResumePlan | null>(() => client.getResumePlan(workId).catch(() => null), [client, workId], {enabled: isSeries});
  const movieMediaFileId = state.status === 'ready' ? state.data.media_file_id ?? null : null;
  const chapterState = useAsyncData(() => client.getMediaChapters(movieMediaFileId as string).catch(() => [] as MediaChapter[]), [client, movieMediaFileId], {
    enabled: movieMediaFileId !== null,
  });
  const availability = useAsyncData(() => client.getAvailabilityLag(workId).catch(() => null), [client, workId], {enabled: detailWork?.kind === 'series'});

  const progressRows = progressState.status === 'ready' ? progressState.data : null;
  const progressByMedia = useMemo(() => new Map((progressRows ?? []).map((row) => [row.media_file_id, row])), [progressRows]);

  const seasons = useMemo(() => (state.status === 'ready' ? seasonsOf(state.data.children) : []), [state]);
  const resumePlan = plan.status === 'ready' && plan.data && plan.data.series_work_id === workId && plan.data.target ? plan.data : null;

  const [selection, setSelection] = useState<{season: number; episode: string | null} | null>(null);
  const [focus, setFocus] = useState<{track: number; item: number} | null>(null);
  const [playlistSheet, setPlaylistSheet] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsFocused, setSettingsFocused] = useState(false);
  const [savedOptions, setSavedOptions] = useState<MediaPlaybackOptions | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const playbackOptions = useAsyncData<MediaPlaybackOptions>(() => client.getMediaPlaybackOptions(movieMediaFileId as string), [client, movieMediaFileId], {enabled: movieMediaFileId !== null});
  const effectiveOptions = savedOptions ?? (playbackOptions.status === 'ready' ? playbackOptions.data : null);

  const play = useCallback(
    (mediaFileId: string | null | undefined, options?: PlayOptions) => {
      if (mediaFileId && onPlay) onPlay(mediaFileId, options);
    },
    [onPlay],
  );

  const watchlist = useWatchlistToggle(client, detailWork ? snapshotFromWork(detailWork) : null);

  // ------------------------------------------------------------------------------------- loading and error pages
  if (state.status === 'loading' || state.status === 'idle' || (isSeries && (plan.status === 'loading' || plan.status === 'idle'))) {
    return (
      <Stage>
        <Box x={0} y={480} w={1920} style={{alignItems: 'center'}}>
          <T size={14} weight={500} color={colour.inkMuted}>
            {t('pages.workDetail.loadingDetails')}
          </T>
        </Box>
      </Stage>
    );
  }
  if (state.status === 'error' || state.status === 'empty') {
    return (
      <Stage>
        <PageHeader title={t('pages.workDetail.titleLoadError')} onBack={() => navigation.navigate(ROUTES.home)} />
      </Stage>
    );
  }

  const {work, runtime_ms: movieRuntimeMs} = state.data;
  const dark = scheme === 'dark';
  const episodic = work.kind === 'series' || work.kind === 'site';

  const resumeEpisodeId = resumePlan?.target?.episode_id ?? null;
  const resumeSeason = resumeEpisodeId ? seasons.find((season) => season.episodes.some((entry) => entry.episode.id === resumeEpisodeId)) : undefined;
  const activeSeason = (selection ? seasons.find((season) => season.season.season_number === selection.season) : resumeSeason) ?? seasons[0];
  const playableEpisodes = activeSeason ? playable(activeSeason) : [];
  const selectedEpisode = playableEpisodes.find((entry) => entry.episode.id === (selection?.episode ?? resumeEpisodeId)) ?? playableEpisodes[0];

  const playMediaFileId = work.kind === 'movie' ? movieMediaFileId : selectedEpisode?.media_file_id ?? null;
  const activeProgress = playMediaFileId ? progressByMedia.get(playMediaFileId) : undefined;
  const runtimeMs =
    work.kind === 'movie'
      ? movieRuntimeMs ?? activeProgress?.duration_ms
      : selectedEpisode?.runtime_ms ?? (selectedEpisode?.episode.runtime_minutes ? selectedEpisode.episode.runtime_minutes * 60_000 : activeProgress?.duration_ms);

  // ------------------------------------------------------------------------------------- copy column
  const seasonNumber = activeSeason?.season.season_number ?? 0;
  const code = selectedEpisode ? `S${pad(seasonNumber)} · E${pad(selectedEpisode.episode.episode_number)}` : null;
  const kicker = episodic && code ? code : work.genres[0] ?? (work.kind === 'movie' ? t('pages.workDetail.kindMovie') : t('pages.workDetail.kindSeries'));
  const episodeLabel = selectedEpisode ? selectedEpisode.episode.title ?? t('pages.workDetail.episodeNumber', {number: selectedEpisode.episode.episode_number}) : null;
  const seasonLabel = activeSeason ? activeSeason.season.title ?? t('pages.workDetail.seasonNumber', {number: seasonNumber}) : t('pages.workDetail.kindSeries');
  const overview = episodic ? selectedEpisode?.episode.overview ?? activeSeason?.season.overview ?? work.overview : work.overview;
  const dateValue = episodic ? selectedEpisode?.episode.air_date ?? work.release_date : work.release_date ?? work.added_at;
  const dateLabel =
    episodic && selectedEpisode?.episode.air_date
      ? t('pages.workDetail.dateAired')
      : work.release_date
        ? episodic
          ? t('pages.workDetail.datePremiered')
          : t('pages.workDetail.dateReleased')
        : t('pages.workDetail.dateAdded');
  const runtimeText =
    runtimeLabel(runtimeMs, t) ?? (playMediaFileId ? t('pages.workDetail.loadingRuntime') : t('pages.workDetail.runtimeUnavailable'));
  const year = yearRangeLabel(work);
  const dateText = dateValue ? formatDetailDate(dateValue, language) : null;
  const meta: Array<{key: string; text: string; lead?: boolean}> = [
    {key: 'lead', text: episodic ? seasonLabel : t('pages.workDetail.kindMovie'), lead: true},
    ...(episodic && code ? [{key: 'code', text: code}] : []),
    {key: 'runtime', text: runtimeText},
    ...(year ? [{key: 'year', text: year}] : []),
    ...(dateText ? [{key: 'date', text: `${dateLabel} ${dateText}`}] : []),
    ...work.genres.slice(0, 3).map((genre, index) => ({key: `g${index}`, text: genre})),
  ];
  const moviePlayLabel = activeProgress?.state === 'part_watched' ? t('pages.workDetail.resumeFrom', {position: formatClock(activeProgress.position_ms)}) : t('pages.workDetail.play');
  const resumeLabel = resumePlan
    ? t(resumePlan.action === 'start' ? 'pages.workDetail.startSeries' : resumePlan.action === 'restart' ? 'pages.workDetail.watchAgain' : 'pages.workDetail.resumeSeries')
    : null;
  const lag = availability.status === 'ready' ? availability.data : null;

  // ------------------------------------------------------------------------------------- tracks
  const tracks: Track[] = [];
  if (episodic) {
    for (const season of seasons) {
      const episodes = playable(season);
      if (episodes.length === 0) continue;
      tracks.push({
        id: `season-${season.season.id}`,
        title: season.season.title ?? t('pages.workDetail.seasonNumber', {number: season.season.season_number}),
        meta: t('pages.workDetail.episodesCount', {count: episodes.length}),
        items: episodes.map((entry) => {
          const number = entry.episode.episode_number;
          const hasStill = entry.episode.images.length > 0;
          return {
            id: entry.episode.id,
            art: hasStill ? episodeArtworkUrl(baseUrl, work.id, entry.episode.id, 'thumb') : entry.media_file_id ? mediaThumbnailUrl(baseUrl, entry.media_file_id) : undefined,
            badge: pad(number),
            small: `S${pad(season.season.season_number)} · E${pad(number)}`,
            title: entry.episode.title ?? t('pages.workDetail.episodeNumber', {number}),
            progress: entry.media_file_id ? progressByMedia.get(entry.media_file_id) : undefined,
            unseenDot: progressRows !== null && entry.media_file_id != null && !progressByMedia.has(entry.media_file_id),
            onFocus: () => setSelection({season: season.season.season_number, episode: entry.episode.id}),
            onPress: () => play(entry.media_file_id, {title: `${work.title} · ${entry.episode.title ?? ''}`}),
          };
        }),
      });
    }
  } else if (movieMediaFileId) {
    const real = chapterState.status === 'ready' ? chapterState.data : [];
    const chapters = real.length > 0 ? real : generatedChapters(movieRuntimeMs ?? 0);
    if (chapters.length > 0) {
      tracks.push({
        id: 'chapters',
        title: t('pages.workDetail.chaptersHeading'),
        meta: real.length > 0 ? t('pages.workDetail.chaptersCount', {count: chapters.length}) : t('pages.workDetail.sceneMarkersCount', {count: chapters.length}),
        items: chapters.map((chapter, index) => ({
          id: `chapter-${chapter.index}`,
          art: mediaThumbnailUrl(baseUrl, movieMediaFileId, chapter.start_ms),
          badge: pad(index + 1),
          small: formatClock(chapter.start_ms),
          title: chapter.title ?? t('pages.workDetail.chapterNumber', {number: index + 1}),
          onPress: () => play(movieMediaFileId, {startPositionSeconds: chapter.start_ms / 1000, title: work.title}),
        })),
      });
    }
  }
  const addPeople = (title: string, list: CreditResponse[], key: string): void => {
    if (list.length === 0) return;
    tracks.push({
      id: `people-${key}`,
      title,
      meta: list.length === 1 ? t('pages.workDetail.peopleCountOne', {count: list.length}) : t('pages.workDetail.peopleCountOther', {count: list.length}),
      items: list.map((credit) => {
        const headshot = credit.person.headshot_url;
        return {
          id: credit.id,
          art: headshot ? (headshot.startsWith('/') ? client.resolveUrl(headshot) : headshot) : undefined,
          initials: initials(credit.person.name),
          title: credit.person.name,
          small: credit.character?.trim() || credit.job?.trim() || credit.department?.trim() || undefined,
          stacked: true,
          person: true,
        };
      }),
    });
  };
  if (credits.status === 'ready') {
    addPeople(t('pages.workDetail.cast'), credits.data.cast, 'cast');
    if (!episodic) for (const group of groupCrew(credits.data.crew, t('pages.workDetail.crewFallback'))) addPeople(group.title, group.credits, group.key);
  }
  if (similar.status === 'ready' && similar.data.length > 0) {
    tracks.push({
      id: 'similar',
      title: t('pages.workDetail.similarTitlesHeading'),
      meta: similar.data.length === 1 ? t('pages.workDetail.titlesCountOne', {count: similar.data.length}) : t('pages.workDetail.titlesCountOther', {count: similar.data.length}),
      items: similar.data.map((entry: Work) => {
        const kind = preferredArtworkKind(entry, ['backdrop', 'poster']);
        return {
          id: entry.id,
          art: kind ? workArtworkUrl(baseUrl, entry.id, kind) : undefined,
          small: entry.kind === 'series' ? t('pages.home.workKind.series') : entry.kind === 'artist' ? t('pages.home.workKind.artist') : entry.kind === 'site' ? t('pages.home.workKind.site') : t('pages.home.workKind.movie'),
          title: entry.title,
          onPress: () => navigation.navigate(entry.kind === 'artist' ? ROUTES.musicDetail : ROUTES.workDetail, {workId: entry.id}),
        };
      }),
    });
  }

  const initialTrack = episodic && resumeEpisodeId ? tracks.findIndex((track) => track.items.some((item) => item.id === resumeEpisodeId)) : -1;
  const initialItem = initialTrack >= 0 ? tracks[initialTrack]!.items.findIndex((item) => item.id === resumeEpisodeId) : -1;
  const artKind = preferredArtworkKind(work, ['backdrop', 'poster']);
  const artUri = artKind ? workArtworkUrl(baseUrl, work.id, artKind) : undefined;
  const backLabel = work.kind === 'movie' ? t('shell.nav.movies') : work.kind === 'series' ? t('shell.nav.series') : t('pages.workDetail.kindSite');

  return (
    <DetailBody
      key={work.id}
      stageArt={artUri}
      token={token}
      dark={dark}
      header={<PageHeader title={backLabel} detail={work.title} onBack={() => navigation.navigate(ROUTES.home)} />}
      copy={
        <CopyColumn
          kicker={kicker}
          title={work.title}
          subtitle={episodic ? episodeLabel : null}
          meta={meta}
          availability={episodic ? lag : null}
          overview={overview ?? (episodic ? t('pages.workDetail.noEpisodeSynopsis') : t('pages.workDetail.noSynopsis'))}
          movieActions={
            work.kind === 'movie' ? (
              <PillRow top={37.8}>
                {playMediaFileId ? <Pill glyph={'\u2637'} label={t('pages.workDetail.playbackButtonLabel')} onPress={() => setSettingsOpen(true)} focusable={!settingsFocused} /> : null}
                {playMediaFileId ? (
                  <Pill primary glyph="play" label={moviePlayLabel} onPress={() => play(playMediaFileId, {title: work.title, ...launchQuality(effectiveOptions)})} hasTVPreferredFocus focusable={!settingsFocused} />
                ) : (
                  <Pill primary disabled label={t('pages.workDetail.unavailable')} />
                )}
              </PillRow>
            ) : null
          }
          actions={
            <PillRow top={12}>
              {resumePlan && resumeLabel ? (
                <Pill primary glyph="play" label={resumeLabel} onPress={() => play(resumePlan.target?.media_file_id, {title: work.title})} hasTVPreferredFocus={initialTrack < 0} />
              ) : null}
              <Pill
                glyph={watchlist.listed ? '✓' : '+'}
                label={watchlist.listed ? t('discovery.watchlist.remove') : t('discovery.watchlist.add')}
                disabled={watchlist.listed === null}
                onPress={watchlist.toggle}
              />
              <Pill glyph="+" label={t('components.mediaContextMenu.addToPlaylist')} onPress={() => setPlaylistSheet(true)} />
            </PillRow>
          }
        />
      }
      tracks={tracks}
      restY={episodic ? REST_Y_SERIES : REST_Y_MOVIE}
      focus={focus}
      onFocus={setFocus}
      initial={initialTrack >= 0 ? {track: initialTrack, item: initialItem} : null}
    >
      {settingsOpen && movieMediaFileId ? (
        <PlaybackSettingsDrawer
          mediaFileId={movieMediaFileId}
          options={effectiveOptions}
          state={playbackOptions.status === 'ready' ? {status: 'ready', options: playbackOptions.data} : playbackOptions.status === 'error' ? {status: 'error', message: playbackOptions.message} : {status: 'loading'}}
          onSaved={setSavedOptions}
          onClose={() => {
            setSettingsOpen(false);
            setSettingsFocused(false);
          }}
          onFocused={() => setSettingsFocused(true)}
        />
      ) : null}
      {playlistSheet ? (
        <PlaylistSheet
          workId={work.id}
          onClose={() => setPlaylistSheet(false)}
          onAdded={(name) => {
            setPlaylistSheet(false);
            setToast(name);
            setTimeout(() => setToast(null), 2200);
          }}
        />
      ) : null}
      {toast ? (
        <Box x={1490} y={40} w={400}>
          <T size={12} weight={640} color={colour.ink}>
            {toast}
          </T>
        </Box>
      ) : null}
    </DetailBody>
  );
}

// ----------------------------------------------------------------------------------------------- pieces

function CopyColumn(props: {
  kicker: string;
  title: string;
  subtitle: string | null;
  meta: Array<{key: string; text: string; lead?: boolean}>;
  availability: {average_seconds?: number | null} | null;
  overview: string;
  movieActions: React.ReactNode;
  actions: React.ReactNode;
}): React.ReactElement {
  const {colour} = useTheme();
  const {t} = useLanguage();
  return (
    <Box x={153.6} y={259.2} w={540}>
      <T size={12.288} weight={820} ls={0.983} lh={18.4} color="#cf3157" upper>
        {props.kicker}
      </T>
      <View style={{marginTop: u(25.9)}}>
        <BalancedT key={props.title} width={373.2} size={69.12} weight={560} ls={-4.9766} lh={62.2} color={colour.ink}>
          {props.title}
        </BalancedT>
      </View>
      {props.subtitle ? (
        <View style={{marginTop: u(19.5), width: u(304)}}>
          <T size={21.12} weight={570} ls={-0.7392} lh={24.3} color={colour.inkSoft} lines={1}>
            {props.subtitle}
          </T>
        </View>
      ) : null}
      <View style={{marginTop: u(27), marginBottom: u(-6.4), flexDirection: 'row', flexWrap: 'wrap', width: u(455)}}>
        {props.meta.map((entry) => (
          <View key={entry.key} style={{marginRight: u(13.6), marginBottom: u(6.4)}}>
            <T size={10.56} weight={entry.lead ? 680 : 400} lh={15.8} color={entry.lead ? colour.inkSoft : colour.inkMuted}>
              {entry.text}
            </T>
          </View>
        ))}
      </View>
      {props.availability && props.availability.average_seconds != null ? (
        <View style={{marginTop: u(6.5), width: u(455)}}>
          <T size={19.2} weight={640} lh={28.8} color={colour.ink}>
            {t('pages.workDetail.availabilityLag', {duration: formatAverage(props.availability.average_seconds)})}
          </T>
        </View>
      ) : null}
      <View style={{marginTop: u(21.6), width: u(324)}}>
        <T size={12.864} weight={400} lh={20.3} color={colour.inkMuted} lines={5}>
          {props.overview}
        </T>
      </View>
      {props.movieActions}
      {props.actions}
    </Box>
  );
}

function PillRow({top, children}: {top: number; children: React.ReactNode}): React.ReactElement {
  return <View style={{marginTop: u(top), flexDirection: 'row', alignItems: 'center'}}>{children}</View>;
}

/** The web's `.tv-detail-play` (primary) and `.tv-detail-download` (secondary) pills. */
function Pill({label, glyph, primary, disabled, onPress, hasTVPreferredFocus, focusable = true}: {label: string; glyph?: string; primary?: boolean; disabled?: boolean; onPress?: () => void; hasTVPreferredFocus?: boolean; focusable?: boolean}): React.ReactElement {
  const {colour} = useTheme();
  const [focused, setFocused] = useState(false);
  // Focus is the control ring only (owner rule; web .tv-detail-play keeps its ink fill when focused).
  const bg = primary ? colour.ink : mix(colour.surfaceStrong, 0.72);
  const fg = primary ? colour.bg : colour.ink;
  const glyphColour = primary ? fg : '#cf3157';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      focusable={focusable}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={{
        minWidth: u(primary ? 156 : 142),
        height: u(64),
        marginRight: u(16),
        paddingHorizontal: u(primary ? 21.6 : 16),
        borderRadius: 999,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: bg,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {focused ? <FocusRing /> : null}
      {glyph ? (
        <View style={{marginRight: u(primary ? 10.4 : 8.8)}}>
          {glyph === 'play' ? (
            <Icon name="play" size={u(10.1184)} color={glyphColour} />
          ) : (
            <T size={12.8064} weight={400} color={glyphColour}>
              {glyph}
            </T>
          )}
        </View>
      ) : null}
      <T size={primary ? 11.904 : 11.136} weight={700} color={fg}>
        {label}
      </T>
    </Pressable>
  );
}

function PlaylistSheet({workId, onClose, onAdded}: {workId: string; onClose: () => void; onAdded: (name: string) => void}): React.ReactElement {
  const client = useApiClient();
  const {t} = useLanguage();
  const {colour} = useTheme();
  const lists = useAsyncData<PlaylistResponse[]>(() => client.listPlaylists(), [client]);
  const [failed, setFailed] = useState(false);
  const own = lists.status === 'ready' ? lists.data.filter((list) => !list.is_system) : [];
  return (
    <Sheet title={t('components.mediaContextMenu.addToPlaylist')} onClose={onClose}>
      {own.map((list, index) => (
        <SheetOption
          key={list.id}
          label={list.name}
          hasTVPreferredFocus={index === 0}
          onPress={() => {
            client
              .addPlaylistItem(list.id, {work_id: workId})
              .then(() => onAdded(list.name))
              .catch(() => setFailed(true));
          }}
        />
      ))}
      {failed ? (
        <T size={12} weight={400} color={colour.accent}>
          {t('pages.workDetail.playbackOptionsLoadError')}
        </T>
      ) : null}
    </Sheet>
  );
}

// ----------------------------------------------------------------------------------------------- tracks view
function DetailBody(props: {
  stageArt?: string;
  token: string | undefined;
  dark: boolean;
  header: React.ReactNode;
  copy: React.ReactNode;
  tracks: Track[];
  restY: number;
  focus: {track: number; item: number} | null;
  onFocus: (focus: {track: number; item: number}) => void;
  initial: {track: number; item: number} | null;
  children?: React.ReactNode;
}): React.ReactElement {
  const {colour} = useTheme();
  return (
    <Stage artUri={props.stageArt} accessToken={props.token}>
      {props.header}
      {props.copy}
      <RailFrost dark={props.dark} soft={colour.surfaceSoft} strong={colour.surfaceStrong} />
      <TrackStack tracks={props.tracks} token={props.token} restY={props.restY} focus={props.focus} onFocus={props.onFocus} initial={props.initial} />
      {props.children}
    </Stage>
  );
}
