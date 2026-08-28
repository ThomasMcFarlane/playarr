/**
 * Builds a `PlayarrCastLoadRequest` from the same inputs
 * `usePlaybackEngine.ts` already assembles for local playback, and issues
 * it to a connected `CastSession`.
 */
import type { PlaybackAudioTrack, PlaybackSubtitleTrack } from "@playarr-tv/player-core";
import type { PlaybackQualityOption } from "@playarr-tv/api-client";
import {
  PLAYARR_CAST_PROTOCOL_VERSION,
  type PlayarrCastCredentials,
  type PlayarrCastItem,
  type PlayarrCastItemKind,
  type PlayarrCastLoadRequest,
  type PlayarrCastPeer,
  type PlayarrCastQueueEntry,
} from "@playarr-tv/cast-protocol";
import type { PlayerPlaylistItem } from "../../components/player/PlayerSurface";
import { DOWNLOADED_QUALITY_ID } from "../qualityIds";

/** This build's own identity on the custom channel -- mirrors `ApiClientProvider.tsx`'s web-platform login identity, duplicated locally rather than imported (that constant is private to that module). */
const CAST_SENDER_DEVICE_NAME = "Playarr Web";

/** Decorative only -- the receiver negotiates its own real source via `server`/`credentials`/`item`, never reads this. */
const PLAYARR_CAST_CONTENT_TYPE = "application/vnd.playarr.cast+json";

function castItemKind(item: Pick<PlayerPlaylistItem, "music" | "seasonNumber">): PlayarrCastItemKind {
  if (item.music) return "track";
  if (item.seasonNumber !== undefined) return "episode";
  return "movie";
}

function castItemFromPlaylistItem(
  item: PlayerPlaylistItem,
  durationMs: number | undefined
): PlayarrCastItem {
  return {
    mediaFileId: item.mediaFileId,
    workId: item.music?.artworkWork.id,
    kind: castItemKind(item),
    title: item.title,
    subtitle: item.subtitle,
    seasonNumber: item.seasonNumber,
    episodeNumber: item.episodeNumber,
    durationMs,
  };
}

function castQueueEntryFromPlaylistItem(item: PlayerPlaylistItem): PlayarrCastQueueEntry {
  return {
    mediaFileId: item.mediaFileId,
    workId: item.music?.artworkWork.id,
    kind: castItemKind(item),
    title: item.title,
    subtitle: item.subtitle,
    seasonNumber: item.seasonNumber,
    episodeNumber: item.episodeNumber,
  };
}

export interface BuildPlayarrCastLoadRequestInput {
  serverBaseUrl: string;
  serverPeers?: PlayarrCastPeer[];
  credentials: PlayarrCastCredentials;
  item: PlayerPlaylistItem;
  /** Absolute source-timeline position in seconds -- `player.engineState.currentTimeSeconds` already carries the source offset back in, so this is never engine-local time. */
  startPositionSeconds: number;
  durationSeconds: number;
  autoplay: boolean;
  selectedAudioTrackId: string | null;
  selectedSubtitleTrackId: string | null;
  audioTracks: PlaybackAudioTrack[];
  subtitleTracks: PlaybackSubtitleTrack[];
  activeQualityId: string;
  qualityOptions: PlaybackQualityOption[];
  /** Items after the one currently loading -- mirrors this player's own "Up Next" semantics. */
  queue: PlayerPlaylistItem[];
  senderLanguage: string;
}

/**
 * Pure builder -- no SDK/session dependency at all, so this is fully
 * testable against plain input objects.
 */
