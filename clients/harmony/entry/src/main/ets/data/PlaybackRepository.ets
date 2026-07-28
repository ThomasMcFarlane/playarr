/**
 * The only place any `pages/`/`player/` code calls for playback negotiation,
 * session-event reporting, or durable watch progress (brief sections 4.10,
 * 4.11 and 4.12).
 *
 * Three distinct call shapes live in this one file:
 *
 * 1. Negotiation and durable progress (`negotiatePlayback`, `listWatchProgress`,
 *    `getWatchProgress`, `putWatchProgress`) all wrap the single
 *    `PlayarrClient` instance from `AppContainer.ets` (`getPlayarrClient`),
 *    exactly like `data/ProfileRepository.ets` does: this file never
 *    constructs its own `PlayarrClient` for these calls.
 * 2. `sendPlaybackSessionEvent` deliberately does NOT go through
 *    `PlayarrClient`. `POST /api/v1/playback/sessions/{session_id}/events`
 *    returns `204 No Content` (brief 4.12), and `PlayarrClient`'s
 *    `decodeOk` unconditionally calls `JSON.parse(bodyText ?? '')` on every
 *    2xx response; an empty 204 body makes that throw, and every successful
 *    event report would be misreported as a network failure. This function
 *    instead issues the request directly through `net/HttpTransport.ets`
 *    (headers built via `core/Headers.ts`, same as `PlayarrClient` does
 *    internally) and treats any 2xx status as success without attempting to
 *    parse a body.
 * 3. `getMediaChapters` / `getMediaMetadata` are bearer-only reads with no
 *    documented cookie/session fallback and no need for `PlayarrClient`'s
 *    401-refresh-retry dance for what is, in practice, best-effort chrome
 *    data (chapter markers, container duration) fetched alongside an
 *    already-negotiated playback session. Per this file's brief, they build
 *    headers via `core/Headers.ts` directly through `net/HttpTransport.ets`,
 *    the same direct pattern `data/ArtworkRepository.ets` uses for
 *    bearer-gated bytes (brief 4.9) -- here for a JSON body instead of raw
 *    bytes.
 *
 * SIDE EFFECTS (brief 4.10): `negotiatePlayback` (`GET
 * /api/v1/playback/{media_file_id}`) is not idempotent. It CREATES a
 * `PlaybackSession` and may spawn ffmpeg; duplicate calls within 10 s for the
 * same (user, device, media_file) are deduped to one session, but calls
 * further apart create separate sessions. Every caller renegotiating
 * (quality change, audio-track change, seeking an on-demand HLS session)
 * MUST send `{"kind":"stop","reason":"user_stopped",...}` for the OLD
 * `session_id` via `sendPlaybackSessionEvent` BEFORE issuing the new
 * `negotiatePlayback` call -- this file does not enforce that ordering
 * itself, it is a `player/PlaybackSessionReporter.ets` / `pages/Player.ets`
 * orchestration concern.
 *
 * Every function here resolves to an `ApiResult<T>` (`net/ApiResult.ets`)
 * and never throws.
 */

import { getPlayarrClient, getServerDirectory, getSessionManager } from '../AppContainer';

import {
  ApiResult,
  ApiOk,
  ApiHttpFailure,
  ApiNetworkFailure,
  ApiNetworkFailureReason,
} from '../net/ApiResult';
import { sendHttpRequest, HttpRequestOptions, HttpTransportResponse } from '../net/HttpTransport';

import { buildHeaders, buildJsonBodyHeaders } from '../core/Headers.ts';
import { clientVersion, resolveClientPlatform } from '../core/AppConfig.ts';
import { absoluteUrl } from '../core/Url.ts';
import { decodeErrorEnvelope } from '../core/ErrorEnvelope.ts';
import { isPlaybackComplete } from '../core/PlaybackMath.ts';
import { DeviceProfile } from '../core/DeviceProfile.ts';
import {
  playbackInfoUrl,
  playbackEventsUrl,
  playbackProgressListUrl,
  playbackProgressUrl,
  mediaChaptersUrl,
  mediaMetadataUrl,
} from '../core/Endpoints.ts';
import { PlaybackInfoResponse, PlaybackEventKind, WatchProgress } from '../core/Types/Playback.ts';
import { MediaChapter, MediaMetadata } from '../core/Types/Media.ts';

