import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  type AlbumDetail,
  type TrackDetail,
  type WatchProgress,
  type WorkChildren,
} from "@streamarr-tv/api-client";
import { useWorkDetail } from "@streamarr-tv/api-client/react";
import { useMediaContextMenu } from "../components/MediaContextMenu";
import type { PlayerPlaylistItem } from "../components/player/PlayerSurface";
import { TvEmptyState } from "../components/tv/TvEmptyState";
import {
  TvMediaTrack,
  TvRailSurface,
  TvStageShell,
} from "../components/tv/TvStage";
import { WatchStateOverlay } from "../components/WatchStateOverlay";
import { useApiClient } from "../lib/ApiClientProvider";
import { CachedArtworkImage } from "../lib/artwork";
import {
  isNavigationLayerRestoring,
  navigationOriginFromState,
  useNavigationLayer,
  type NavigationOrigin,
} from "../lib/navigationLayer";
import { useDocumentTitle } from "../lib/useDocumentTitle";

function artistChildren(children: WorkChildren): AlbumDetail[] {
  return typeof children === "object" && children !== null && "Artist" in children
    ? children.Artist
    : [];
}

function playableTracks(album: AlbumDetail): TrackDetail[] {
  return album.tracks.filter((track) => track.media_file_id != null);
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "Duration unavailable";
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function albumLabel(album: AlbumDetail): string {
  return album.album.release_date
    ? String(new Date(album.album.release_date).getUTCFullYear())
    : album.album.album_type.replace("_", " ");
}

function centreTrack(track: HTMLElement) {
  if (isNavigationLayerRestoring()) return;
  const browser = track.closest<HTMLElement>(".tv-rail-surface.is-vertical-tracks");
  if (!browser) return;
  const trackRect = track.getBoundingClientRect();
  const browserRect = browser.getBoundingClientRect();
  const delta =
    trackRect.top + trackRect.height / 2 - (browserRect.top + browserRect.height / 2);
  if (Math.abs(delta) > 1) browser.scrollBy({ top: delta, behavior: "smooth" });
}

function AlbumTrack({
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
}) {
  const tracks = playableTracks(album);
  const mediaContext = useMediaContextMenu({ onProgressChanged });

  return (
    <TvMediaTrack
      title={album.album.title}
      meta={`${albumLabel(album)} · ${tracks.length} ${
        tracks.length === 1 ? "track" : "tracks"
      }`}
      ariaLabel={`${album.album.title} tracks`}
      scrollKey={`music:${artistId}:album:${album.album.id}`}
      itemsKey={tracks.map((track) => track.track.id).join(":")}
      dataTrackId={`album:${album.album.id}`}
      onFocusCapture={(event) => centreTrack(event.currentTarget)}
      overlay={mediaContext.contextMenu}
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
          leaves: [
            {
              mediaFileId,
              runtimeMs:
                track.runtime_ms ?? (track.track.duration_seconds ?? 0) * 1_000,
              title: track.track.title,
            },
          ],
          activateOrigin: true,
        });
        return (
          <Link
            key={track.track.id}
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
            className={`tv-episode-card tv-music-track-card${
              selectedTrackId === track.track.id ? " is-selected" : ""
            }`}
            data-navigation-focus-key={`music:${artistId}:track:${track.track.id}`}
            data-tv-focus-default={index === 0 ? true : undefined}
            onFocus={() => onSelect(album.album.id, track.track.id)}
            onMouseEnter={() => onSelect(album.album.id, track.track.id)}
            onClick={onNavigate}
            aria-label={`Play ${track.track.title}`}
            {...contextProps}
            onKeyDown={(event) => contextProps.onKeyDown(event)}
          >
            <span className="tv-episode-art tv-music-track-art">
              <span className="tv-music-track-number" aria-hidden="true">
                {String(track.track.track_number).padStart(2, "0")}
              </span>
              <WatchStateOverlay progress={progress} showUnwatched />
            </span>
            <span className="tv-episode-copy">
              <small>{formatDuration(track.track.duration_seconds)}</small>
              <strong>{track.track.title}</strong>
            </span>
          </Link>
        );
      })}
    </TvMediaTrack>
  );
}

