/**
 * Downloads one sidecar VTT subtitle track and hands back a ready-to-use
 * file descriptor (brief 4.11).
 *
 * `PlaybackInfoResponse.subtitle_tracks[].url` (`core/Types/Playback.ts`) is
 * already a complete, bearer-gated, SERVER-RELATIVE URL with
 * `source_offset_ms` pre-filled by the server -- this file joins it onto the
 * active server origin via `core/Url.ts#absoluteUrl` and never rebuilds it
 * from `core/Endpoints.ts` (there is no `subtitleTrackUrl(...)` to call;
 * `core/Endpoints.ts#mediaSubtitleUrl` exists only for documentation/testing
 * of the underlying route shape, not for this file to reconstruct a URL the
 * server already gave a complete answer for).
 *
 * Subtitles are BEARER-ONLY (brief 4.11): unlike direct-play/HLS byte
 * fetching there is no cookie or query-param fallback, so this file always
 * attaches `Authorization` and never tries anything else. Because
 * AVPlayer's `addSubtitleFromUrl` cannot attach headers, the flow is: fetch
 * the VTT bytes here with a bearer header, write them to the app sandbox
 * (`util/Sandbox.ets`), then hand the caller an already-open read-only file
 * descriptor for `avPlayer.addSubtitleFromFd`.
 *
 * Goes directly through `net/HttpTransport.ets` + `core/Headers.ts`, the
 * same direct pattern `data/ArtworkRepository.ets` uses for bearer-gated
 * bytes (brief 4.9) and `data/PlaybackRepository.ets` uses for its own
 * bearer-only chapters/metadata reads -- never through `PlayarrClient`,
 * since this is a raw byte fetch (`expectDataType: ARRAY_BUFFER`), not a
 * JSON call.
 *
 * Resolves to an `ApiResult<SubtitleFileHandle>` and never throws.
 */

import { getServerDirectory, getSessionManager } from '../AppContainer';

import { ApiResult, ApiOk, ApiHttpFailure, ApiNetworkFailure, ApiNetworkFailureReason } from '../net/ApiResult';
import { sendHttpRequest, HttpRequestOptions } from '../net/HttpTransport';

import { buildHeaders } from '../core/Headers.ts';
import { clientVersion, resolveClientPlatform } from '../core/AppConfig.ts';
import { absoluteUrl } from '../core/Url.ts';
import { decodeErrorEnvelope } from '../core/ErrorEnvelope.ts';
import { DeviceProfile } from '../core/DeviceProfile.ts';
import { SubtitleTrack } from '../core/Types/Playback.ts';

import { DEVICE_PROFILE_STORAGE_KEY } from '../device/DeviceProfileService';

import { writeBytes, openFd } from '../util/Sandbox';

/** `sendHttpRequest`'s response-decoding mode for a raw byte fetch: real VTT bytes on success, but a JSON error envelope on failure decodes its own body separately below via `utf8BytesToString`. */
const SUBTITLE_DATA_TYPE = 'array_buffer';

/**
 * A successful sidecar subtitle download: an already-open, read-only file
 * descriptor for a just-written VTT file inside the app sandbox, ready for
 * AVPlayer's `addSubtitleFromFd` (brief 4.11). The caller owns this fd from
 * this point on (see `util/Sandbox.ets#openFd`).
 */
export interface SubtitleFileHandle {
  fd: number;
}

/** Same fallback-resolution pattern as `data/PlaybackRepository.ets#currentClientPlatform` and `AppContainer.ets#resolveBootClientPlatform`: read the published `DeviceProfile`, falling back to the touch profile only if nothing has been published yet. */
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
 * A stable-per-(session, track) sandbox file name, so a repeated fetch of
 * the same track (e.g. a caller retrying after a transient failure)
 * overwrites its own previous download rather than accumulating a new file
 * every time. `util/Sandbox.ets#cleanupStaleSandboxFiles` still catches
 * anything left behind by a crashed or killed session on the next app
 * start.
 */
function sandboxFileName(sessionId: string, track: SubtitleTrack): string {
  return 'subtitle-' + sessionId + '-' + String(track.stream_index) + '.vtt';
}

/**
 * Decodes UTF-8 bytes into a `string` by hand, without `TextDecoder` -- its
 * availability under the ArkTS runtime is not guaranteed, the same reasoning
 * `core/Base64Url.ts`, `auth/DeviceAuthService.ets` and
 * `data/ArtworkRepository.ets#utf8BytesToString` already apply to
 * `TextEncoder`/`TextDecoder`/`Buffer`/`URL`. Copied from that same
 * `ArtworkRepository.ets` helper rather than shared, matching this
 * codebase's existing convention of a small, private, per-file decoder
 * rather than a cross-file text-decoding utility.
 *
 * Only used to turn a non-2xx subtitle-fetch response's body bytes back
 * into text so `core/ErrorEnvelope.ts#decodeErrorEnvelope` can decode it --
 * error bodies are short, mostly-ASCII JSON, so a malformed trailing byte is
 * simply skipped rather than thrown, matching that decoder's own
 * "never throws" discipline.
 */
