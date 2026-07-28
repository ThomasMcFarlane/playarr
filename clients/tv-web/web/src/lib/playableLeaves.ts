import type { WorkDetail, WorkKind } from "@playarr-tv/api-client";
import type { TranslationKey } from "./i18n/translations";

export interface PlayableLeaf {
  mediaFileId: string;
  runtimeMs: number;
  episodeId?: string;
  title: string;
  seriesTitle?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  albumTitle?: string;
  /** The catalog kind of the work this leaf belongs to -- lets a download row know whether it's an episode, a track, a movie, etc. */
  workKind?: WorkKind;
  /** The work this leaf belongs to -- only set where it can differ per-leaf (a Playlist fans out across many works); a single-work container resolves it once from the outer item instead. */
  workId?: string;
}

/** Builds a "series/episode" or "artist/album" subtitle for a download row from whatever a leaf actually carries -- richer than just `seriesTitle` alone. */
export function leafSubtitle(leaf: PlayableLeaf): string | undefined {
  if (leaf.seriesTitle && leaf.seasonNumber !== undefined && leaf.episodeNumber !== undefined) {
    const season = String(leaf.seasonNumber).padStart(2, "0");
    const episode = String(leaf.episodeNumber).padStart(2, "0");
    return `${leaf.seriesTitle} · S${season} · E${episode}`;
  }
  if (leaf.seriesTitle && leaf.albumTitle) {
    return `${leaf.seriesTitle} · ${leaf.albumTitle}`;
  }
  return leaf.seriesTitle ?? leaf.albumTitle;
}

export function playableLeaves(
  detail: WorkDetail,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
): PlayableLeaf[] {
  if (detail.media_file_id) {
    return [
      {
        mediaFileId: detail.media_file_id,
        runtimeMs: detail.runtime_ms ?? 0,
        title: detail.work.title,
        workKind: detail.work.kind,
      },
    ];
  }

  if (typeof detail.children !== "object" || detail.children === null) {
    return [];
  }

  if ("Series" in detail.children) {
    return [...detail.children.Series]
      .sort((left, right) => left.season.season_number - right.season.season_number)
      .flatMap((season) =>
        [...season.episodes]
          .sort(
            (left, right) =>
              left.episode.episode_number - right.episode.episode_number
          )
          .flatMap((episode) =>
            episode.media_file_id
              ? [
                  {
                    mediaFileId: episode.media_file_id,
                    runtimeMs: episode.runtime_ms ?? 0,
                    episodeId: episode.episode.id,
                    title:
                      episode.episode.title ??
                      t("components.mediaContextMenu.episodeFallbackTitle", {
                        number: episode.episode.episode_number,
                      }),
                    seriesTitle: detail.work.title,
                    seasonNumber: season.season.season_number,
                    episodeNumber: episode.episode.episode_number,
                    workKind: detail.work.kind,
                  },
                ]
              : []
          )
      );
  }

  if ("Artist" in detail.children) {
    return detail.children.Artist.flatMap((album) =>
      album.tracks.flatMap((track) =>
        track.media_file_id
          ? [
              {
                mediaFileId: track.media_file_id,
                runtimeMs:
                  track.runtime_ms ?? (track.track.duration_seconds ?? 0) * 1_000,
                title: track.track.title,
                seriesTitle: detail.work.title,
                albumTitle: album.album.title,
                workKind: detail.work.kind,
              },
            ]
          : []
      )
    );
  }

  return [];
}