import { DEVICE_PROFILE_STORAGE_KEY } from '../device/DeviceProfileService';

/**
 * Optional caller-supplied query params layered on top of the fixed
 * capability string every negotiation call sends (brief 4.10). All five are
 * omitted from the request entirely when left `undefined`, so the server's
 * own defaults (e.g. `profile: "h264-720p-4mbps"`) apply. Supplying
 * `audioStreamIndex` FORCES a fresh transcode server-side; this file passes
 * it through as given and does not second-guess that choice.
 */
export interface PlaybackNegotiationOptions {
  startPositionMs?: number;
  profile?: string;
  forceTranscode?: boolean;
  audioStreamIndex?: number;
  ignoreSavedPreferences?: boolean;
}

/**
 * The exact `PUT /api/v1/playback/{media_file_id}/progress` request body
 * (brief 4.12). Defined here, rather than in `core/Types/Playback.ts`,
 * because this repository is the one and only place that constructs it --
 * `completed` is always derived from `core/PlaybackMath.ts#isPlaybackComplete`
 * (see `putWatchProgress`, below) rather than accepted from a caller, so
 * there is no independent wire contract for a caller to hold a type against.
 */
export interface WatchProgressUpdate {
  position_ms: number;
  duration_ms: number;
  completed: boolean;
  occurred_at?: string;
}

/** Harmony's conservative first-pass capability string (brief 4.10 / risk R6). */
const CAPABILITY_CONTAINERS: string = 'mp4,mkv,m3u8,mp3,flac,m4a,ogg,wav';
const CAPABILITY_VIDEO_CODECS: string = 'h264,h265';
const CAPABILITY_AUDIO_CODECS: string = 'aac,mp3,flac,vorbis,opus';
const CAPABILITY_MAX_BITRATE_BPS: string = '20000000';

/** `sendHttpRequest`'s response-decoding mode for every direct call in this file: a JSON body (chapters, metadata) or no body at all (a 204 event ack) are both requested as plain text. */
const DIRECT_DATA_TYPE = 'string';

/**
 * The `clientPlatform` wire name for the two direct-`HttpTransport` call
 * sites below (`sendPlaybackSessionEvent`, `getMediaChapters`,
 * `getMediaMetadata`). Mirrors `AppContainer.ets#resolveBootClientPlatform`
 * exactly: read the `DeviceProfile` `device/DeviceProfileService.ets`
 * published into `AppStorage`, falling back to the touch profile only in
 * the defensive case where nothing has been published yet. `PlayarrClient`
 * is handed its `clientPlatform` once at construction time; a direct call
 * bypassing it has to resolve the same value itself, from the same source
 * of truth.
 */
function currentClientPlatform(): string {
  const profile = AppStorage.get<DeviceProfile>(DEVICE_PROFILE_STORAGE_KEY);
  if (profile !== undefined) {
    return profile.platformWireName;
  }
  return resolveClientPlatform('phone');
}

function networkFailure<T>(reason: ApiNetworkFailureReason, message: string): ApiResult<T> {
  const failure: ApiNetworkFailure = { kind: 'network_failure', reason: reason, message: message };
  return failure;
}

/**
 * Builds the full `GET /api/v1/playback/{media_file_id}` path, the fixed
 * capability params first, then any caller-supplied optional param whose
 * value is not `undefined` (brief 4.10).
 */
function buildPlaybackInfoPath(mediaFileId: string, options: PlaybackNegotiationOptions | undefined): string {
  const params: string[] = [];
  params.push('containers=' + CAPABILITY_CONTAINERS);
  params.push('video_codecs=' + CAPABILITY_VIDEO_CODECS);
  params.push('audio_codecs=' + CAPABILITY_AUDIO_CODECS);
  params.push('max_bitrate_bps=' + CAPABILITY_MAX_BITRATE_BPS);

  if (options !== undefined) {
    if (options.startPositionMs !== undefined) {
      params.push('start_position_ms=' + String(options.startPositionMs));
    }
    if (options.profile !== undefined) {
      params.push('profile=' + encodeURIComponent(options.profile));
    }
    if (options.forceTranscode !== undefined) {
      params.push('force_transcode=' + String(options.forceTranscode));
    }
    if (options.audioStreamIndex !== undefined) {
      params.push('audio_stream_index=' + String(options.audioStreamIndex));
    }
    if (options.ignoreSavedPreferences !== undefined) {
      params.push('ignore_saved_preferences=' + String(options.ignoreSavedPreferences));
    }
  }

  return playbackInfoUrl(mediaFileId) + '?' + params.join('&');
}