export function MusicDetailPage() {
  const { workId } = useParams<{ workId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const client = useApiClient();
  const state = useWorkDetail(client, workId);
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(null);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [progressByMedia, setProgressByMedia] = useState<Map<string, WatchProgress>>(
    new Map()
  );
  const navigationState = location.state as {
    backTo?: unknown;
    navigationOrigin?: unknown;
  } | null;
  const parentNavigationOrigin = navigationOriginFromState(navigationState);
  const requestedBackTo = navigationState?.backTo;
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
  const selected =
    allTracks.find(({ track }) => track.track.id === selectedTrackId) ??
    allTracks[0] ??
    null;
  const playlistItems = useMemo<PlayerPlaylistItem[]>(
    () =>
      allTracks.flatMap(({ album, track }) =>
        track.media_file_id
          ? [
              {
                mediaFileId: track.media_file_id,
                title: track.track.title,
                subtitle: `${state.status === "ready" ? state.data.work.title : ""} · ${
                  album.album.title
                }`,
              },
            ]
          : []
      ),
    [allTracks, state]
  );
  const navigationLayer = useNavigationLayer(
    `${workId ?? "music"}:${allTracks
      .map(({ track }) => track.track.id)
      .join(",")}`,
    state.status === "ready"
  );

  useDocumentTitle(state.status === "ready" ? state.data.work.title : "Music");

  useEffect(() => {
    if (!selected) {
      setSelectedAlbumId(null);
      setSelectedTrackId(null);
      return;
    }
    setSelectedAlbumId((current) => current ?? selected.album.album.id);
    setSelectedTrackId((current) => current ?? selected.track.track.id);
  }, [selected]);

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
      <div className="tv-detail tv-detail-loading" aria-label="Loading artist details">
        <span className="tv-detail-loader" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <p>Loading music</p>
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
          title="This artist could not be loaded"
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
          title="Music details unavailable"
          description="This artist is no longer available in your music libraries."
        />
      </div>
    );
  }

  const { work } = state.data;
  const selectedAlbum =
    albums.find((album) => album.album.id === selectedAlbumId) ??
    selected?.album ??
    null;
  const selectedTrack = selected?.track ?? null;
  const detailRoute = `/music/${work.id}`;

  return (
    <TvStageShell
      className="tv-detail tv-music-detail"
      ariaLabel={work.title}
      artworkKey={work.id}
      artwork={
        <CachedArtworkImage
          work={work}
          kinds={["backdrop", "poster"]}
          alt=""
          fallback={<span>{work.title}</span>}
        />
      }
    >
      <button
        type="button"
        className="tv-back"
        aria-label="Back to Music"
        onClick={() => {
          if (parentNavigationOrigin) navigate(-1);
          else navigate(backTo);
        }}
      >
        <span aria-hidden="true">←</span>
      </button>

      <aside className="tv-detail-copy" key={`music-copy-${selectedTrack?.track.id ?? work.id}`}>
        <p className="tv-detail-kicker">
          {selectedAlbum ? albumLabel(selectedAlbum) : work.genres[0] ?? "Artist"}
        </p>
        <h1>{work.title}</h1>
        {selectedTrack ? <h2>{selectedTrack.track.title}</h2> : null}
        <div className="tv-detail-meta">
          <span>Artist</span>
          {selectedAlbum ? <span>{selectedAlbum.album.title}</span> : null}
          {selectedTrack ? (
            <span>{formatDuration(selectedTrack.track.duration_seconds)}</span>
          ) : null}
          {work.genres.slice(0, 3).map((genre) => (
            <span key={genre}>{genre}</span>
          ))}
        </div>
        <p className="tv-detail-synopsis">
          {work.overview ?? "Choose an album and track to start listening."}
        </p>
      </aside>

      {albums.length > 0 ? (
        <TvRailSurface
          className="tv-series-browser tv-music-browser"
          mode="vertical-tracks"
          scrollKey={`music:${work.id}:albums`}
          ariaLabel={`${work.title} albums and tracks`}
        >
          {albums.map((album) => (
            <AlbumTrack
              key={album.album.id}
              album={album}
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
              onSelect={(albumId, trackId) => {
                setSelectedAlbumId(albumId);
                setSelectedTrackId(trackId);
              }}
            />
          ))}
        </TvRailSurface>
      ) : (
        <div className="tv-series-browser tv-music-browser">
          <TvEmptyState
            graphic="music"
            variant="rail"
            title="No playable albums yet"
            description="Available tracks will appear here after the music library is updated."
          />
        </div>
      )}

      <div className="tv-stage-footer" aria-hidden="true">
        <span>Music</span>
        <i />
        <span>{work.genres.slice(0, 2).join(" · ") || "Your library"}</span>
      </div>
    </TvStageShell>
  );
}
