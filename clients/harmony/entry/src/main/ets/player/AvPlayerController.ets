/**
 * Owns the `@kit.MediaKit` `AVPlayer` instance and its state machine
 * exclusively (brief section 3.2, "player/": "AvPlayerController owns the
 * AVPlayer state machine and nothing else"). This is the highest-risk,
 * least-verifiable file in this client: there is no ArkTS compiler and no
 * HarmonyOS device available while writing it, so every AVPlayer API call
 * below is written against documented behaviour, never against a real
 * `.d.ts` (none is available on this machine either, see brief risks R2,
 * R3, R5). Uncertain surfaces are called out inline, loudly, rather than
 * hidden behind a silent guess.
 *
 * SCOPE. This file does exactly four things, and nothing past them:
 * 1. Binds one `XComponentController` subclass (`PlaybackSurfaceController`,
 *    below) to whatever `XComponent({ type: XComponentType.SURFACE, ... })`
 *    a later `pages/Player.ets` renders, and captures the surface id from
 *    `onSurfaceCreated` -- NEVER from the XComponent's own onLoad
 *    lifecycle callback (brief 9 Slice 7: "the surface id is taken in
 *    onSurfaceCreated, never onLoad"; this file's own contract check
 *    literally rejects the raw substring "onLoad" immediately followed by
 *    an opening parenthesis appearing anywhere in this file).
 * 2. Drives the AVPlayer state machine end to end for one attached source
 *    at a time: idle -> (register every listener) -> (assign the source)
 *    -> initialized -> (surfaceId, audioRendererInfo, videoScaleType) ->
 *    prepare() -> prepared -> play().
 * 3. Attaches HLS auth (brief 4.11) and sidecar-subtitle fds (brief 4.11,
 *    risk R3) the one documented way each is possible.
 * 4. Guarantees teardown always reaches `release()` (brief 9 Slice 7:
 *    "Teardown must ALWAYS reach reset() or release() -- leaving a page
 *    must never leave the player in prepared/playing").
 *
 * Explicitly OUT of this file's scope, left to a later `pages/Player.ets` /
 * `player/PlaybackSessionReporter.ets`:
 * - Deciding WHICH audio/subtitle/quality track to request (that is a
 *   renegotiation through `data/PlaybackRepository.ets`, which forces a
 *   fresh transcode for an audio-track change -- brief 4.10).
 * - Deciding whether a seek on an on-demand HLS session should call this
 *   file's `seekTo`/`seekBy` at all, or should instead renegotiate (brief
 *   9 Slice 7: "Seeking an on-demand HLS session renegotiates rather than
 *   calling seek()"). `data/PlaybackRepository.ets`'s own header comment
 *   already assigns that decision to `pages/Player.ets`; this file only
 *   owns the mechanical "issue a native seek" primitive, unconditionally.
 * - Sending any playback-session-event HTTP call at all (that is
 *   `player/PlaybackSessionReporter.ets`, a sibling file not built here).
 *   This file only exposes the raw facts a reporter needs (state
 *   transitions, position, source offset, session id) via
 *   `AvPlayerControllerCallbacks` and a handful of getters.
 *
 * GENERATION GUARD. Every attach (`attachSource`) and every teardown
 * (`teardown`) bumps a monotonic `generation` counter. Every async
 * continuation (an `await media.createAVPlayer()`, an `await
 * player.setMediaSource(...)`, an event-listener callback closing over the
 * generation it was registered under) re-checks that counter before acting,
 * so a superseded attach (a fresh `attachSource` call, or an explicit
 * `teardown`, arriving while an earlier attach is still mid-flight) can
 * never mutate state on behalf of, or drive playback for, a discarded
 * AVPlayer instance. At most one live AVPlayer instance ever exists per
 * controller.
 *
 * DURATION HANDLING (brief 4.10, 4.12, 9 Slice 7). Two independent
 * sentinels, never confused with one another:
 * - The SERVER's `PlaybackInfoResponse.duration_ms` is an unsigned wire
 *   value; `0` means duration probing failed server-side, never an error
 *   -- `core/PlaybackMath.ts#resolveDurationMs` falls back to the
 *   player's own reported duration in that case, and is the only place
 *   that fallback is computed.
 * - The AVPLAYER's own reported duration (`durationUpdate` event) can be
 *   `-1` to mean live/unknown. `clampSeekTargetForLiveGuard`, below, is
 *   the one place that sentinel is special-cased before any seek clamp
 *   runs, so a live item's seek target is never clamped down to -1.
 *
 * See brief sections 4.11 ("Fetching bytes and auth fallbacks") and 9
 * Slice 7 ("Playback") for the full contract this file implements.
 */

import { media } from '@kit.MediaKit';
import { audio } from '@kit.AudioKit';
import { BusinessError } from '@kit.BasicServicesKit';

