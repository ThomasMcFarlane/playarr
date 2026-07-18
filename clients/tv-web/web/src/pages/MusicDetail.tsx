import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useOutletContext,
  useParams,
} from "react-router-dom";
import {
  type AlbumDetail,
  type TrackDetail,
  type WatchProgress,
  type WorkChildren,
} from "@streamarr-tv/api-client";
import { useWorkDetail } from "@streamarr-tv/api-client/react";
import { useMediaContextMenu } from "../components/MediaContextMenu";
import { MediaThumbnailArtwork } from "../components/MediaThumbnailArtwork";
import { ServerChoiceModal } from "../components/ServerChoiceModal";
import {
  MusicVisualiserBars,
  type PlayerPlaylistItem,
} from "../components/player/PlayerSurface";
import { TvEmptyState } from "../components/tv/TvEmptyState";
import {
  TvDetailHeading,
  TvRailSurface,
  TvStageShell,
} from "../components/tv/TvStage";
import { WatchStateOverlay } from "../components/WatchStateOverlay";
import { useApiClient } from "../lib/ApiClientProvider";
import { CachedAlbumArtworkImage, CachedArtworkImage } from "../lib/artwork";
import { useLanguage } from "../lib/i18n/LanguageProvider";
import type { TranslationKey } from "../lib/i18n/translations";
import {
  navigationOriginFromState,
  useNavigationLayer,
  type NavigationOrigin,
} from "../lib/navigationLayer";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import { useScrollEdges } from "../lib/useScrollEdges";
import {
  getJoinedWorkSources,
  type JoinedWorkSource,
} from "../lib/joinedServers";
import type { AppShellOutletContext } from "../App";

function artistChildren(children: WorkChildren): AlbumDetail[] {
  return typeof children === "object" && children !== null && "Artist" in children
    ? children.Artist
    : [];
}

function playableTracks(album: AlbumDetail): TrackDetail[] {
  return album.tracks.filter((track) => track.media_file_id != null);
}