function utf8BytesToString(bytes: Uint8Array): string {
  let output = '';
  let index = 0;
  const length = bytes.length;
  while (index < length) {
    const byte0 = bytes[index];
    if (byte0 < 0x80) {
      output = output + String.fromCharCode(byte0);
      index = index + 1;
      continue;
    }
    if ((byte0 & 0xe0) === 0xc0 && index + 1 < length) {
      const byte1 = bytes[index + 1];
      output = output + String.fromCharCode(((byte0 & 0x1f) << 6) | (byte1 & 0x3f));
      index = index + 2;
      continue;
    }
    if ((byte0 & 0xf0) === 0xe0 && index + 2 < length) {
      const byte1 = bytes[index + 1];
      const byte2 = bytes[index + 2];
      output = output + String.fromCharCode(((byte0 & 0x0f) << 12) | ((byte1 & 0x3f) << 6) | (byte2 & 0x3f));
      index = index + 3;
      continue;
    }
    if ((byte0 & 0xf8) === 0xf0 && index + 3 < length) {
      const byte1 = bytes[index + 1];
      const byte2 = bytes[index + 2];
      const byte3 = bytes[index + 3];
      const codePoint = ((byte0 & 0x07) << 18) | ((byte1 & 0x3f) << 12) | ((byte2 & 0x3f) << 6) | (byte3 & 0x3f);
      const adjusted = codePoint - 0x10000;
      const highSurrogate = 0xd800 + (adjusted >> 10);
      const lowSurrogate = 0xdc00 + (adjusted & 0x3ff);
      output = output + String.fromCharCode(highSurrogate) + String.fromCharCode(lowSurrogate);
      index = index + 4;
      continue;
    }
    // An unrecognised leading byte -- skip it rather than throwing. This
    // text is diagnostic only (an error envelope's `message`/`error` code),
    // never load-bearing beyond that.
    index = index + 1;
  }
  return output;
}

/**
 * Downloads `track.url`, writes the bytes into the app sandbox under a name
 * scoped to `sessionId` (the owning `PlaybackInfoResponse.session_id`), and
 * returns an already-open read-only file descriptor.
 */
export async function fetchSubtitleTrack(
  sessionId: string,
  track: SubtitleTrack
): Promise<ApiResult<SubtitleFileHandle>> {
  try {
    const baseUrl = getServerDirectory().getActiveBaseUrl();
    if (baseUrl === null) {
      return networkFailure<SubtitleFileHandle>('no_connection', 'No active Playarr server is configured.');
    }

    let url: string;
    try {
      url = absoluteUrl(baseUrl, track.url);
    } catch (err) {
      const asError = err as Error;
      return networkFailure<SubtitleFileHandle>('unknown', asError.message);
    }

    const accessToken = getSessionManager().getAccessToken();
    const headers = buildHeaders(currentClientPlatform(), clientVersion, accessToken);
    const requestOptions: HttpRequestOptions = {
      method: 'GET',
      headers: headers,
      dataType: SUBTITLE_DATA_TYPE,
    };

    const response = await sendHttpRequest(url, requestOptions);

    if (response.status === 0) {
      const reason: ApiNetworkFailureReason = response.networkErrorReason ?? 'unknown';
      const message = response.networkErrorMessage ?? 'The network request failed.';
      return networkFailure<SubtitleFileHandle>(reason, message);
    }

    if (response.status < 200 || response.status >= 300) {
      const bodyBytes = response.bodyBytes ?? new ArrayBuffer(0);
      const bodyText = utf8BytesToString(new Uint8Array(bodyBytes));
      const envelope = decodeErrorEnvelope(response.status, response.contentType, bodyText);
      const failure: ApiHttpFailure = { kind: 'http_failure', status: response.status, envelope: envelope };
      return failure;
    }

    const bytes = response.bodyBytes ?? new ArrayBuffer(0);
    const relativePath = sandboxFileName(sessionId, track);

    const wrote = writeBytes(relativePath, bytes);
    if (!wrote) {
      return networkFailure<SubtitleFileHandle>('unknown', 'Failed to write the subtitle track to the app sandbox.');
    }

    const fd = openFd(relativePath);
    if (fd === null) {
      return networkFailure<SubtitleFileHandle>('unknown', 'Failed to open the written subtitle track for reading.');
    }

    const handle: SubtitleFileHandle = { fd: fd };
    const ok: ApiOk<SubtitleFileHandle> = { kind: 'ok', status: response.status, value: handle };
    return ok;
  } catch (err) {
    const asError = err as Error;
    return networkFailure<SubtitleFileHandle>('unknown', asError.message);
  }
}