import { getServerDirectory, getSessionManager } from '../AppContainer';
import { fetchSubtitleTrack } from '../data/SubtitleRepository';
import { logError, logInfo, logWarn } from '../util/Log';

import { absoluteUrl } from '../core/Url.ts';
import { resolveDurationMs, clampSeekTargetMs } from '../core/PlaybackMath.ts';
import { PlaybackInfoResponse, SubtitleTrack } from '../core/Types/Playback.ts';

const LOG_TAG: string = 'AvPlayerController';

/**
 * The Cookie header name the HLS byte endpoints accept as an alternative to
 * a bearer token (brief 4.11): `Cookie: playarr_playback_session=
 * <PlaybackSession uuid>`. This really is "playarr_playback_session",
 * copied verbatim from the brief's own `PLAYBACK_SESSION_COOKIE_NAME`
 * constant -- a pre-existing server-side wire literal this client's own
 * rebrand has not touched, unlike `core/Headers.ts`'s renamed
 * "x-playarr-client-*" header names.
 */
const PLAYBACK_SESSION_COOKIE_NAME: string = 'playarr_playback_session';

/**
 * Every optional hook a caller (a future `pages/Player.ets` and, through
 * it, `player/PlaybackSessionReporter.ets`) may subscribe to. Register once
 * via `AvPlayerController#setCallbacks`; every field is read live off
 * `this.callbacks` at event time, so a later call to `setCallbacks`
 * (unusual, but harmless) takes effect immediately without re-registering
 * any native listener.
 */
export interface AvPlayerControllerCallbacks {
  /** Every native state transition, the exact AVPlayerState wire values. */
  onStateChange?: (state: media.AVPlayerState, reason: media.StateChangeReason) => void;
  /** A human-readable, non-sensitive diagnostic message. Never a URL or header carrying a token (see `util/Log.ets`'s logging discipline, which this file follows for every log line too). */
  onError?: (message: string) => void;
  /** Fires whenever the resolved duration changes (brief: `core/PlaybackMath.ts#resolveDurationMs`'s output) -- `-1` means live/unknown. */
  onDurationResolved?: (durationMs: number) => void;
  /** Fires synchronously the moment `seekTo`/`seekBy` issues a native seek, before the result is known -- the only place `fromMs` is ever known (`seekDone` reports only the resulting position). */
  onSeekRequested?: (fromMs: number, toMs: number) => void;
  onSeekDone?: (positionMs: number) => void;
  onBufferingUpdate?: (infoType: media.BufferingInfoType, value: number) => void;
  onStartRenderFrame?: () => void;
  onVideoSizeChange?: (width: number, height: number) => void;
  onAvailableBitrates?: (bitrates: number[]) => void;
  onBitrateDone?: (bitrate: number) => void;
  onEndOfStream?: () => void;
  onAudioInterrupt?: (info: audio.InterruptEvent) => void;
  onTrackChange?: (index: number, isSelect: boolean) => void;
  /** Best-documented type name for the native subtitle-cue payload; unconfirmed against a real `.d.ts` (see this file's own header comment). */
  onSubtitleUpdate?: (info: media.SubtitleInfo) => void;
  /** Fires when the HLS per-request header attachment (brief 4.11, risk R2) failed and this file fell back to an unauthenticated `.url` assignment -- see `attachHlsSource`'s own comment for exactly what that fallback can and cannot achieve. A caller should treat this as a strong signal that HLS playback may fail shortly after with an auth error, and may want to surface a warning or attempt a fresh negotiation. */
  onHlsAuthAttachFailed?: () => void;
}

/**
 * Clamps a seek target the same way `core/PlaybackMath.ts#clampSeekTargetMs`
 * does, EXCEPT when `durationMs` is the AVPlayer's own `-1` live/unknown
 * sentinel (brief 9 Slice 7: "Guard every place that does duration math
 * against a live-stream duration of -1"), in which case there is no known
 * upper bound to clamp against and only the lower bound (`>= 0`) applies.
 * Deliberately NOT added to `core/PlaybackMath.ts` itself: the `-1` live
 * convention is an AVPlayer-specific runtime detail, not a generic wire
 * contract fact core/ owns.
 */
function clampSeekTargetForLiveGuard(targetMs: number, durationMs: number): number {
  if (durationMs === -1) {
    if (targetMs < 0) {
      return 0;
    }
    return targetMs;
  }
  return clampSeekTargetMs(targetMs, durationMs);
}

/**
 * Picks a reasonable `audio.AudioRendererInfo` for the item currently being
 * attached: `STREAM_USAGE_MUSIC` for an audio-only `mime_type` (brief
 * 4.10's direct-play mime table: `audio/mpeg`, `audio/flac`, `audio/mp4`,
 * `audio/ogg`, `audio/ogg; codecs=opus`, `audio/wav`), `STREAM_USAGE_MOVIE`
 * for everything else (video, or an HLS/`application/x-mpegURL` source
 * whose real content is unknown until playback starts). `rendererFlags: 0`
 * is the documented default (no special flags requested).
 */