function formatDuration(
  seconds: number | null | undefined,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
): string {
  if (!seconds || seconds <= 0) return t("pages.musicDetail.durationUnavailable");
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function albumLabel(album: AlbumDetail): string {
  return album.album.release_date
    ? String(new Date(album.album.release_date).getUTCFullYear())
    : album.album.album_type.replace("_", " ");
}

function circularOffset(index: number, selectedIndex: number, count: number): number {
  if (count <= 1) return 0;
  const forward = (index - selectedIndex + count) % count;
  const backward = forward - count;
  return Math.abs(forward) <= Math.abs(backward) ? forward : backward;
}

function AlbumCoverFlow({
  albums,
  artistId,
  selectedAlbumId,
  playingAlbumId,
  parentRoute,
  onSelect,
  onPlay,
}: {
  albums: AlbumDetail[];
  artistId: string;
  selectedAlbumId: string;
  playingAlbumId: string | null;
  parentRoute: string;
  onSelect: (album: AlbumDetail) => void;
  onPlay: (album: AlbumDetail, track: TrackDetail) => void;
}) {
  const { t } = useLanguage();
  const mediaContext = useMediaContextMenu();
  const selectedIndex = Math.max(
    0,
    albums.findIndex((album) => album.album.id === selectedAlbumId)
  );
  const moveSelection = (
    event: KeyboardEvent<HTMLButtonElement>,
    direction: -1 | 1
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const nextIndex = (selectedIndex + direction + albums.length) % albums.length;
    document
      .getElementById(`music-album-${albums[nextIndex]!.album.id}`)
      ?.focus({ preventScroll: true });
  };

  return (
    <section
      className="tv-music-album-flow"
      aria-label={t("pages.musicDetail.albums")}
    >
      <div className="tv-music-album-cover-flow">
        {albums.map((album, index) => {
          const firstTrack = playableTracks(album)[0];
          if (!firstTrack?.media_file_id) return null;
          const isSelected = album.album.id === selectedAlbumId;
          const isPlaying = album.album.id === playingAlbumId;
          const offset = circularOffset(index, selectedIndex, albums.length);
          const distance = Math.abs(offset);
          const flowStyle = {
            "--music-flow-x": `${offset * 61}%`,
            "--music-flow-rotate": `${offset === 0 ? 0 : offset < 0 ? 55 : -55}deg`,
            "--music-flow-scale": String(
              offset === 0 ? 1.12 : Math.max(0.7, 0.91 - distance * 0.055)
            ),
            "--music-flow-z": String(offset === 0 ? 40 : Math.max(1, 20 - distance)),
          } as CSSProperties;
          const contextProps = mediaContext.itemProps({
            workId: artistId,
            title: album.album.title,
            detailRoute: `/music/${artistId}`,
            parentRoute,
            preferredMediaFileId: firstTrack.media_file_id,
            playlistTrackIds: playableTracks(album).map(
              (track) => track.track.id
            ),
            leaves: playableTracks(album).flatMap((track) =>
              track.media_file_id
                ? [
                    {
                      mediaFileId: track.media_file_id,
                      runtimeMs:
                        track.runtime_ms ??
                        (track.track.duration_seconds ?? 0) * 1_000,
                      title: track.track.title,
                    },
                  ]
                : []
            ),
            activateOrigin: true,
            onPlay: () => onPlay(album, firstTrack),
          });

          return (
            <button
              key={album.album.id}
              id={`music-album-${album.album.id}`}
              type="button"
              className={`tv-title-card tv-music-album-card${
                isSelected ? " is-selected" : ""
              }${isPlaying ? " is-playing" : ""}${distance > 4 ? " is-distant" : ""}`}
              style={flowStyle}
              data-tv-focus-default={isSelected ? true : undefined}
              data-navigation-focus-key={`music:${artistId}:album:${album.album.id}`}
              data-tv-edge-target-down="#inline-music-scrubber-control"
              aria-pressed={isSelected}
              aria-label={t("pages.musicDetail.play", { title: album.album.title })}
              {...contextProps}
              onKeyDown={(event) => {
                contextProps.onKeyDown(event);
                if (event.defaultPrevented) return;
                if (event.key === "ArrowLeft") moveSelection(event, -1);
                else if (event.key === "ArrowRight") moveSelection(event, 1);
                else if (event.key === "ArrowDown") {
                  event.preventDefault();
                  event.stopPropagation();
                  const nextTarget =
                    document.getElementById("inline-music-scrubber-control") ??
                    document.querySelector<HTMLElement>(
                      ".tv-music-track-row.is-selected"
                    ) ??
                    document.querySelector<HTMLElement>(".tv-music-track-row");
                  nextTarget?.focus({ preventScroll: true });
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  event.stopPropagation();
                }
              }}
              onFocus={() => onSelect(album)}
              onMouseEnter={() => onSelect(album)}
              onClick={() => {
                onSelect(album);
                onPlay(album, firstTrack);
              }}
            >
              <span className="tv-title-card-art">
                <CachedAlbumArtworkImage
                  artistWorkId={artistId}
                  album={album.album}
                  kinds={["poster"]}
                  loading="lazy"
                  alt=""
                  fallback={
                    <MediaThumbnailArtwork
                      mediaFileId={firstTrack.media_file_id}
                      positionMs={0}
                      fallback={null}
                      className="tv-music-album-art-fallback"
                    />
                  }
                />
                {isPlaying ? (
                  <span
                    className="tv-music-cover-visualiser-host"
                    data-music-visualiser-host
                    aria-hidden="true"
                  >
                    <MusicVisualiserBars />
                  </span>
                ) : null}
              </span>
              <span className="tv-title-card-copy">
                <strong>{album.album.title}</strong>
                <small>{albumLabel(album)}</small>
              </span>
            </button>
          );
        })}
      </div>
      {mediaContext.contextMenu}
    </section>
  );
}

function AlbumTrackList({
  album,
  artistId,
  detailRoute,
  detailParentBackTo,
  playlistItems,
  selectedTrackId,
  progressByMedia,
  navigationOrigin,
  detailNavigationOrigin,
  onSelect,
  onProgressChanged,
  onNavigate,
  onPlay,
}: {
  album: AlbumDetail;
  artistId: string;
  detailRoute: string;
  detailParentBackTo: string;
  playlistItems: PlayerPlaylistItem[];
  selectedTrackId: string | null;
  progressByMedia: Map<string, WatchProgress>;
  navigationOrigin: NavigationOrigin;
  detailNavigationOrigin: NavigationOrigin | null;
  onSelect: (albumId: string, trackId: string) => void;
  onProgressChanged: (workId: string, progress: WatchProgress[]) => void;
  onNavigate: ReturnType<typeof useNavigationLayer>["captureLink"];
  onPlay: (album: AlbumDetail, track: TrackDetail) => void;
}) {
  const { t } = useLanguage();
  const tracks = playableTracks(album);
  const trackListRef = useRef<HTMLDivElement>(null);
  const scrollEdges = useScrollEdges(
    trackListRef,
    "vertical",
    `${album.album.id}:${tracks.length}`
  );
  const mediaContext = useMediaContextMenu({ onProgressChanged });

  return (
    <section
      className="tv-music-track-list"
      aria-label={t("pages.musicDetail.albumTracksAriaLabel", { title: album.album.title })}
    >
      <div
        className={`tv-scroll-edge-window tv-music-track-list-window${
          scrollEdges.start ? " can-scroll-up" : ""
        }${scrollEdges.end ? " can-scroll-down" : ""}`}
      >
        <div
          ref={trackListRef}
          className="tv-music-track-list-scroll"
          data-tv-scroll-container
          data-tv-scroll-axis="vertical"
          data-navigation-scroll-key={`music:${artistId}:album:${album.album.id}`}
        >
          {tracks.map((track, index) => {
            const mediaFileId = track.media_file_id;
            if (!mediaFileId) return null;
            const progress = progressByMedia.get(mediaFileId);
            const contextProps = mediaContext.itemProps({
              workId: artistId,
              title: track.track.title,
              detailRoute,
              parentRoute: detailParentBackTo,
              progress,
              preferredMediaFileId: mediaFileId,
              playlistTrackId: track.track.id,
              leaves: [
                {
                  mediaFileId,
                  runtimeMs:
                    track.runtime_ms ?? (track.track.duration_seconds ?? 0) * 1_000,
                  title: track.track.title,
                },
              ],
              activateOrigin: true,
              onPlay: () => onPlay(album, track),
            });
            return (
              <Link
                key={track.track.id}
                id={`music-track-${track.track.id}`}
                to={`/player/${mediaFileId}`}
                state={{
                  title: track.track.title,
                  backTo: detailRoute,
                  detailParentBackTo,
                  mediaFileId,
                  playlistItems,
                  navigationOrigin,
                  detailNavigationOrigin,
                }}
                className={`tv-music-track-row${
                  selectedTrackId === track.track.id ? " is-selected" : ""
                }`}
                data-navigation-focus-key={`music:${artistId}:track:${track.track.id}`}
                data-tv-edge-target-up={
                  index === 0 ? "#inline-music-playback-control" : undefined
                }
                onFocus={() => onSelect(album.album.id, track.track.id)}
                onMouseEnter={() => onSelect(album.album.id, track.track.id)}
                onClick={(event) => {
                  event.preventDefault();
                  onNavigate(event);
                  onPlay(album, track);
                }}
                aria-label={t("pages.musicDetail.play", { title: track.track.title })}
                {...contextProps}
                onKeyDown={(event) => {
                  contextProps.onKeyDown(event);
                  if (event.defaultPrevented || event.key !== "ArrowUp" || index !== 0) {
                    return;
                  }
                  event.preventDefault();
                  event.stopPropagation();
                  const previousTarget =
                    document.getElementById("inline-music-playback-control") ??
                    document.querySelector<HTMLElement>(
                      ".tv-music-album-card.is-selected"
                    );
                  previousTarget?.focus({ preventScroll: true });
                }}
              >
                <span className="tv-music-track-row-number" aria-hidden="true">
                  {String(track.track.track_number).padStart(2, "0")}
                </span>
                <strong>{track.track.title}</strong>
                <span className="tv-music-track-row-duration">
                  {formatDuration(track.track.duration_seconds, t)}
                </span>
                <WatchStateOverlay progress={progress} showUnwatched />
              </Link>
            );
          })}
        </div>
      </div>
      {mediaContext.contextMenu}
    </section>
  );
}

export function MusicDetailPage() {
  const { workId } = useParams<{ workId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { activePlayerSession, startPlayerSession } =
    useOutletContext<AppShellOutletContext>();
  const { t } = useLanguage();
  const client = useApiClient();
  const state = useWorkDetail(client, workId);
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(null);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const restoredMediaFileIdRef = useRef<string | null>(null);
  const [progressByMedia, setProgressByMedia] = useState<Map<string, WatchProgress>>(
    new Map()
  );
  const navigationState = location.state as {
    backTo?: unknown;
    mediaFileId?: unknown;
    navigationOrigin?: unknown;
  } | null;
  const parentNavigationOrigin = navigationOriginFromState(navigationState);
  const requestedBackTo = navigationState?.backTo;
  const requestedMediaFileId =
    typeof navigationState?.mediaFileId === "string"
      ? navigationState.mediaFileId
      : null;
  const playingMediaFileId =
    activePlayerSession?.locationState?.backTo === `/music/${workId ?? ""}`
      ? activePlayerSession.mediaFileId
      : null;
  const backTo =
    typeof requestedBackTo === "string" &&
    (requestedBackTo === "/" ||
      requestedBackTo === "/music" ||
      /^\/search(?:\?.*)?$/.test(requestedBackTo))
      ? requestedBackTo
      : "/music";

  const albums = useMemo(
    () =>
      state.status === "ready"
        ? artistChildren(state.data.children).filter(
            (album) => playableTracks(album).length > 0
          )
        : [],
    [state]
  );
  const allTracks = useMemo(
    () =>
      albums.flatMap((album) =>
        playableTracks(album).map((track) => ({ album, track }))
    ),
    [albums]
  );
  const requestedSelectionMediaFileId =
    requestedMediaFileId ?? playingMediaFileId;
  const requestedSelection = requestedSelectionMediaFileId
    ? allTracks.find(
        ({ track }) => track.media_file_id === requestedSelectionMediaFileId
      ) ??
      null
    : null;
  const playingAlbumId = playingMediaFileId
    ? allTracks.find(({ track }) => track.media_file_id === playingMediaFileId)?.album
        .album.id ?? null
    : null;
  const selectedAlbum =
    albums.find((album) => album.album.id === selectedAlbumId) ??
    requestedSelection?.album ??
    albums[0] ??
    null;
  const selectedAlbumTracks = selectedAlbum ? playableTracks(selectedAlbum) : [];
  const selectedTrack =
    selectedAlbumTracks.find((track) => track.track.id === selectedTrackId) ??
    (requestedSelection &&
    requestedSelection.album.album.id === selectedAlbum?.album.id
      ? requestedSelection.track
      : null) ??
    selectedAlbumTracks[0] ??
    null;
  const artistWork = state.status === "ready" ? state.data.work : null;
  const workSources = artistWork ? getJoinedWorkSources(artistWork.id) : [];
  const [pendingServerTrack, setPendingServerTrack] = useState<{
    album: AlbumDetail;
    track: TrackDetail;
  } | null>(null);
  const buildPlaylistItems = useCallback(
    (album: AlbumDetail): PlayerPlaylistItem[] =>
      playableTracks(album).flatMap((track) =>
        track.media_file_id
          ? [
              {
                mediaFileId: track.media_file_id,
                title: track.track.title,
                subtitle: `${artistWork?.title ?? ""} · ${album.album.title}`,
                music:
                  artistWork
                    ? {
                        artistName: artistWork.title,
                        albumTitle: album.album.title,
                        artworkWork: {
                          id: artistWork.id,
                          images: artistWork.images,
                        },
                      }
                    : undefined,
              },
            ]
          : []
      ),
    [artistWork]
  );
  const playlistItems = useMemo<PlayerPlaylistItem[]>(
    () => (selectedAlbum ? buildPlaylistItems(selectedAlbum) : []),
    [buildPlaylistItems, selectedAlbum]
  );
  const navigationLayer = useNavigationLayer(
    `${workId ?? "music"}:${allTracks
      .map(({ track }) => track.track.id)
      .join(",")}`,
    state.status === "ready"
  );
  const playTrack = useCallback(
    (album: AlbumDetail, track: TrackDetail) => {
      if (!track.media_file_id || !artistWork) return;
      setSelectedAlbumId(album.album.id);
      setSelectedTrackId(track.track.id);
      if (workSources.length > 1) {
        setPendingServerTrack({ album, track });
        return;
      }
      startPlayerSession({
        mediaFileId: track.media_file_id,
        locationState: {
          serverUrl: workSources[0]?.url,
          title: track.track.title,
          backTo: `/music/${artistWork.id}`,
          detailParentBackTo: backTo,
          mediaFileId: track.media_file_id,
          playlistItems: buildPlaylistItems(album),
          navigationOrigin: navigationLayer.origin,
          detailNavigationOrigin: parentNavigationOrigin,
        },
      });
    },
    [
      artistWork,
      backTo,
      buildPlaylistItems,
      navigationLayer.origin,
      parentNavigationOrigin,
      startPlayerSession,
      workSources,
    ]
  );

  const chooseMusicServer = useCallback(
    async (source: JoinedWorkSource) => {
      if (!pendingServerTrack) return;
      const detail = await source.client.getWork(source.work.id);
      const sourceAlbums = artistChildren(detail.children);
      const album = sourceAlbums.find(
        (candidate) =>
          candidate.album.title.trim().toLocaleLowerCase() ===
            pendingServerTrack.album.album.title.trim().toLocaleLowerCase() &&
          (candidate.album.release_date?.slice(0, 10) ?? "") ===
            (pendingServerTrack.album.album.release_date?.slice(0, 10) ?? "")
      );
      const track = album?.tracks.find(
        (candidate) =>
          candidate.track.track_number === pendingServerTrack.track.track.track_number ||
          candidate.track.title.trim().toLocaleLowerCase() ===
            pendingServerTrack.track.track.title.trim().toLocaleLowerCase()
      );
      if (!album || !track?.media_file_id) {
        throw new Error(t("pages.musicDetail.serverMissingTrack"));
      }
      const sourcePlaylist = playableTracks(album).map((candidate) => ({
        mediaFileId: candidate.media_file_id!,
        title: candidate.track.title,
        subtitle: `${detail.work.title} · ${album.album.title}`,
        music: {
          artistName: detail.work.title,
          albumTitle: album.album.title,
          artworkWork: { id: detail.work.id, images: detail.work.images },
        },
      }));
      setPendingServerTrack(null);
      startPlayerSession({
        mediaFileId: track.media_file_id,
        locationState: {
          serverUrl: source.url,
          title: track.track.title,
          backTo: `/music/${artistWork?.id ?? source.work.id}`,
          detailParentBackTo: backTo,
          mediaFileId: track.media_file_id,
          playlistItems: sourcePlaylist,
          navigationOrigin: navigationLayer.origin,
          detailNavigationOrigin: parentNavigationOrigin,
        },
      });
    },
    [
      artistWork?.id,
      backTo,
      navigationLayer.origin,
      parentNavigationOrigin,
      pendingServerTrack,
      startPlayerSession,
      t,
    ]
  );

  useDocumentTitle(
    state.status === "ready" ? state.data.work.title : t("pages.musicDetail.music")
  );

  useEffect(() => {
    if (!selectedAlbum || !selectedTrack) {
      setSelectedAlbumId(null);
      setSelectedTrackId(null);
      return;
    }
    setSelectedAlbumId(selectedAlbum.album.id);
    setSelectedTrackId(selectedTrack.track.id);
  }, [selectedAlbum, selectedTrack]);

  useEffect(() => {
    if (
      requestedMediaFileId &&
      restoredMediaFileIdRef.current !== requestedMediaFileId
    ) {
      const requested = allTracks.find(
        ({ track }) => track.media_file_id === requestedMediaFileId
      );
      restoredMediaFileIdRef.current = requestedMediaFileId;
      if (requested) {
        setSelectedAlbumId(requested.album.album.id);
        setSelectedTrackId(requested.track.track.id);
      }
      return;
    }
    if (!playingMediaFileId) return;
    const playing = allTracks.find(
      ({ track }) => track.media_file_id === playingMediaFileId
    );
    if (!playing) return;
    setSelectedAlbumId(playing.album.album.id);
    setSelectedTrackId(playing.track.track.id);
  }, [allTracks, playingMediaFileId, requestedMediaFileId]);

  useEffect(() => {
    let cancelled = false;
    void client
      .listWatchProgress()
      .then((rows) => {
        if (!cancelled) {
          setProgressByMedia(
            new Map(rows.map((progress) => [progress.media_file_id, progress]))
          );
        }
      })
      .catch(() => {
        if (!cancelled) setProgressByMedia(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  const handleProgressChanged = useCallback(
    (_workId: string, updated: WatchProgress[]) => {
      setProgressByMedia((current) => {
        const next = new Map(current);
        for (const progress of updated) next.set(progress.media_file_id, progress);
        return next;
      });
    },
    []
  );

  if (state.status === "loading" || state.status === "idle") {
    return (
      <div
        className="tv-detail tv-detail-loading"
        aria-label={t("pages.musicDetail.loadingArtistDetails")}
      >
        <span className="tv-detail-loader" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <p>{t("pages.musicDetail.loadingMusic")}</p>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="page tv-state-page">
        <TvEmptyState
          graphic="music"
          tone="error"
          variant="page"
          title={t("pages.musicDetail.loadErrorTitle")}
          description={state.message}
        />
      </div>
    );
  }

  if (state.status === "empty" || state.data.work.kind !== "artist") {
    return (
      <div className="page tv-state-page">
        <TvEmptyState
          graphic="music"
          variant="page"
          title={t("pages.musicDetail.unavailableTitle")}
          description={t("pages.musicDetail.unavailableDescription")}
        />
      </div>
    );
  }

  const { work } = state.data;
  const detailRoute = `/music/${work.id}`;
  const hasArtistBackdrop = work.images.some((image) => image.kind === "backdrop");

  const albumBackdrop = selectedAlbum ? (
    <CachedAlbumArtworkImage
      artistWorkId={work.id}
      album={selectedAlbum.album}
      kinds={["poster"]}
      alt=""
      className="tv-music-detail-backdrop"
      fallback={
        selectedAlbumTracks[0]?.media_file_id ? (
          <MediaThumbnailArtwork
            mediaFileId={selectedAlbumTracks[0].media_file_id}
            positionMs={0}
            fallback={null}
            className="tv-music-detail-backdrop"
          />
        ) : null
      }
    />
  ) : null;

  return (
    <TvStageShell
      className="tv-detail tv-music-detail"
      ariaLabel={work.title}
      artworkKey={hasArtistBackdrop ? `${work.id}:backdrop` : selectedAlbum?.album.id ?? work.id}
      artwork={
        <CachedArtworkImage
          work={work}
          kinds={["backdrop"]}
          alt=""
          className="tv-music-detail-backdrop"
          fallback={albumBackdrop}
        />
      }
    >
      <TvDetailHeading
        backLabel={t("pages.musicDetail.backToMusic")}
        className="tv-music-heading"
        sectionTitle={t("shell.nav.music")}
        itemTitle={work.title}
        onBack={() => {
          if (parentNavigationOrigin) navigate(-1);
          else navigate(backTo);
        }}
      />

      <aside className="tv-detail-copy" key={`music-copy-${selectedTrack?.track.id ?? work.id}`}>
        <p className="tv-detail-kicker">
          {selectedAlbum
            ? selectedAlbum.album.album_type.replaceAll("_", " ")
            : work.genres[0] ?? t("pages.musicDetail.artist")}
        </p>
        <h1>{selectedAlbum?.album.title ?? work.title}</h1>
        <div className="tv-detail-meta">
          <span>{work.title}</span>
          {selectedAlbum ? <span>{albumLabel(selectedAlbum)}</span> : null}
          {selectedAlbum ? (
            <span>
              {selectedAlbumTracks.length}{" "}
              {selectedAlbumTracks.length === 1
                ? t("pages.musicDetail.trackSingular")
                : t("pages.musicDetail.trackPlural")}
            </span>
          ) : null}
          {work.genres.slice(0, 3).map((genre) => (
            <span key={genre}>{genre}</span>
          ))}
        </div>
        {selectedTrack ? (
          <h2>
            {selectedTrack.track.title} ·{" "}
            {formatDuration(selectedTrack.track.duration_seconds, t)}
          </h2>
        ) : null}
        <p className="tv-detail-synopsis">
          {work.overview ?? t("pages.musicDetail.overviewFallback")}
        </p>
      </aside>

      {albums.length > 0 ? (
        <TvRailSurface
          className="tv-series-browser tv-music-browser"
          mode="content"
          ariaLabel={t("pages.musicDetail.albumsAndTracksAriaLabel", { title: work.title })}
        >
          <AlbumCoverFlow
            albums={albums}
            artistId={work.id}
            selectedAlbumId={selectedAlbum?.album.id ?? albums[0]!.album.id}
            playingAlbumId={playingAlbumId}
            parentRoute={backTo}
            onSelect={(album) => {
              const firstTrack = playableTracks(album)[0] ?? null;
              setSelectedAlbumId(album.album.id);
              setSelectedTrackId(firstTrack?.track.id ?? null);
            }}
            onPlay={playTrack}
          />
          {selectedAlbum ? (
            <AlbumTrackList
              key={selectedAlbum.album.id}
              album={selectedAlbum}
              artistId={work.id}
              detailRoute={detailRoute}
              detailParentBackTo={backTo}
              playlistItems={playlistItems}
              selectedTrackId={selectedTrack?.track.id ?? null}
              progressByMedia={progressByMedia}
              navigationOrigin={navigationLayer.origin}
              detailNavigationOrigin={parentNavigationOrigin}
              onProgressChanged={handleProgressChanged}
              onNavigate={navigationLayer.captureLink}
              onPlay={playTrack}
              onSelect={(albumId, trackId) => {
                setSelectedAlbumId(albumId);
                setSelectedTrackId(trackId);
              }}
            />
          ) : null}
        </TvRailSurface>
      ) : (
        <div className="tv-series-browser tv-music-browser">
          <TvEmptyState
            graphic="music"
            variant="rail"
            title={t("pages.musicDetail.noAlbumsTitle")}
            description={t("pages.musicDetail.noAlbumsDescription")}
          />
        </div>
      )}

      {pendingServerTrack && workSources.length > 1 ? (
        <ServerChoiceModal
          sources={workSources}
          title={pendingServerTrack.track.track.title}
          onCancel={() => setPendingServerTrack(null)}
          onSelect={chooseMusicServer}
        />
      ) : null}

      <div className="tv-stage-footer" aria-hidden="true">
        <span>{t("pages.musicDetail.music")}</span>
        <i />
        <span>
          {work.genres.slice(0, 2).join(" · ") || t("pages.musicDetail.yourLibrary")}
        </span>
      </div>
    </TvStageShell>
  );
}
