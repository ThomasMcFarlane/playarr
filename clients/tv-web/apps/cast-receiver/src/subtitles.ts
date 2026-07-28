/**
 * Sideloads WebVTT subtitle tracks into the CAF player.
 *
 * The subtitle sidecar is fetched with the receiver's own bearer token
 * (`ApiClient.getMediaSubtitle`, same as `web/src/lib/usePlaybackEngine.ts`'s
 * `loadSourceSubtitleTrack`) and converted to a `blob:` object URL so the
 * `Authorization` header never has to travel with the track URL itself.
 *
 * `TextTracksManager` is only reachable through a real, running
 * `CastReceiverContext` (`playerManager.getTextTracksManager()`), so the
 * imperative `loadAndActivateSubtitleTrack` below is exercised by `main.ts`
 * but not unit tested here -- only its pure pieces
 * (`buildSubtitleTrackFields`, `selectPreferredSubtitleTrack`) are. Per the
 * design: sideload after `PLAYER_LOAD_COMPLETE`, never at `start()` --
 * managers are empty until a load has actually completed. Any failure here
 * is logged and swallowed -- playback must never fail over a subtitle
 * fetch failure.
 */
import type { PlaybackInfo } from "@playarr-tv/api-client";

/**
 * `@playarr-tv/api-client` re-exports `PlaybackInfo` itself but not the
 * shape of its `subtitle_tracks` elements as a standalone named type, so
 * it's derived here via an indexed access instead of inventing a
 * hand-written duplicate that could drift from the real generated schema.
 */
export type PlaybackSubtitleTrackOption = PlaybackInfo["subtitle_tracks"][number];

/** `cast.framework.messages.TextTrackType.SUBTITLES`'s literal string value, duplicated so this module has no runtime dependency on the ambient CAF SDK enum (see `capabilities.ts`'s `CastCapabilityProbe` doc comment for why). */
const SUBTITLE_TRACK_SUBTYPE = "SUBTITLES";
const SUBTITLE_TRACK_CONTENT_TYPE = "text/vtt";

export interface SubtitleTrackFields {
  trackContentId: string;
  trackContentType: string;
  subtype: string;
  name: string;
  language?: string;
}

/** Pure mapping from a negotiated subtitle option + its already-fetched blob: URL to the fields a CAF `Track` needs set on it. */
export function buildSubtitleTrackFields(
  option: Pick<PlaybackSubtitleTrackOption, "label" | "language">,
  blobUrl: string
): SubtitleTrackFields {
  return {
    trackContentId: blobUrl,
    trackContentType: SUBTITLE_TRACK_CONTENT_TYPE,
    subtype: SUBTITLE_TRACK_SUBTYPE,
    name: option.label,
    ...(option.language ? { language: option.language } : {}),
  };
}

/**
 * Picks which subtitle track option should become active given the
 * sender's stated preference: an exact track id first, then a matching
 * language, else `undefined` (no subtitles is a perfectly valid initial
 * choice, unlike audio which always needs an active track).
 *
 * Generic over `T` (rather than fixed to `Pick<PlaybackSubtitleTrackOption,
 * "id" | "language">`) so the return type is the caller's actual richer
 * element type -- e.g. a real `PlaybackSubtitleTrackOption[]` in, the exact
 * same `PlaybackSubtitleTrackOption` (not a narrowed `Pick<...>`) out.
 */
export function selectPreferredSubtitleTrack<T extends Pick<PlaybackSubtitleTrackOption, "id" | "language">>(
  options: readonly T[],
  preferredTrackId: string | null | undefined,
  preferredLanguage: string | null | undefined
): T | undefined {
  if (preferredTrackId) {
    const exact = options.find((option) => option.id === preferredTrackId);
    if (exact) return exact;
  }
  if (preferredLanguage) {
    const byLanguage = options.find((option) => option.language === preferredLanguage);
    if (byLanguage) return byLanguage;
  }
  return undefined;
}

/** The one `ApiClient` method this module needs. */
export type SubtitleFetcher = (
  mediaFileId: string,
  streamIndex: number,
  sourceOffsetMs?: number
) => Promise<Blob>;

/** The subset of `cast.framework.messages.Track`'s fields this module reads or writes. */
export interface SideloadableTextTrack {
  trackId: number;
  trackContentId?: string;
  trackContentType?: string;
  subtype?: string;
  name?: string;
  language?: string;
}

/** Minimal shape this module needs from `cast.framework.TextTracksManager` -- see `capabilities.ts`'s `CastCapabilityProbe` doc comment for why this is a hand-rolled interface rather than the ambient SDK type. */
export interface SideloadableTextTracksManager {
  createTrack(): SideloadableTextTrack;
  addTracks(tracks: SideloadableTextTrack[]): void;
  setActiveByIds(ids: number[] | null): void;
}

/**
 * Fetches one subtitle track's WebVTT with the receiver's bearer, sideloads
 * it via `TextTracksManager.createTrack()`, and marks it active. On any
 * failure, logs and returns -- playback continues without subtitles.
 */
export async function loadAndActivateSubtitleTrack(
  deps: { getMediaSubtitle: SubtitleFetcher; textTracksManager: SideloadableTextTracksManager },
  mediaFileId: string,
  option: Pick<PlaybackSubtitleTrackOption, "label" | "language" | "stream_index">,
  sourceOffsetMs: number
): Promise<void> {
  try {
    const blob = await deps.getMediaSubtitle(
      mediaFileId,
      option.stream_index,
      Math.max(0, Math.round(sourceOffsetMs))
    );
    const blobUrl = URL.createObjectURL(new Blob([blob], { type: SUBTITLE_TRACK_CONTENT_TYPE }));
    const fields = buildSubtitleTrackFields(option, blobUrl);
    const track = deps.textTracksManager.createTrack();
    Object.assign(track, fields);
    deps.textTracksManager.addTracks([track]);
    deps.textTracksManager.setActiveByIds([track.trackId]);
  } catch (err) {
    // Never fail the whole load over a subtitle fetch failure.
    console.warn("Playarr Cast receiver: failed to load subtitle track", err);
  }
}

/** Clears the active subtitle track (a `tracks.select` message with `subtitleTrackId: null`). */
export function clearActiveSubtitleTrack(textTracksManager: SideloadableTextTracksManager): void {
  textTracksManager.setActiveByIds(null);
}