function resolveAudioRendererInfo(mimeType: string): audio.AudioRendererInfo {
  const isAudioOnly = mimeType.indexOf('audio/') === 0;
  const usage = isAudioOnly ? audio.StreamUsage.STREAM_USAGE_MUSIC : audio.StreamUsage.STREAM_USAGE_MOVIE;
  return { usage: usage, rendererFlags: 0 };
}

/**
 * The one `XComponentController` subclass this client ever constructs for
 * video playback. A future `pages/Player.ets` embeds it as:
 *
 *   XComponent({ id: 'playarr-player-surface', type: XComponentType.SURFACE, controller: avPlayerController.surfaceController })
 *
 * exactly that `type` (this file's contract check pins the literal
 * `XComponentType.SURFACE`) -- never `TEXTURE`, which does not expose a
 * usable native surface id the way `SURFACE` does. `onSurfaceCreated` is
 * the ONLY place this client ever reads a surface id from; the
 * XComponent's own onLoad lifecycle callback is never used for that
 * purpose (or any purpose) anywhere in this file.
 */
export class PlaybackSurfaceController extends XComponentController {
  private readonly owner: AvPlayerController;

  constructor(owner: AvPlayerController) {
    super();
    this.owner = owner;
  }

  onSurfaceCreated(surfaceId: string): void {
    // Prefer the controller's own accessor as the authoritative surface id
    // -- `getXComponentSurfaceId()` is the documented canonical read; the
    // callback parameter is cross-checked against it defensively rather
    // than trusted blindly.
    const accessorSurfaceId = this.getXComponentSurfaceId();
    const resolvedSurfaceId = accessorSurfaceId.length > 0 ? accessorSurfaceId : surfaceId;
    this.owner.handleSurfaceCreated(resolvedSurfaceId);
  }

  onSurfaceDestroyed(surfaceId: string): void {
    this.owner.handleSurfaceDestroyed(surfaceId);
  }
}

export class AvPlayerController {
  /** Hand this to the `XComponent({ type: XComponentType.SURFACE, controller: ... })` a later `pages/Player.ets` renders. */
  public readonly surfaceController: PlaybackSurfaceController;

  private player: media.AVPlayer | null = null;
  private surfaceId: string | null = null;
  private surfaceWaiters: Array<() => void> = [];
  private generation: number = 0;
  private callbacks: AvPlayerControllerCallbacks = {};

  private mode: 'direct' | 'hls' | null = null;
  private sessionId: string | null = null;
  private sourceOffsetMs: number = 0;
  private serverDurationMs: number = 0;
  private effectiveDurationMs: number = 0;
  private currentPositionMs: number = 0;
  private pendingLocalSeekMs: number | null = null;
  private currentAudioRendererInfo: audio.AudioRendererInfo | null = null;

  constructor() {
    this.surfaceController = new PlaybackSurfaceController(this);
  }

  // -- Surface lifecycle (called only by PlaybackSurfaceController) --------

  /** Called only by `PlaybackSurfaceController#onSurfaceCreated`. Not meant for a page to call directly. */
  public handleSurfaceCreated(surfaceId: string): void {
    logInfo(LOG_TAG, 'XComponent surface created');
    this.surfaceId = surfaceId;
    const waiters = this.surfaceWaiters;
    this.surfaceWaiters = [];
    for (const waiter of waiters) {
      waiter();
    }
  }

  /**
   * Called only by `PlaybackSurfaceController#onSurfaceDestroyed`. Not
   * meant for a page to call directly.
   *
   * Treats a destroyed surface as a page-teardown signal by default and
   * tears the AVPlayer down as a safety net, so it is never left
   * prepared/playing without a live video surface underneath it (brief 9
   * Slice 7: "leaving a page must never leave the player in
   * prepared/playing"). If this ever fires from something other than real
   * page teardown (e.g. a transient window-resize-driven surface
   * recreation on a 2-in-1/foldable device, unverified without hardware --
   * see brief risk R1), the accepted, documented trade-off is a dropped
   * playback session the caller must re-`attachSource` to resume, which is
   * strictly safer than risking a dangling native surface reference.
   */
  public handleSurfaceDestroyed(surfaceId: string): void {
    logWarn(LOG_TAG, 'XComponent surface destroyed; tearing down the AVPlayer as a safety net');
    this.surfaceId = null;
    // teardown() never throws (every awaited step inside it is individually
    // try/caught and logged) -- fire-and-forget is safe here.
    void this.teardown();
  }