/**
 * Negotiates playback for `mediaFileId` (brief 4.10). See this file's header
 * comment for the side-effect and stop-before-renegotiate warnings: this is
 * NOT a safe call to retry casually, and every caller renegotiating must
 * close the previous `session_id` first via `sendPlaybackSessionEvent`.
 *
 * `response.value.duration_ms === 0` means server-side duration probing
 * failed, not an error; callers should fall back to the player's own
 * reported duration via `core/PlaybackMath.ts#resolveDurationMs` rather than
 * treating it as a zero-length item.
 */
export function negotiatePlayback(
  mediaFileId: string,
  options?: PlaybackNegotiationOptions
): Promise<ApiResult<PlaybackInfoResponse>> {
  const path = buildPlaybackInfoPath(mediaFileId, options);
  return getPlayarrClient().getJson<PlaybackInfoResponse>(path);
}

/** Shared 2xx/failure decoding for a direct (non-`PlayarrClient`) call whose success carries no meaningful body -- today, only the session-events POST. */
function decodeVoidResponse(response: HttpTransportResponse): ApiResult<null> {
  if (response.status === 0) {
    const reason: ApiNetworkFailureReason = response.networkErrorReason ?? 'unknown';
    const message = response.networkErrorMessage ?? 'The network request failed.';
    return networkFailure<null>(reason, message);
  }
  if (response.status >= 200 && response.status < 300) {
    const ok: ApiOk<null> = { kind: 'ok', status: response.status, value: null };
    return ok;
  }
  const bodyText = response.bodyText ?? '';
  const envelope = decodeErrorEnvelope(response.status, response.contentType, bodyText);
  const failure: ApiHttpFailure = { kind: 'http_failure', status: response.status, envelope: envelope };
  return failure;
}

/**
 * Reports one `PlaybackEventKind` against `sessionId` (brief 4.12):
 * `POST /api/v1/playback/sessions/{session_id}/events`, `204 No Content` on
 * success, `403` if the session belongs to another user, `404` if unknown
 * or already closed. See this file's header comment for why this bypasses
 * `PlayarrClient` entirely rather than calling `postJson`.
 *
 * `occurred_at` is always the server clock; this file never sends one, and
 * `PlaybackEventKind` (`core/Types/Playback.ts`) has no such field to send.
 *
 * Never blocks or throws on failure -- resolves to an `ApiResult` like every
 * other call in this file; a caller (`player/PlaybackSessionReporter.ets`)
 * is responsible for swallowing a failure here rather than surfacing it or
 * interrupting playback (brief 4.12: "Reporting must never block or break
 * playback").
 */
export async function sendPlaybackSessionEvent(sessionId: string, event: PlaybackEventKind): Promise<ApiResult<null>> {
  try {
    const baseUrl = getServerDirectory().getActiveBaseUrl();
    if (baseUrl === null) {
      return networkFailure<null>('no_connection', 'No active Playarr server is configured.');
    }

    let url: string;
    try {
      url = absoluteUrl(baseUrl, playbackEventsUrl(sessionId));
    } catch (err) {
      const asError = err as Error;
      return networkFailure<null>('unknown', asError.message);
    }

    const accessToken = getSessionManager().getAccessToken();
    const headers = buildJsonBodyHeaders(currentClientPlatform(), clientVersion, accessToken);
    const requestOptions: HttpRequestOptions = {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(event),
      dataType: DIRECT_DATA_TYPE,
    };

    const response = await sendHttpRequest(url, requestOptions);
    return decodeVoidResponse(response);
  } catch (err) {
    const asError = err as Error;
    return networkFailure<null>('unknown', asError.message);
  }
}

/** `GET /api/v1/playback/progress` (brief 4.12): every media file with a durable watch-progress row for the current user. An empty list is a legitimate policy outcome (restricted libraries silently drop rows), not necessarily a bug. */
export function listWatchProgress(): Promise<ApiResult<WatchProgress[]>> {
  return getPlayarrClient().getJson<WatchProgress[]>(playbackProgressListUrl());
}