export function buildPlayarrCastLoadRequest(
  input: BuildPlayarrCastLoadRequestInput
): PlayarrCastLoadRequest {
  const selectedAudioTrack = input.audioTracks.find(
    (track) => track.id === input.selectedAudioTrackId
  );
  const selectedSubtitleTrack = input.subtitleTracks.find(
    (track) => track.id === input.selectedSubtitleTrackId
  );
  const selectedQuality = input.qualityOptions.find(
    (quality) => quality.id === input.activeQualityId
  );
  // The synthetic "Downloaded" quality only ever names a local blob: URL in
  // *this* browser -- meaningless as a hint to a receiver that will
  // negotiate its own source against the server, so it is never forwarded.
  const isLocalOnlyQuality = input.activeQualityId === DOWNLOADED_QUALITY_ID;

  const durationMs =
    input.durationSeconds > 0 ? Math.round(input.durationSeconds * 1000) : undefined;

  return {
    protocolVersion: PLAYARR_CAST_PROTOCOL_VERSION,
    server: {
      baseUrl: input.serverBaseUrl,
      peers: input.serverPeers,
    },
    credentials: input.credentials,
    item: castItemFromPlaylistItem(input.item, durationMs),
    playback: {
      startPositionMs: Math.max(0, Math.round(input.startPositionSeconds * 1000)),
      autoplay: input.autoplay,
      preferredAudioTrackId: input.selectedAudioTrackId,
      preferredSubtitleTrackId: input.selectedSubtitleTrackId,
      preferredAudioLanguage: selectedAudioTrack?.language ?? null,
      preferredSubtitleLanguage: selectedSubtitleTrack?.language ?? null,
      qualityId: isLocalOnlyQuality ? null : input.activeQualityId,
      maxBitrateBps: isLocalOnlyQuality ? null : (selectedQuality?.video_bitrate_bps ?? null),
    },
    sender: {
      platform: "web",
      appVersion: __APP_VERSION__,
      deviceName: CAST_SENDER_DEVICE_NAME,
      language: input.senderLanguage,
    },
    queue: input.queue.length > 0 ? input.queue.map(castQueueEntryFromPlaylistItem) : undefined,
  };
}

/**
 * Narrow structural slice of `cast.framework.CastSession` this module
 * needs -- see `castMessages.ts`'s identical `PlayarrCastSessionLike` for
 * why a real `CastSession` still satisfies this with no cast needed; kept
 * as a separate, even narrower type here since this module never sends or
 * listens for custom-channel messages, only `loadMedia`.
 */
export interface PlayarrCastLoadSessionLike {
  loadMedia(request: chrome.cast.media.LoadRequest): Promise<chrome.cast.ErrorCode | undefined>;
}

/**
 * Issues `request` to `session`. `CastSession.loadMedia` rejects with a
 * bare `chrome.cast.ErrorCode` STRING on failure, never an `Error` object
 * (some CAF builds instead *resolve* with the code -- handled here too) --
 * both are normalized into an ordinary thrown `Error` so every caller can
 * use a plain try/catch.
 */
export async function requestPlayarrCastLoad(
  session: PlayarrCastLoadSessionLike,
  request: PlayarrCastLoadRequest
): Promise<void> {
  const mediaInfo = new chrome.cast.media.MediaInfo(request.item.mediaFileId, PLAYARR_CAST_CONTENT_TYPE);
  mediaInfo.streamType = chrome.cast.media.StreamType.BUFFERED;
  if (request.item.durationMs !== undefined) {
    mediaInfo.duration = request.item.durationMs / 1000;
  }
  const metadata = new chrome.cast.media.GenericMediaMetadata();
  metadata.title = request.item.title;
  if (request.item.subtitle) metadata.subtitle = request.item.subtitle;
  mediaInfo.metadata = metadata;
  // The receiver negotiates its own real playback source from this --
  // never a directly-playable URL, per this channel's whole design.
  mediaInfo.customData = request;

  const loadRequest = new chrome.cast.media.LoadRequest(mediaInfo);
  loadRequest.autoplay = request.playback.autoplay;
  loadRequest.currentTime = request.playback.startPositionMs / 1000;

  let resolvedCode: chrome.cast.ErrorCode | undefined;
  try {
    resolvedCode = await session.loadMedia(loadRequest);
  } catch (caught: unknown) {
    const code = typeof caught === "string" ? caught : undefined;
    throw new Error(`Playarr Cast load failed: ${code ?? String(caught)}`);
  }
  if (resolvedCode !== undefined) {
    throw new Error(`Playarr Cast load failed: ${resolvedCode}`);
  }
}