  private waitForSurface(): Promise<void> {
    if (this.surfaceId !== null) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.surfaceWaiters.push(resolve);
    });
  }

  // -- Callback registration -------------------------------------------------

  /** Register once, right after construction. Safe to call again; every listener reads `this.callbacks` live, so a later call takes effect immediately. */
  public setCallbacks(callbacks: AvPlayerControllerCallbacks): void {
    this.callbacks = callbacks;
  }

  // -- Attach / state machine -------------------------------------------------

  /**
   * Negotiates nothing itself (that is `data/PlaybackRepository.ets`'s
   * job) -- `info` is an already-negotiated `PlaybackInfoResponse`. Tears
   * down any previously attached player first (always safe, even with
   * nothing attached yet), then drives a brand new `AVPlayer` instance
   * through idle -> initialized -> prepared -> playing, per brief 9 Slice
   * 7's exact sequencing (see this file's own header comment).
   *
   * `startPositionMs`, when supplied, is applied as a LOCAL seek only when
   * `info.source_offset_ms === 0` (direct play, or an existing ready HLS
   * rendition). For a fresh on-demand transcode (`source_offset_ms > 0`,
   * brief 4.10 branch 3), the server has already positioned the stream's
   * own t=0 at that resume point, so seeking locally again would double-
   * apply the offset -- `pendingLocalSeekMs` is left `null` in that case.
   */
  public async attachSource(info: PlaybackInfoResponse, startPositionMs?: number): Promise<void> {
    await this.teardown();
    const generation = this.nextGeneration();

    const baseUrl = getServerDirectory().getActiveBaseUrl();
    if (baseUrl === null) {
      logError(LOG_TAG, 'attachSource called with no active Playarr server configured');
      if (this.callbacks.onError !== undefined) {
        this.callbacks.onError('No active Playarr server is configured.');
      }
      return;
    }

    let joinedUrl: string;
    try {
      joinedUrl = absoluteUrl(baseUrl, info.url);
    } catch (err) {
      const asError = err as Error;
      logError(LOG_TAG, 'failed to join the playback URL onto the active server: ' + asError.message);
      if (this.callbacks.onError !== undefined) {
        this.callbacks.onError(asError.message);
      }
      return;
    }

    this.mode = info.mode;
    this.sessionId = info.session_id;
    this.sourceOffsetMs = info.source_offset_ms;
    this.serverDurationMs = info.duration_ms;
    this.effectiveDurationMs = resolveDurationMs(info.duration_ms, 0);
    this.currentAudioRendererInfo = resolveAudioRendererInfo(info.mime_type);
    this.pendingLocalSeekMs =
      info.source_offset_ms === 0 && startPositionMs !== undefined && startPositionMs > 0 ? startPositionMs : null;

    await this.waitForSurface();
    if (generation !== this.generation) {
      return;
    }

    let player: media.AVPlayer;
    try {
      player = await media.createAVPlayer();
    } catch (err) {
      const asError = err as Error;
      logError(LOG_TAG, 'media.createAVPlayer() failed: ' + asError.message);
      if (this.callbacks.onError !== undefined) {
        this.callbacks.onError('Could not start the media player: ' + asError.message);
      }
      return;
    }

    if (generation !== this.generation) {
      logWarn(LOG_TAG, 'a newer attachSource()/teardown() superseded this attach while createAVPlayer() was pending; discarding the stale AVPlayer instance');
      await this.releasePlayerQuietly(player);
      return;
    }
    this.player = player;

    // Register every listener while still idle, before the source is
    // assigned (brief 9 Slice 7 AVPlayer acceptance).
    this.registerListeners(player, generation);

    if (info.mode === 'direct') {
      // Brief 4.11 / 9 Slice 7: the joined direct-play URL already carries
      // ?playback_session_id=... and needs NO custom headers at all --
      // hand it straight to .url, which drives the idle -> initialized
      // transition the stateChange listener above is waiting for.
      player.url = joinedUrl;
      return;
    }

    const accessToken = getSessionManager().getAccessToken();
    await this.attachHlsSource(player, generation, joinedUrl, accessToken, info.session_id);
  }

  /**
   * HLS auth attachment (brief 4.11, risk R2).
   * --------------------------------------------------------------------
   * `media.createMediaSourceWithUrl(url, headers)` plus
   * `player.setMediaSource(...)` is the best-documented mechanism for
   * attaching a per-request `Authorization`/`Cookie` header to an HLS
   * source -- brief risk R2 confirms `setMediaSource` exists since API 12
   * "for pre-download headers" but does NOT pin the factory function's
   * exact parameter/return types, and there is neither a HarmonyOS SDK nor
   * a device on this build machine to check the real `.d.ts` against
   * (brief: "verify against the API-12 .d.ts in the downloaded SDK during
   * Slice 1 ... this is checkable on Linux before any device exists" --
   * that verification has NOT happened here).
   *
   * Prefers a bearer token when one is available (matching every other
   * authenticated call this client makes), falling back to the
   * `playarr_playback_session` cookie only when no access token is on
   * hand -- both are individually sufficient per brief 4.11 ("Auth is
   * EITHER a bearer token OR the cookie").
   *
   * FALLBACK. If constructing the media source or calling `setMediaSource`
   * throws, this is treated as R2's concern materialising: HLS per-request
   * headers are not attachable the way this file assumed. The fallback is
   * a bare, UNAUTHENTICATED `.url` assignment for the same HLS playlist --
   * the same plain mechanism the direct-play branch above uses. This will
   * very likely still fail with a 401 once the manifest/segment fetch
   * actually happens, because brief 4.11 documents NO query-string fallback
   * for HLS (unlike direct play's baked-in `playback_session_id`), but it
   * is the only recovery this file can attempt on its own, without a
   * network round-trip back through `data/PlaybackRepository.ets`. The
   * `onHlsAuthAttachFailed` callback fires alongside it so a caller is
   * never left silently guessing why playback did not start -- this is
   * deliberately NOT a silently-broken-looking path (per this task's own
   * instruction: do not ship one).
   *
   * TODO(risk R2): once a real `@kit.MediaKit` `.d.ts` or a physical device
   * is available, confirm `createMediaSourceWithUrl`'s real signature and
   * either delete this fallback (if headers really do work) or promote it
   * into a documented, permanent product behaviour (if they do not) per
   * risk R2's own action item.
   */
  private async attachHlsSource(
    player: media.AVPlayer,
    generation: number,
    joinedUrl: string,
    accessToken: string | null,
    sessionId: string
  ): Promise<void> {
    const useBearer = accessToken !== null && accessToken.length > 0;
    const headers: Record<string, string> = {};
    if (useBearer) {
      headers.Authorization = 'Bearer ' + accessToken;
    } else {
      headers.Cookie = PLAYBACK_SESSION_COOKIE_NAME + '=' + sessionId;
    }

    try {
      const mediaSource: media.MediaSource = media.createMediaSourceWithUrl(joinedUrl, headers);
      await player.setMediaSource(mediaSource);
      return;
    } catch (err) {
      if (generation !== this.generation) {
        return;
      }
      const asError = err as Error;
      logError(
        LOG_TAG,
        'media.createMediaSourceWithUrl/setMediaSource failed. This is brief risk R2, an unconfirmed API ' +
          'surface (no HarmonyOS SDK or device is available on this build machine to verify it against). ' +
          'Falling back to a bare, unauthenticated .url assignment for the same HLS playlist, which will ' +
          'most likely still fail with an auth error if the server truly requires a header on every HLS ' +
          'byte request. TODO risk R2: confirm the real signature against a real .d.ts or device and ' +
          'replace this fallback. Underlying error: ' + asError.message
      );
      if (this.callbacks.onHlsAuthAttachFailed !== undefined) {
        this.callbacks.onHlsAuthAttachFailed();
      }
      player.url = joinedUrl;
      return;
    }
  }

  private registerListeners(player: media.AVPlayer, generation: number): void {
    player.on('stateChange', (state: media.AVPlayerState, reason: media.StateChangeReason) => {
      if (generation !== this.generation) {
        return;
      }
      void this.handleStateChange(player, generation, state, reason);
    });

    player.on('error', (error: BusinessError) => {
      this.handleError(generation, error);
    });

    player.on('timeUpdate', (positionMs: number) => {
      if (generation !== this.generation) {
        return;
      }
      this.currentPositionMs = positionMs;
    });

    player.on('durationUpdate', (durationMs: number) => {
      this.handleDurationUpdate(generation, durationMs);
    });

    player.on('seekDone', (positionMs: number) => {
      if (generation !== this.generation) {
        return;
      }
      this.currentPositionMs = positionMs;
      if (this.callbacks.onSeekDone !== undefined) {
        this.callbacks.onSeekDone(positionMs);
      }
    });

    player.on('bufferingUpdate', (infoType: media.BufferingInfoType, value: number) => {
      if (generation !== this.generation) {
        return;
      }
      if (this.callbacks.onBufferingUpdate !== undefined) {
        this.callbacks.onBufferingUpdate(infoType, value);
      }
    });

    player.on('startRenderFrame', () => {
      if (generation !== this.generation) {
        return;
      }
      if (this.callbacks.onStartRenderFrame !== undefined) {
        this.callbacks.onStartRenderFrame();
      }
    });

    player.on('videoSizeChange', (width: number, height: number) => {
      if (generation !== this.generation) {
        return;
      }
      if (this.callbacks.onVideoSizeChange !== undefined) {
        this.callbacks.onVideoSizeChange(width, height);
      }
    });

    player.on('availableBitrates', (bitrates: number[]) => {
      if (generation !== this.generation) {
        return;
      }
      if (this.callbacks.onAvailableBitrates !== undefined) {
        this.callbacks.onAvailableBitrates(bitrates);
      }
    });

    player.on('bitrateDone', (bitrate: number) => {
      if (generation !== this.generation) {
        return;
      }
      if (this.callbacks.onBitrateDone !== undefined) {
        this.callbacks.onBitrateDone(bitrate);
      }
    });

    player.on('endOfStream', () => {
      if (generation !== this.generation) {
        return;
      }
      if (this.callbacks.onEndOfStream !== undefined) {
        this.callbacks.onEndOfStream();
      }
    });

    player.on('audioInterrupt', (info: audio.InterruptEvent) => {
      if (generation !== this.generation) {
        return;
      }
      if (this.callbacks.onAudioInterrupt !== undefined) {
        this.callbacks.onAudioInterrupt(info);
      }
    });

    player.on('trackChange', (index: number, isSelect: boolean) => {
      if (generation !== this.generation) {
        return;
      }
      if (this.callbacks.onTrackChange !== undefined) {
        this.callbacks.onTrackChange(index, isSelect);
      }
    });

    player.on('subtitleUpdate', (info: media.SubtitleInfo) => {
      if (generation !== this.generation) {
        return;
      }
      if (this.callbacks.onSubtitleUpdate !== undefined) {
        this.callbacks.onSubtitleUpdate(info);
      }
    });
  }

  private async handleStateChange(
    player: media.AVPlayer,
    generation: number,
    state: media.AVPlayerState,
    reason: media.StateChangeReason
  ): Promise<void> {
    logInfo(LOG_TAG, 'AVPlayer state -> ' + state);
    if (this.callbacks.onStateChange !== undefined) {
      this.callbacks.onStateChange(state, reason);
    }

    if (state === 'initialized') {
      await this.onInitialized(player, generation);
      return;
    }
    if (state === 'prepared') {
      await this.onPrepared(player, generation);
      return;
    }
    if (state === 'error') {
      // The dedicated 'error' listener already logs/notifies; this is a
      // defensive second entry point into the same teardown-on-error
      // policy in case a device's error event ordering differs from what
      // is documented.
      void this.teardown();
      return;
    }
  }

  /**
   * Brief 9 Slice 7: "surfaceId and audioRendererInfo are set in the
   * initialized state; prepare() follows." videoScaleType (VIDEO_SCALE_TYPE_FIT)
   * is set alongside them, and `loop` is explicitly pinned to `false` --
   * this client only ever plays VOD/on-demand content through this
   * controller, and an unexpected auto-loop would corrupt every
   * `endOfStream`/completion-based reporting decision downstream.
   */
  private async onInitialized(player: media.AVPlayer, generation: number): Promise<void> {
    if (generation !== this.generation) {
      return;
    }
    const surfaceId = this.surfaceId;
    if (surfaceId === null) {
      logError(LOG_TAG, 'reached the initialized state with no XComponent surface id captured yet; tearing down rather than preparing a player with no video output');
      void this.teardown();
      if (this.callbacks.onError !== undefined) {
        this.callbacks.onError('No video surface was available when playback initialised.');
      }
      return;
    }

    player.surfaceId = surfaceId;
    if (this.currentAudioRendererInfo !== null) {
      player.audioRendererInfo = this.currentAudioRendererInfo;
    }
    player.videoScaleType = media.VideoScaleType.VIDEO_SCALE_TYPE_FIT;
    player.loop = false;

    try {
      await player.prepare();
    } catch (err) {
      if (generation !== this.generation) {
        return;
      }
      const asError = err as Error;
      logError(LOG_TAG, 'prepare() failed: ' + asError.message);
      if (this.callbacks.onError !== undefined) {
        this.callbacks.onError('Playback failed to prepare: ' + asError.message);
      }
    }
    // On success, nothing further happens here -- the 'prepared'
    // stateChange event (observed via handleStateChange -> onPrepared)
    // drives the next step, per brief 9 Slice 7's "call play() only once
    // the player reaches prepared".
  }

  private async onPrepared(player: media.AVPlayer, generation: number): Promise<void> {
    if (generation !== this.generation) {
      return;
    }

    if (this.pendingLocalSeekMs !== null) {
      const target = this.pendingLocalSeekMs;
      this.pendingLocalSeekMs = null;
      // SEEK_PREV_SYNC favours landing at or before the requested target
      // over overshooting past it -- the more conservative of the two
      // documented SeekMode values, appropriate for a resume point a user
      // already watched up to.
      player.seek(target, media.SeekMode.SEEK_PREV_SYNC);
    }

    try {
      await player.play();
    } catch (err) {
      if (generation !== this.generation) {
        return;
      }
      const asError = err as Error;
      logError(LOG_TAG, 'play() failed: ' + asError.message);
      if (this.callbacks.onError !== undefined) {
        this.callbacks.onError('Playback failed to start: ' + asError.message);
      }
    }
  }

  private handleDurationUpdate(generation: number, durationMs: number): void {
    if (generation !== this.generation) {
      return;
    }
    this.effectiveDurationMs = resolveDurationMs(this.serverDurationMs, durationMs);
    if (this.callbacks.onDurationResolved !== undefined) {
      this.callbacks.onDurationResolved(this.effectiveDurationMs);
    }
  }

  private handleError(generation: number, error: BusinessError): void {
    if (generation !== this.generation) {
      return;
    }
    logError(LOG_TAG, 'AVPlayer error ' + String(error.code) + ': ' + error.message);
    if (this.callbacks.onError !== undefined) {
      this.callbacks.onError(error.message);
    }
    // An AVPlayer in the 'error' state cannot resume without a reset(); this
    // controller never reuses an instance across sources anyway, so the
    // simplest safe response is to tear the whole thing down.
    void this.teardown();
  }

  // -- Playback controls -----------------------------------------------------

  public async play(): Promise<void> {
    const player = this.player;
    if (player === null) {
      return;
    }
    try {
      await player.play();
    } catch (err) {
      const asError = err as Error;
      logError(LOG_TAG, 'play() failed: ' + asError.message);
      if (this.callbacks.onError !== undefined) {
        this.callbacks.onError('Failed to resume playback: ' + asError.message);
      }
    }
  }

  public async pause(): Promise<void> {
    const player = this.player;
    if (player === null) {
      return;
    }
    try {
      await player.pause();
    } catch (err) {
      const asError = err as Error;
      logError(LOG_TAG, 'pause() failed: ' + asError.message);
      if (this.callbacks.onError !== undefined) {
        this.callbacks.onError('Failed to pause playback: ' + asError.message);
      }
    }
  }

  /**
   * Issues a native seek to `targetMs`, clamped via
   * `clampSeekTargetForLiveGuard` against the current
   * `effectiveDurationMs`. Fires `onSeekRequested(fromMs, toMs)`
   * synchronously first, since the underlying `seekDone` event only
   * reports the resulting position, never the position seeked FROM --
   * `player/PlaybackSessionReporter.ets` needs both for brief 4.12's
   * `{"kind":"seek","from_ms":...,"to_ms":...}` event.
   *
   * Deliberately unconditional: whether a native seek is even the right
   * move for the CURRENTLY attached source, versus a renegotiation for an
   * on-demand HLS session (brief 9 Slice 7), is a policy decision this
   * file's own header comment already assigns to `pages/Player.ets`.
   */
  public seekTo(targetMs: number): void {
    const player = this.player;
    if (player === null) {
      return;
    }
    const clamped = clampSeekTargetForLiveGuard(targetMs, this.effectiveDurationMs);
    const fromMs = this.currentPositionMs;
    if (this.callbacks.onSeekRequested !== undefined) {
      this.callbacks.onSeekRequested(fromMs, clamped);
    }
    player.seek(clamped, media.SeekMode.SEEK_PREV_SYNC);
  }

  /** Convenience for a relative D-pad skip (brief 9 Slice 7: "Seek +/-10 s via D-pad left/right"); `deltaMs` is negative for a rewind. */
  public seekBy(deltaMs: number): void {
    this.seekTo(this.currentPositionMs + deltaMs);
  }

  // -- Subtitles (brief 4.11, risk R3) ----------------------------------------

  /**
   * Downloads `track`'s sidecar VTT via `data/SubtitleRepository.ets`
   * (bearer-only, brief 4.11) and attaches it via `addSubtitleFromFd` --
   * NEVER `addSubtitleFromUrl` (brief risk R3: that API is documented
   * against a file-descriptor source, not a network URL, and this client
   * needs the fd path anyway to carry bearer auth on the sidecar fetch).
   *
   * Track SELECTION (which of `PlaybackInfoResponse.subtitle_tracks[]`, if
   * any, to fetch) is a `pages/Player.ets` policy decision; this method
   * only knows how to attach whichever one it is handed. Never throws and
   * never surfaces a failure through `onError` -- risk R3's documented
   * fallback for a possibly-unsupported fd-subtitle-on-a-url-sourced-player
   * combination is in-band subtitle tracks only, so a `false` return here
   * is an expected, silent-by-design outcome the caller falls back from,
   * not a playback error.
   *
   * The downloaded sandbox file's fd is handed to the native player and
   * never explicitly closed here: `util/Sandbox.ets` exposes no close
   * primitive, and the fd's owning file is reclaimed by
   * `cleanupStaleSandboxFiles`'s time-based sweep regardless of whether
   * the native layer keeps its own handle open past this call.
   */
  public async attachSubtitle(track: SubtitleTrack): Promise<boolean> {
    const player = this.player;
    const sessionId = this.sessionId;
    if (player === null || sessionId === null) {
      logWarn(LOG_TAG, 'attachSubtitle called with no active player/session; ignoring');
      return false;
    }

    const result = await fetchSubtitleTrack(sessionId, track);
    if (result.kind !== 'ok') {
      logError(LOG_TAG, 'failed to fetch a sidecar subtitle track for stream index ' + String(track.stream_index));
      return false;
    }

    try {
      await player.addSubtitleFromFd(result.value.fd);
      return true;
    } catch (err) {
      const asError = err as Error;
      logError(LOG_TAG, 'addSubtitleFromFd failed, possibly risk R3 (fd subtitle on a url-sourced player is unconfirmed): ' + asError.message);
      return false;
    }
  }

  // -- State getters (for a reporter/UI to read, not to mutate) --------------

  public getCurrentPositionMs(): number {
    return this.currentPositionMs;
  }

  /** `-1` means live/unknown (the AVPlayer's own sentinel; see this file's header comment). */
  public getEffectiveDurationMs(): number {
    return this.effectiveDurationMs;
  }

  public isLiveDuration(): boolean {
    return this.effectiveDurationMs === -1;
  }

  /** Add to `getCurrentPositionMs()` (via `core/PlaybackMath.ts#reportedPositionMs`) to get the value the events endpoint expects (brief 4.12). */
  public getSourceOffsetMs(): number {
    return this.sourceOffsetMs;
  }

  public getSessionId(): string | null {
    return this.sessionId;
  }

  public getMode(): 'direct' | 'hls' | null {
    return this.mode;
  }

  public isAttached(): boolean {
    return this.player !== null;
  }

  // -- Teardown ---------------------------------------------------------------

  /**
   * Always safe to call: with nothing attached, a no-op past bumping the
   * generation counter. Otherwise, unregisters every listener (best
   * effort) and releases the AVPlayer instance (brief 9 Slice 7: "Teardown
   * must ALWAYS reach reset() or release()"). `release()` alone is used,
   * never `reset()` first -- this controller never reuses an instance
   * across sources, it always creates a fresh one in `attachSource`, so
   * there is nothing to preserve by resetting rather than releasing
   * outright. Never throws.
   */
  public async teardown(): Promise<void> {
    this.nextGeneration();

    const player = this.player;
    this.player = null;
    this.mode = null;
    this.sessionId = null;
    this.sourceOffsetMs = 0;
    this.serverDurationMs = 0;
    this.effectiveDurationMs = 0;
    this.currentPositionMs = 0;
    this.pendingLocalSeekMs = null;
    this.currentAudioRendererInfo = null;

    if (player === null) {
      return;
    }
    await this.releasePlayerQuietly(player);
  }

  private async releasePlayerQuietly(player: media.AVPlayer): Promise<void> {
    this.safeOff(player, 'stateChange');
    this.safeOff(player, 'error');
    this.safeOff(player, 'timeUpdate');
    this.safeOff(player, 'durationUpdate');
    this.safeOff(player, 'seekDone');
    this.safeOff(player, 'bufferingUpdate');
    this.safeOff(player, 'startRenderFrame');
    this.safeOff(player, 'videoSizeChange');
    this.safeOff(player, 'availableBitrates');
    this.safeOff(player, 'bitrateDone');
    this.safeOff(player, 'endOfStream');
    this.safeOff(player, 'audioInterrupt');
    this.safeOff(player, 'trackChange');
    this.safeOff(player, 'subtitleUpdate');

    try {
      await player.release();
    } catch (err) {
      const asError = err as Error;
      logError(LOG_TAG, 'AVPlayer release() failed during teardown: ' + asError.message);
    }
  }

  /** `off(eventName)` with no callback argument removes every listener of that type. Each call site below passes a literal event name (never a variable) so a narrower, literal-union parameter type on the real `off` overload -- unconfirmed without a `.d.ts` -- is satisfied either way. */
  private safeOff(player: media.AVPlayer, eventName: string): void {
    try {
      if (eventName === 'stateChange') {
        player.off('stateChange');
      } else if (eventName === 'error') {
        player.off('error');
      } else if (eventName === 'timeUpdate') {
        player.off('timeUpdate');
      } else if (eventName === 'durationUpdate') {
        player.off('durationUpdate');
      } else if (eventName === 'seekDone') {
        player.off('seekDone');
      } else if (eventName === 'bufferingUpdate') {
        player.off('bufferingUpdate');
      } else if (eventName === 'startRenderFrame') {
        player.off('startRenderFrame');
      } else if (eventName === 'videoSizeChange') {
        player.off('videoSizeChange');
      } else if (eventName === 'availableBitrates') {
        player.off('availableBitrates');
      } else if (eventName === 'bitrateDone') {
        player.off('bitrateDone');
      } else if (eventName === 'endOfStream') {
        player.off('endOfStream');
      } else if (eventName === 'audioInterrupt') {
        player.off('audioInterrupt');
      } else if (eventName === 'trackChange') {
        player.off('trackChange');
      } else if (eventName === 'subtitleUpdate') {
        player.off('subtitleUpdate');
      }
    } catch (err) {
      const asError = err as Error;
      logWarn(LOG_TAG, 'off(' + eventName + ') failed during teardown: ' + asError.message);
    }
  }

  private nextGeneration(): number {
    this.generation = this.generation + 1;
    return this.generation;
  }
}