/** `GET /api/v1/playback/{media_file_id}/progress` (brief 4.12): synthesises `state: "unseen"`, `updated_at: null` server-side when no row exists yet, so this always resolves to a value rather than a 404 for an unseen item. */
export function getWatchProgress(mediaFileId: string): Promise<ApiResult<WatchProgress>> {
  return getPlayarrClient().getJson<WatchProgress>(playbackProgressUrl(mediaFileId));
}

/**
 * `PUT /api/v1/playback/{media_file_id}/progress` (brief 4.12). `completed`
 * is always computed from `positionMs`/`durationMs` via
 * `core/PlaybackMath.ts#isPlaybackComplete` (`position >= duration - 5000`)
 * rather than accepted as a parameter, so every caller in this app agrees
 * with the one place that threshold is defined. `occurredAt`, when supplied,
 * must be RFC3339; omit it to let the server stamp its own clock.
 */
export function putWatchProgress(
  mediaFileId: string,
  positionMs: number,
  durationMs: number,
  occurredAt?: string
): Promise<ApiResult<WatchProgress>> {
  const body: WatchProgressUpdate = {
    position_ms: positionMs,
    duration_ms: durationMs,
    completed: isPlaybackComplete(positionMs, durationMs),
  };
  if (occurredAt !== undefined) {
    body.occurred_at = occurredAt;
  }
  return getPlayarrClient().putJson<WatchProgressUpdate, WatchProgress>(playbackProgressUrl(mediaFileId), body);
}

/** Shared direct-`HttpTransport` GET for a bearer-only JSON endpoint (chapters, metadata) -- see this file's header comment for why these two bypass `PlayarrClient`. Wraps its whole body in one `try`/`catch`, same discipline as `sendPlaybackSessionEvent`, so this resolves to an `ApiResult` rather than ever throwing or rejecting. */
async function sendDirectJsonGet<T>(path: string): Promise<ApiResult<T>> {
  try {
    const baseUrl = getServerDirectory().getActiveBaseUrl();
    if (baseUrl === null) {
      return networkFailure<T>('no_connection', 'No active Playarr server is configured.');
    }

    let url: string;
    try {
      url = absoluteUrl(baseUrl, path);
    } catch (err) {
      const asError = err as Error;
      return networkFailure<T>('unknown', asError.message);
    }

    const accessToken = getSessionManager().getAccessToken();
    const headers = buildHeaders(currentClientPlatform(), clientVersion, accessToken);
    const requestOptions: HttpRequestOptions = {
      method: 'GET',
      headers: headers,
      dataType: DIRECT_DATA_TYPE,
    };

    const response = await sendHttpRequest(url, requestOptions);

    if (response.status === 0) {
      const reason: ApiNetworkFailureReason = response.networkErrorReason ?? 'unknown';
      const message = response.networkErrorMessage ?? 'The network request failed.';
      return networkFailure<T>(reason, message);
    }

    if (response.status >= 200 && response.status < 300) {
      const bodyText = response.bodyText ?? '';
      let parsed: T;
      try {
        parsed = JSON.parse(bodyText) as T;
      } catch (err) {
        return networkFailure<T>('unknown', 'The server response body was not valid JSON.');
      }
      const ok: ApiOk<T> = { kind: 'ok', status: response.status, value: parsed };
      return ok;
    }

    const bodyText = response.bodyText ?? '';
    const envelope = decodeErrorEnvelope(response.status, response.contentType, bodyText);
    const failure: ApiHttpFailure = { kind: 'http_failure', status: response.status, envelope: envelope };
    return failure;
  } catch (err) {
    const asError = err as Error;
    return networkFailure<T>('unknown', asError.message);
  }
}

/** `GET /api/v1/media/{media_file_id}/chapters` (brief 4.11): real chapters embedded in the container, as reported by ffprobe. Bearer-only. */
export function getMediaChapters(mediaFileId: string): Promise<ApiResult<MediaChapter[]>> {
  return sendDirectJsonGet<MediaChapter[]>(mediaChaptersUrl(mediaFileId));
}

/** `GET /api/v1/media/{media_file_id}/metadata` (brief 4.11): `{duration_ms}`. Bearer-only. */
export function getMediaMetadata(mediaFileId: string): Promise<ApiResult<MediaMetadata>> {
  return sendDirectJsonGet<MediaMetadata>(mediaMetadataUrl(mediaFileId));
}
