/**
 * Playback page (brief section 2.5: "Player.ets -- XComponent surface +
 * custom control chrome + key handling"; brief section 9, Slice 7). Pushed
 * onto the shared `NavPathStack` by name (`navigation/Routes.ets`'s
 * `ROUTES.Player`) with a `PlayerRouteParams` (`{mediaFileId, workId,
 * startPositionMs?}`) -- see `PlayerBuilder`, at the bottom of this file,
 * for the exact param-decoding entry point `router_map.json`'s `Player` row
 * targets.
 *
 * This file is pure orchestration over four already-built collaborators
 * (their own header comments document the exact contract each one owns;
 * this file never re-derives any of it):
 * - `data/PlaybackRepository.ets#negotiatePlayback` -- the ONE negotiation
 *   call (brief 4.10), called exactly once per playback start and again,
 *   deliberately, on a renegotiation trigger (see "Renegotiation", below).
 * - `player/AvPlayerController.ets` -- the AVPlayer state machine. One
 *   instance for this page's whole lifetime; `attachSource` is called once
 *   per negotiated `PlaybackInfoResponse`, including on renegotiation (it
 *   tears down its own previously attached player first, so the same
 *   `XComponent` surface survives across a reattach).
 * - `player/PlaybackSessionReporter.ets` -- session-event + watch-progress
 *   reporting (brief 4.12). One instance per negotiated `session_id`; a
 *   renegotiation discards the old instance (after tearing it down) and
 *   constructs a fresh one bound to the new `session_id`.
 * - `player/PlayerInput.ets` / `player/PlayerChrome.ets` -- key-code
 *   mapping and the custom control bar. Neither owns any playback state;
 *   both are driven from and report back into this page's own `@State`.
 *
 * ## Renegotiation (brief 4.10's explicit warning, brief 9 Slice 7)
 *
 * "Always send a stop event for the old session_id before renegotiating."
 * `renegotiate()` is the one and only place this file calls
 * `negotiatePlayback` a second time, and it always awaits the OLD
 * reporter's `teardown()` (final heartbeat, then `{"kind":"stop",
 * "reason":"user_stopped"}` for the OLD `session_id`) before issuing the
 * new negotiation GET. Two triggers reach it today:
 * - Seeking an on-demand HLS session (`isOnDemandHlsInfo`, below, tells
 *   this shape apart from direct play or an already-ready HLS rendition by
 *   the negotiated `url`'s own path shape -- brief 4.10's three branches
 *   put a fresh transcode under `/media/sessions/...` and a ready rendition
 *   under `/media/renditions/...`, and only the former needs a
 *   renegotiation rather than a native seek, per Slice 7's own acceptance:
 *   "Seeking an on-demand HLS session renegotiates rather than calling
 *   seek()"). The renegotiated `start_position_ms` is computed in the
 *   ABSOLUTE/source domain (`core/PlaybackMath.ts#reportedPositionMs`
 *   applied to the current raw player position, brief 4.10: "the client
 *   must ADD [source_offset_ms] to every reported position"), matching
 *   what `start_position_ms` means server-side (the same domain
 *   `source_offset_ms` is later computed FROM, brief 4.10 branch 3).
 * - A quality/audio-track change, per brief 9 Slice 7 ("wire the hook even
 *   if nothing calls it yet"): `renegotiate()` accepts an arbitrary
 *   `PlaybackNegotiationOptions`, so a future quality/track picker only
 *   needs to call it with `{profile}`/`{audioStreamIndex}` -- no UI for
 *   that exists on this screen yet (brief 9 Slice 9 stretch scope), so
 *   nothing calls it that way today, but the mechanism (stop-old-session-
 *   then-negotiate-new) is already correct and exercised by the seek path
 *   above.
 *
 * ## Immersive mode (brief 6.4)
 *
 * "Immersive is a window-level setting with no page-level equivalent...
 * that is the documented workaround, not a hack." The brief's own wording
 * ("toggle it in the player page's onPageShow and restore in onPageHide")
 * predates this file: `Player.ets` is a `NavDestination`-hosted page (like
 * `Detail.ets`/`Library.ets`), never a standalone Entry-decorated page of
 * its own, so it has no literal `onPageShow`/`onPageHide` page-router
 * lifecycle of its own the way `pages/Index.ets` (the app's one Entry-
 * decorated root) would. This file wires BOTH of the two real ArkUI
 * mechanisms that could plausibly be what
 * a `NavDestination`-hosted component's "shown"/"hidden" transitions mean
 * on a real device -- `NavDestination`'s own `.onShown()`/`.onHidden()`
 * events (a stable, well-documented API this project is confident about)
 * AND this component's own `onPageShow()`/`onPageHide()` struct lifecycle
 * methods (in case the runtime also fires those for a `NavDestination`
 * child, which is NOT confirmed without a device) -- both calling the same
 * idempotent `enterImmersiveMode`/`exitImmersiveMode` pair. Whichever
 * mechanism actually fires on a real HarmonyOS NEXT device, immersive mode
 * still toggles correctly; if both fire, the idempotency guards (`
 * windowHandle`'s null-check) make the second call a no-op. This is
 * deliberate hedging against a genuinely unconfirmed API surface, matching
 * this project's "record it as an explicit divergence, not a silent one"
 * posture (`player/AvPlayerController.ets`'s own header comment) rather
 * than silently picking one and hoping.
 *
 * ## Teardown ordering (brief 9 Slice 7)
 *
 * Every exit path (`handleBack`, `handleEndOfStream`, an AVPlayer-level
 * error) funnels through `teardownSessionOnly`, which ALWAYS awaits the
 * reporter's `teardown()` (final heartbeat, then the terminal `stop`/
 * `error` event) before calling the controller's own `teardown()`
 * (`release()`), in that exact order -- never the reverse, so the
 * session-events endpoint is never asked to close a session for a
 * `media_file_id` whose native player has already been released out from
 * under it. `hasExited` makes this idempotent: back, end-of-stream, a
 * native error and `aboutToDisappear`'s own safety net can never run this
 * sequence twice for the same page instance.
 *
 * ## Layer isolation (brief 3.1, validator-asserted)
 *
 * This file imports only `data/`, `player/`, `design/`, `core/`,
 * `navigation/` and `device/` -- never `net/` or `auth/`. Every `data/`
 * call already resolves to a `Promise<ApiResult<T>>`; this file narrows
 * the result by reading `.kind` directly off the inferred local, exactly
 * like `pages/Detail.ets` does, rather than importing `ApiResult`/
 * `isApiOk` from `net/ApiResult.ets`.
 */

import { window } from '@kit.ArkUI';
import { common } from '@kit.AbilityKit';
import { media } from '@kit.MediaKit';
import { image } from '@kit.ImageKit';
import { audio } from '@kit.AudioKit';

import { negotiatePlayback } from '../data/PlaybackRepository';
import type { PlaybackNegotiationOptions } from '../data/PlaybackRepository';
import { getWorkDetail, getSimilarWorks } from '../data/CatalogRepository';
import { fetchWorkArtworkByPriority, COVER_ARTWORK_PRIORITY } from '../data/ArtworkRepository';

import { AvPlayerController } from '../player/AvPlayerController';
import type { AvPlayerControllerCallbacks } from '../player/AvPlayerController';
import { PlaybackSessionReporter } from '../player/PlaybackSessionReporter';
import type { PlaybackTeardownOutcome } from '../player/PlaybackSessionReporter';
import { PlayerChrome } from '../player/PlayerChrome';
import { EndScreen } from '../player/EndScreen';
import { MediaRail } from '../design/components/MediaRail';
import type { MediaRailItem } from '../design/components/MediaRail';
import { PosterCard } from '../design/components/PosterCard';
import { resolvePlayerAction, SEEK_STEP_MS } from '../player/PlayerInput';
import type { PlayerAction } from '../player/PlayerInput';

import { resolveDurationMs, reportedPositionMs, clampSeekTargetMs } from '../core/PlaybackMath.ts';
import type { PlaybackInfoResponse, SubtitleTrack } from '../core/Types/Playback.ts';
import type { Work } from '../core/Types/Work.ts';
import {
  EndOfPlaybackMachine,
  pickSuggestions,
  END_SCREEN_MAX_SUGGESTIONS,
  END_SCREEN_COUNTDOWN_SECONDS,
} from '../core/EndOfPlayback.ts';
import type { QueueItem } from '../core/EndOfPlayback.ts';
import type { DeviceProfile } from '../core/DeviceProfile.ts';
import { Spacing, Radii } from '../core/Tokens';
import type { RgbaColor } from '../core/Tokens';

import { toResourceColor, toResourceColorWithAlpha } from '../design/Theme';
import { isTvMetrics, tv, TvGeometry, TouchGeometry } from '../design/Metrics';

import { ROUTES } from '../navigation/Routes';
import type { PlayerRouteParams, DetailRouteParams } from '../navigation/Routes';
import { getNavStack, popRoute, replaceRoute } from '../navigation/NavStack';

import { DEVICE_PROFILE_STORAGE_KEY } from '../device/DeviceProfileService';

import { logError, logWarn } from '../util/Log';

const LOG_TAG: string = 'Player';

/** Brief 4.12: "heartbeat every 10 s while playing or buffering." */
const HEARTBEAT_INTERVAL_MS: number = 10000;

/** Not a brief literal -- how often this page polls
 * `AvPlayerController#getCurrentPositionMs()` to refresh the progress bar.
 * `player/AvPlayerController.ets` tracks position internally off the
 * native `timeUpdate` event but does not forward it through
 * `AvPlayerControllerCallbacks` (that interface has no `onTimeUpdate`
 * field), so a UI consumer polls the getter instead of subscribing to an
 * event -- the same documented-exception pattern this codebase uses
 * throughout for a UI-only value with no home in a brief literal. */
const UI_TICK_INTERVAL_MS: number = 500;

/** brief 9 Slice 7 / player/PlayerInput.ets: "Seek amount is +/-10 s." */
const SUBTITLE_FONT_SIZE: number = 16;
const SUBTITLE_BADGE_RADIUS: number = 4;
/** Not a brief literal -- a fixed clearance so the subtitle cue never
 * overlaps `player/PlayerChrome.ets`'s own control bar while it is
 * visible; PlayerChrome exposes no height/measurement callback for this
 * page to read back exactly, so this is a reasoned estimate of the
 * control bar's own height, not a measured value. */
const SUBTITLE_BOTTOM_MARGIN_TV: number = 170;
const SUBTITLE_BOTTOM_MARGIN_TOUCH: number = 130;
const OVERLAY_TEXT_SIZE_TV: number = 20;
const OVERLAY_TEXT_SIZE_TOUCH: number = 15;

/** Always-dark literals (brief 5.6: "the player [is] always dark
 * regardless of theme") -- matching `player/PlayerChrome.ets`'s own
 * identical, deliberately un-theme-reactive palette (duplicated here
 * rather than imported since they are private to that file). Reusing
 * `design/Theme.ets`'s `activeColors()` for this page's own loading/error
 * background or text would be a real bug, not just an inconsistency: a
 * LIGHT-mode ink colour rendered over this page's fixed-dark background
 * would have little or no contrast. */
const PLAYER_BG: RgbaColor = { r: 8, g: 6, b: 8, a: 1 };
const PLAYER_TEXT_PRIMARY: RgbaColor = { r: 255, g: 255, b: 255, a: 1 };

/** This page's own three states, distinct from `media.AVPlayerState`
 * (which `player/AvPlayerController.ets` owns entirely) -- `'loading'`
 * covers both the very first negotiation and any renegotiation in
 * flight; `'error'` is reached only when a negotiation call itself fails
 * (never for an AVPlayer-level playback error once a source is already
 * attached, which instead tears the page down via `handlePlaybackError`,
 * matching brief 9 Slice 7's "leaving a page must never leave the player
 * in prepared/playing"). */
type PlayerPhase = 'loading' | 'error' | 'ready';

/** One tile of the end screen's "More like this" row. */
interface SuggestionRow {
  id: string;
  title: string;
  subtitle: string;
  artwork: image.PixelMap | undefined;
}

@Component
struct Player {
  @Prop mediaFileId: string = '';
  @Prop workId: string = '';
  /** `0` means "no requested resume position", matching
   * `player/AvPlayerController.ets#attachSource`'s own
   * `startPositionMs > 0` threshold for whether a local seek applies. */
  @Prop startPositionMs: number = 0;
  /** Items queued after the current one (next episodes / tracks). */
  @Prop queue: QueueItem[] = [];

  /** One instance for this page's whole lifetime; `attachSource` may be
   * called on it more than once (initial load, then any renegotiation) --
   * see this file's header comment. */
  private readonly controller: AvPlayerController = new AvPlayerController();

  @State private phase: PlayerPhase = 'loading';
  @State private errorMessage: string = '';
  @State private title: string = '';
  @State private positionMs: number = 0;
  @State private durationMs: number = 0;
  @State private bufferedPositionMs: number = 0;
  @State private isPlaying: boolean = false;
  @State private keepAliveSignal: number = 0;
  @State private subtitleCueText: string = '';

  // -- End of playback (docs/architecture/end-of-playback.md) --
  /** Own copies of the route params: they change as the queue advances. */
  private activeMediaFileId: string = '';
  private activeWorkId: string = '';
  private upNext: QueueItem[] = [];
  private currentWork: Work | null = null;
  private endMachine: EndOfPlaybackMachine = new EndOfPlaybackMachine(false);
  private endTimerHandle: number | null = null;
  /** Bumped per item so a late suggestions response for a previous item is dropped. */
  private suggestionsGeneration: number = 0;
  @State private endPhase: string = 'playing';
  @State private endSeconds: number = 0;
  @State private endNextTitle: string = '';
  @State private suggestions: SuggestionRow[] = [];

  private reporter: PlaybackSessionReporter | null = null;
  private currentInfo: PlaybackInfoResponse | null = null;
  /** Mirrors `currentInfo.source_offset_ms`, kept as its own field so
   * `handleDurationResolved` (fired from a native callback that only
   * carries a duration, not the whole `PlaybackInfoResponse`) can still
   * recompute `absoluteDurationMs` without reaching back into
   * `currentInfo`. */
  private currentSourceOffsetMs: number = 0;
  /** Best-effort estimate of the WHOLE original media's duration in the
   * absolute/source domain (`sourceOffsetMs + effectiveDurationMs`),
   * updated only when a NEW, larger estimate arrives (never shrinks) --
   * used solely to clamp a renegotiated seek target; never shown in the
   * UI (`durationMs`, above, is the player-LOCAL value `PlayerChrome`
   * renders, per that file's own "Progress math" header comment). */
  private absoluteDurationMs: number = 0;
  /** Whether `{"kind":"start"}` has already been sent for the CURRENT
   * `reporter` -- reset to `false` every time a fresh reporter is
   * constructed (initial load, or any renegotiation), so each negotiated
   * session gets exactly one `start` event on its own first transition
   * into `'playing'` (brief 4.12: "there is no separate start-session
   * call"). */
  private hasStartedOnce: boolean = false;
  /** Guards `teardownSessionOnly`/`teardownAndExit` so back, end-of-
   * stream, a native error and `aboutToDisappear`'s own safety net can
   * never run the terminal sequence twice for the same page instance. */
  private hasExited: boolean = false;
  /** Guards `renegotiate()` against overlapping calls (e.g. two rapid
   * seek presses before the first renegotiation has resolved). */
  private renegotiating: boolean = false;
  private heartbeatTimerHandle: number | null = null;
  private uiTickTimerHandle: number | null = null;
  /** Set only while immersive mode is actually active; `null` means
   * either "never entered" or "already restored" -- both `enterImmersiveMode`/
   * `exitImmersiveMode` use this as their own idempotency guard, see this
   * file's header comment on why both may be called more than once. */
  private windowHandle: window.Window | null = null;

  aboutToAppear(): void {
    this.activeMediaFileId = this.mediaFileId;
    this.activeWorkId = this.workId;
    this.upNext = this.queue.slice();
    this.resetEndMachine();
    const profile = AppStorage.get<DeviceProfile>(DEVICE_PROFILE_STORAGE_KEY);
    if (profile !== undefined && profile.inputMode === 'dpad') {
      // brief 6.3: the focus ring is hidden by default; the first D-pad
      // press appears to do nothing until this runs. Matches the same
      // pattern pages/Index.ets and pages/Pairing.ets already establish.
      this.getUIContext().getFocusController().activate(true, false);
    }

    this.controller.setCallbacks(this.buildControllerCallbacks());
    this.startUiTicker();
    void this.loadTitle();
    void this.loadInitial();
  }

  aboutToDisappear(): void {
    this.clearUiTicker();
    this.clearEndTimer();
    void this.exitImmersiveMode();
    // Safety net, matching player/AvPlayerController.ets's own
    // handleSurfaceDestroyed philosophy: if this page is torn down through
    // a path that never reached handleBack/handleEndOfStream/a native
    // error, still close the session and release the native player.
    // Never navigates again from here -- the NavPathStack is already
    // mid-transition by the time aboutToDisappear runs.
    if (!this.hasExited) {
      void this.teardownSessionOnly({ kind: 'stop', reason: 'user_stopped' });
    }
  }

  /** See this file's header comment, "Immersive mode", for why this is
   * ALSO wired to NavDestination's `.onShown()` in `build()` below. */
  onPageShow(): void {
    this.endMachine.paused = false;
    void this.enterImmersiveMode();
  }

  /** See this file's header comment, "Immersive mode". */
  onPageHide(): void {
    this.endMachine.paused = true;
    void this.exitImmersiveMode();
  }

  // -- Immersive mode (brief 6.4) --------------------------------------------

  private async enterImmersiveMode(): Promise<void> {
    if (this.windowHandle !== null) {
      return;
    }
    try {
      const context = getContext(this) as common.UIAbilityContext;
      const win = await window.getLastWindow(context);
      await win.setWindowLayoutFullScreen(true);
      await win.setWindowSystemBarEnable([]);
      this.windowHandle = win;
    } catch (err) {
      const asError = err as Error;
      logWarn(LOG_TAG, 'failed to enter immersive mode: ' + asError.message);
    }
  }

  private async exitImmersiveMode(): Promise<void> {
    const win = this.windowHandle;
    if (win === null) {
      return;
    }
    this.windowHandle = null;
    try {
      await win.setWindowSystemBarEnable(['status', 'navigation']);
      await win.setWindowLayoutFullScreen(false);
    } catch (err) {
      const asError = err as Error;
      logWarn(LOG_TAG, 'failed to restore window chrome: ' + asError.message);
    }
  }

  // -- Title (best-effort, never blocks negotiation/playback start) --------

  private async loadTitle(): Promise<void> {
    const workId = this.activeWorkId;
    const result = await getWorkDetail(workId);
    if (result.kind === 'ok' && workId === this.activeWorkId) {
      this.currentWork = result.value.work;
      if (this.title.length === 0) {
        this.title = result.value.work.title;
      }
    }
  }

  // -- UI position ticker ----------------------------------------------------

  private startUiTicker(): void {
    if (this.uiTickTimerHandle !== null) {
      return;
    }
    this.uiTickTimerHandle = setInterval((): void => {
      this.positionMs = this.controller.getCurrentPositionMs();
    }, UI_TICK_INTERVAL_MS);
  }

  private clearUiTicker(): void {
    if (this.uiTickTimerHandle !== null) {
      clearInterval(this.uiTickTimerHandle);
      this.uiTickTimerHandle = null;
    }
  }

  // -- Heartbeat cadence (brief 4.12) -----------------------------------------

  private startHeartbeatTimer(): void {
    if (this.heartbeatTimerHandle !== null) {
      return;
    }
    this.heartbeatTimerHandle = setInterval((): void => {
      this.sendHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);
  }

  private clearHeartbeatTimer(): void {
    if (this.heartbeatTimerHandle !== null) {
      clearInterval(this.heartbeatTimerHandle);
      this.heartbeatTimerHandle = null;
    }
  }

  private sendHeartbeat(): void {
    const reporter = this.reporter;
    if (reporter === null) {
      return;
    }
    reporter.reportHeartbeat(this.controller.getCurrentPositionMs());
  }

  // -- Negotiation (brief 4.10) -----------------------------------------------

  private async loadInitial(): Promise<void> {
    const options: PlaybackNegotiationOptions = {};
    if (this.startPositionMs > 0) {
      options.startPositionMs = this.startPositionMs;
    }
    await this.negotiateAndAttach(options);
  }

  /** The one place `negotiatePlayback` is ever called from this page,
   * shared by the initial load and every renegotiation -- `renegotiate()`,
   * below, is the only OTHER caller, and it always closes the previous
   * session before reaching this method. */
  private async negotiateAndAttach(options: PlaybackNegotiationOptions): Promise<void> {
    this.phase = 'loading';
    this.errorMessage = '';
    this.subtitleCueText = '';
    this.bufferedPositionMs = 0;
    this.isPlaying = false;

    const result = await negotiatePlayback(this.activeMediaFileId, options);
    if (result.kind !== 'ok') {
      this.phase = 'error';
      if (result.kind === 'network_failure') {
        this.errorMessage = result.message;
      } else if (result.envelope.kind === 'general') {
        this.errorMessage = result.envelope.message;
      } else {
        this.errorMessage = 'Something went wrong starting playback.';
      }
      return;
    }

    const info = result.value;
    this.currentInfo = info;
    this.currentSourceOffsetMs = info.source_offset_ms;
    this.hasStartedOnce = false;

    const initialDurationMs = resolveDurationMs(info.duration_ms, 0);
    this.durationMs = initialDurationMs;
    this.recomputeAbsoluteDuration(info.source_offset_ms, initialDurationMs);

    const reporter = new PlaybackSessionReporter(
      info.session_id,
      info.source_offset_ms,
      this.activeMediaFileId,
      initialDurationMs
    );
    this.reporter = reporter;

    await this.controller.attachSource(info, options.startPositionMs);
    await this.attachDefaultSubtitleIfNamed(info);

    this.phase = 'ready';
  }

  /** brief 4.10's explicit warning: send a stop event for the OLD session
   * before issuing the new negotiation GET. See this file's header
   * comment, "Renegotiation", for the two triggers that reach this today. */
  private async renegotiate(options: PlaybackNegotiationOptions): Promise<void> {
    if (this.renegotiating) {
      return;
    }
    this.renegotiating = true;

    const oldReporter = this.reporter;
    if (oldReporter !== null) {
      const rawPositionMs = this.controller.getCurrentPositionMs();
      await oldReporter.teardown({ kind: 'stop', reason: 'user_stopped' }, rawPositionMs);
    }
    this.clearHeartbeatTimer();

    await this.negotiateAndAttach(options);
    this.renegotiating = false;
  }

  private recomputeAbsoluteDuration(sourceOffsetMs: number, effectiveDurationMs: number): void {
    if (effectiveDurationMs <= 0) {
      // Unresolved (0) or live (-1) -- never overwrite a previously good
      // estimate with one that carries no real information.
      return;
    }
    const candidate = sourceOffsetMs + effectiveDurationMs;
    if (candidate > this.absoluteDurationMs) {
      this.absoluteDurationMs = candidate;
    }
  }

  // -- Subtitles (brief 4.11) --------------------------------------------------

  private async attachDefaultSubtitleIfNamed(info: PlaybackInfoResponse): Promise<void> {
    const selectedId = info.selected_subtitle_track_id;
    if (selectedId === null) {
      return;
    }
    let match: SubtitleTrack | null = null;
    for (const track of info.subtitle_tracks) {
      if (track.id === selectedId) {
        match = track;
        break;
      }
    }
    if (match === null) {
      return;
    }
    await this.controller.attachSubtitle(match);
  }

  // -- Seeking / renegotiation-on-seek (brief 9 Slice 7) ----------------------

  /** Tells apart a fresh on-demand transcode (brief 4.10 branch 3, URL
   * shape `/media/sessions/{transcode_session_id}/playlist.m3u8`) from an
   * already-ready HLS rendition (branch 2, `/media/renditions/{rendition_id}
   * /playlist.m3u8`) or direct play (branch 1) by the negotiated URL's own
   * path shape -- the one documented, reliable signal brief 4.10 gives for
   * this distinction (`source_offset_ms` alone cannot: it is legitimately
   * `0` for a fresh on-demand transcode that started from position 0, the
   * same value branch 1/2 always report). */
  private isOnDemandHlsInfo(info: PlaybackInfoResponse): boolean {
    return info.mode === 'hls' && info.url.indexOf('/media/sessions/') >= 0;
  }

  private handleSeekBack(): void {
    void this.performSeek(-SEEK_STEP_MS);
  }

  private handleSeekForward(): void {
    void this.performSeek(SEEK_STEP_MS);
  }

  private async performSeek(deltaMs: number): Promise<void> {
    if (this.phase !== 'ready') {
      return;
    }
    const info = this.currentInfo;
    if (info === null) {
      return;
    }

    if (!this.isOnDemandHlsInfo(info)) {
      this.controller.seekBy(deltaMs);
      return;
    }

    // On-demand HLS: renegotiate rather than seek (brief 9 Slice 7). The
    // target is computed in the ABSOLUTE/source domain, matching what
    // `start_position_ms` means server-side (brief 4.10).
    const rawPositionMs = this.controller.getCurrentPositionMs();
    const reportedNowMs = reportedPositionMs(rawPositionMs, info.source_offset_ms);
    const targetMs =
      this.absoluteDurationMs > 0
        ? clampSeekTargetMs(reportedNowMs + deltaMs, this.absoluteDurationMs)
        : Math.max(0, reportedNowMs + deltaMs);

    const options: PlaybackNegotiationOptions = { startPositionMs: targetMs };
    await this.renegotiate(options);
  }

  // -- Transport ---------------------------------------------------------------

  private handleTogglePlayPause(): void {
    if (this.isPlaying) {
      void this.controller.pause();
    } else {
      void this.controller.play();
    }
  }

  private handleBack(): void {
    if (this.endPhase !== 'playing') {
      this.handleEndExit();
      return;
    }
    void this.teardownAndExit({ kind: 'stop', reason: 'user_stopped' });
  }

  /** Engine ended (spec section 2): save the item as watched, then show the
   * ended card or up-next countdown instead of leaving the player. The
   * session is closed here; Replay and Play next each negotiate a new one. */
  private handleEndOfStream(): void {
    if (this.hasExited || this.endPhase !== 'playing') {
      return;
    }
    void this.finishItemAndShowEndScreen();
  }

  private async finishItemAndShowEndScreen(): Promise<void> {
    this.clearHeartbeatTimer();
    const reporter = this.reporter;
    this.reporter = null;
    if (reporter !== null) {
      await reporter.teardown({ kind: 'stop', reason: 'completed' }, this.controller.getCurrentPositionMs());
    }
    if (this.hasExited) {
      return;
    }
    const command = this.endMachine.onEnded();
    if (command === 'playNext') {
      void this.playNextItem();
      return;
    }
    this.syncEndState();
    this.startEndTimerIfNeeded();
    void this.loadSuggestions();
  }

  private resetEndMachine(): void {
    const next = this.upNext.length > 0 ? this.upNext[0] : null;
    this.endMachine = new EndOfPlaybackMachine(
      next !== null,
      true,
      END_SCREEN_COUNTDOWN_SECONDS,
      next !== null && next.immediate
    );
    this.endPhase = 'playing';
    this.endSeconds = 0;
    this.endNextTitle = next !== null ? next.title : '';
    this.suggestions = [];
    this.suggestionsGeneration = this.suggestionsGeneration + 1;
  }

  private syncEndState(): void {
    this.endPhase = this.endMachine.phase;
    this.endSeconds = this.endMachine.secondsRemaining;
  }

  private startEndTimerIfNeeded(): void {
    this.clearEndTimer();
    if (!this.endMachine.countdownRunning()) {
      return;
    }
    this.endTimerHandle = setInterval((): void => {
      const command = this.endMachine.tick();
      this.syncEndState();
      if (command === 'playNext') {
        this.clearEndTimer();
        void this.playNextItem();
      }
    }, 1000);
  }

  private clearEndTimer(): void {
    if (this.endTimerHandle !== null) {
      clearInterval(this.endTimerHandle);
      this.endTimerHandle = null;
    }
  }

  private handleEndPlayNow(): void {
    this.clearEndTimer();
    if (this.endMachine.playNow() === 'playNext') {
      void this.playNextItem();
    }
  }

  private handleEndCancel(): void {
    this.clearEndTimer();
    this.endMachine.cancelCountdown();
    this.syncEndState();
  }

  private handleEndReplay(): void {
    this.clearEndTimer();
    if (this.endMachine.replay() !== 'replay') {
      return;
    }
    this.syncEndState();
    this.suggestions = [];
    this.suggestionsGeneration = this.suggestionsGeneration + 1;
    void this.negotiateAndAttach({});
  }

  /** Back to details (spec section 5): leave the player; hardware Back maps here too. */
  private handleEndExit(): void {
    this.clearEndTimer();
    void this.teardownAndExit({ kind: 'stop', reason: 'user_stopped' });
  }

  private async playNextItem(): Promise<void> {
    const next = this.upNext.length > 0 ? this.upNext[0] : null;
    if (next === null) {
      return;
    }
    this.upNext = this.upNext.slice(1);
    const workChanged = next.workId !== this.activeWorkId;
    this.activeMediaFileId = next.mediaFileId;
    this.activeWorkId = next.workId;
    this.title = next.title;
    if (workChanged) {
      this.currentWork = null;
      void this.loadTitle();
    }
    this.resetEndMachine();
    await this.negotiateAndAttach({});
  }

  /** Spec section 5: `/similar` for the finished work (with the repository's
   * own genre fallback), minus the finished work, capped at 12. Hidden when
   * empty or failing; never blocks the primary actions. */
  private async loadSuggestions(): Promise<void> {
    const generation = this.suggestionsGeneration;
    let work = this.currentWork;
    if (work === null) {
      const detail = await getWorkDetail(this.activeWorkId);
      if (detail.kind !== 'ok') {
        return;
      }
      work = detail.value.work;
      this.currentWork = work;
    }
    const result = await getSimilarWorks(work, END_SCREEN_MAX_SUGGESTIONS + 1);
    if (result.kind !== 'ok' || generation !== this.suggestionsGeneration) {
      return;
    }
    const picked = pickSuggestions(result.value, work.id, END_SCREEN_MAX_SUGGESTIONS);
    const rows: SuggestionRow[] = [];
    for (const item of picked) {
      const row: SuggestionRow = { id: item.id, title: item.title, subtitle: '', artwork: undefined };
      rows.push(row);
    }
    this.suggestions = rows;
    for (const item of picked) {
      const art = await fetchWorkArtworkByPriority(item.id, COVER_ARTWORK_PRIORITY);
      if (art.kind === 'ok' && generation === this.suggestionsGeneration) {
        const updated: SuggestionRow[] = [];
        for (const row of this.suggestions) {
          const copy: SuggestionRow = {
            id: row.id,
            title: row.title,
            subtitle: row.subtitle,
            artwork: row.id === item.id ? art.value : row.artwork,
          };
          updated.push(copy);
        }
        this.suggestions = updated;
      }
    }
  }

  /** A suggestion opens that work's details; the finished player is replaced
   * so Back does not land on a dead player. */
  private handleSelectSuggestion(workId: string): void {
    this.clearEndTimer();
    void this.openSuggestion(workId);
  }

  private async openSuggestion(workId: string): Promise<void> {
    await this.teardownSessionOnly({ kind: 'stop', reason: 'user_stopped' });
    const stack = getNavStack();
    const params: DetailRouteParams = { workId: workId };
    replaceRoute(stack, ROUTES.Detail, params);
  }

  private handlePlaybackError(message: string): void {
    logError(LOG_TAG, 'AVPlayer reported an error: ' + message);
    void this.teardownAndExit({ kind: 'error', message: message });
  }

  // -- Teardown (brief 9 Slice 7) -----------------------------------------------

  /** Reporter teardown (final heartbeat, then the terminal stop/error
   * event), THEN the controller's own teardown (`release()`), in that
   * exact order -- never navigates. `hasExited` makes this idempotent. */
  private async teardownSessionOnly(outcome: PlaybackTeardownOutcome): Promise<void> {
    if (this.hasExited) {
      return;
    }
    this.hasExited = true;
    this.clearHeartbeatTimer();

    const reporter = this.reporter;
    const positionMs = this.controller.getCurrentPositionMs();
    if (reporter !== null) {
      await reporter.teardown(outcome, positionMs);
    }
    await this.controller.teardown();
  }

  private async teardownAndExit(outcome: PlaybackTeardownOutcome): Promise<void> {
    await this.teardownSessionOnly(outcome);
    const stack = getNavStack();
    popRoute(stack);
  }

  // -- AvPlayerController callbacks -------------------------------------------

  private buildControllerCallbacks(): AvPlayerControllerCallbacks {
    const callbacks: AvPlayerControllerCallbacks = {
      onStateChange: (state: media.AVPlayerState, reason: media.StateChangeReason): void => {
        this.handleStateChange(state);
      },
      onError: (message: string): void => {
        this.handlePlaybackError(message);
      },
      onDurationResolved: (durationMs: number): void => {
        this.handleDurationResolved(durationMs);
      },
      onSeekRequested: (fromMs: number, toMs: number): void => {
        const reporter = this.reporter;
        if (reporter !== null) {
          reporter.reportSeek(fromMs, toMs);
        }
      },
      onSeekDone: (positionMs: number): void => {
        this.positionMs = positionMs;
      },
      onBufferingUpdate: (infoType: media.BufferingInfoType, value: number): void => {
        this.handleBufferingUpdate(value);
      },
      onStartRenderFrame: (): void => {},
      onVideoSizeChange: (width: number, height: number): void => {},
      onAvailableBitrates: (bitrates: number[]): void => {},
      onBitrateDone: (bitrate: number): void => {},
      onEndOfStream: (): void => {
        this.handleEndOfStream();
      },
      onAudioInterrupt: (info: audio.InterruptEvent): void => {},
      onTrackChange: (index: number, isSelect: boolean): void => {},
      onSubtitleUpdate: (info: media.SubtitleInfo): void => {
        this.handleSubtitleUpdate(info);
      },
      onHlsAuthAttachFailed: (): void => {
        logWarn(
          LOG_TAG,
          'HLS auth header attachment failed; the controller fell back to an unauthenticated URL (brief risk R2)'
        );
      },
    };
    return callbacks;
  }

  private handleStateChange(state: media.AVPlayerState): void {
    this.isPlaying = state === 'playing';
    if (state === 'playing') {
      this.handleEnteredPlaying();
    } else if (state === 'paused') {
      this.handleEnteredPaused();
    } else if (state === 'stopped' || state === 'released') {
      this.clearHeartbeatTimer();
    }
  }

  private handleEnteredPlaying(): void {
    const reporter = this.reporter;
    if (reporter === null) {
      return;
    }
    const positionMs = this.controller.getCurrentPositionMs();
    if (!this.hasStartedOnce) {
      this.hasStartedOnce = true;
      reporter.reportStart();
    } else {
      reporter.reportResume(positionMs);
    }
    this.startHeartbeatTimer();
  }

  /** brief 4.12: "an immediate flush on every transition into
   * paused/ended/error before the corresponding reportPause/teardown
   * call" -- the 'ended'/'error' half of that is already satisfied by
   * `PlaybackSessionReporter#teardown`'s own built-in final-heartbeat step
   * (see `teardownSessionOnly`), so only the 'paused' transition needs an
   * explicit extra heartbeat here. */
  private handleEnteredPaused(): void {
    this.clearHeartbeatTimer();
    const reporter = this.reporter;
    if (reporter === null) {
      return;
    }
    const positionMs = this.controller.getCurrentPositionMs();
    reporter.reportHeartbeat(positionMs);
    reporter.reportPause(positionMs);
  }

  private handleDurationResolved(durationMs: number): void {
    this.durationMs = durationMs;
    this.recomputeAbsoluteDuration(this.currentSourceOffsetMs, durationMs);
    const reporter = this.reporter;
    if (reporter !== null) {
      reporter.updateDurationMs(durationMs);
    }
  }

  /**
   * `media.BufferingInfoType`'s exact member names/semantics are
   * unconfirmed without a real `.d.ts` or device (matching this project's
   * established "flag it, do not silently guess" discipline --
   * `player/AvPlayerController.ets`'s own header comment on unverified
   * MediaKit surfaces). This reads `value` defensively rather than
   * branching on `infoType` by name: a `0..100` magnitude is treated as a
   * cached-percentage-of-duration, anything larger as a cached-duration-
   * ahead-of-the-current-position in milliseconds. Either reading only
   * ever WIDENS the buffered-progress indicator (never shrinks it), so a
   * wrong guess degrades to "the buffered bar does not move" rather than
   * rendering something actively misleading.
   */
  private handleBufferingUpdate(value: number): void {
    if (this.durationMs <= 0) {
      return;
    }
    let candidateMs = this.bufferedPositionMs;
    if (value >= 0 && value <= 100) {
      candidateMs = Math.round((value / 100) * this.durationMs);
    } else if (value > 0) {
      candidateMs = this.positionMs + value;
    }
    if (candidateMs > this.bufferedPositionMs) {
      this.bufferedPositionMs = Math.min(this.durationMs, candidateMs);
    }
  }

  /** `media.SubtitleInfo`'s exact shape is unconfirmed without a real
   * `.d.ts` or device (`player/AvPlayerController.ets`'s own header
   * comment already flags this same field). An empty `text` is read as
   * "clear the current cue" -- the common convention for a cue-track
   * boundary event, and the only sane way to ever hide a cue again once
   * shown, given this event is the only signal this page has. */
  private handleSubtitleUpdate(info: media.SubtitleInfo): void {
    const text = info.text ?? '';
    this.subtitleCueText = text;
  }

  // -- Key input (brief 6.3, player/PlayerInput.ets) ---------------------------

  private bumpKeepAlive(): void {
    this.keepAliveSignal = this.keepAliveSignal + 1;
  }

  /** `player/PlayerInput.ets`'s header comment, rule 1: every resolved
   * action is followed by `event.stopPropagation()` at the call site
   * below, even a no-op one (`'up'`/`'down'`/`'next'`/`'previous'`), so an
   * unrelated ancestor never also reacts to the same key.
   *
   * `player/PlayerInput.ets`'s header comment also flags an unconfirmed
   * assumption this page inherits rather than re-solves: while a
   * `player/PlayerChrome.ets` transport button holds focus, ArkUI's
   * default focus traversal is EXPECTED to consume D-pad Left/Right to
   * move between sibling buttons before this root-level listener ever
   * sees `'seekBack'`/`'seekForward'` again -- this is a property of
   * ArkUI's focus system this page cannot verify without a device, not
   * something this method re-derives. */
  private dispatchPlayerAction(action: PlayerAction): void {
    if (action === 'back' || action === 'stop') {
      this.handleBack();
      return;
    }
    if (this.phase !== 'ready') {
      // Nothing past back/stop has a meaningful effect before a source is
      // attached (loading) or after negotiation has failed (error).
      return;
    }
    if (action === 'seekBack') {
      this.handleSeekBack();
      return;
    }
    if (action === 'seekForward') {
      this.handleSeekForward();
      return;
    }
    if (action === 'togglePlayPause' || action === 'confirm') {
      this.handleTogglePlayPause();
      return;
    }
    if (action === 'play') {
      void this.controller.play();
      return;
    }
    if (action === 'pause') {
      void this.controller.pause();
      return;
    }
    // 'up' / 'down' / 'next' / 'previous' -- no root-level meaning on this
    // screen (no secondary affordance row to enter via Up/Down per brief
    // 6.3, and next/previous-episode navigation is out of this slice's
    // scope). The key is still stopped by the caller below.
  }

  /** Returns true when the key was consumed by the end screen. */
  private dispatchEndScreenAction(action: PlayerAction): boolean {
    if (action === 'back' || action === 'stop') {
      this.handleEndExit();
      return true;
    }
    if (action === 'togglePlayPause' || action === 'play' || action === 'pause') {
      if (this.endMachine.playNow() === 'playNext') {
        this.handleEndPlayNow();
      } else {
        this.handleEndReplay();
      }
      return true;
    }
    if (action === 'next') {
      this.handleEndPlayNow();
      return true;
    }
    // Fast-forward / rewind are ignored on the card.
    return false;
  }

  private overlayTextSize(): number {
    return isTvMetrics() ? tv(OVERLAY_TEXT_SIZE_TV) : OVERLAY_TEXT_SIZE_TOUCH;
  }

  @Builder
  private loadingOrErrorOverlay(): void {

    Column({ space: Spacing.md }) {
      if (!(this.phase === 'error')) {
        Text('Loading...')
          .fontSize(this.overlayTextSize())
          .fontColor(toResourceColor(PLAYER_TEXT_PRIMARY))
      } else {
        Text(this.errorMessage)
          .fontSize(this.overlayTextSize())
          .fontColor(toResourceColor(PLAYER_TEXT_PRIMARY))
          .textAlign(TextAlign.Center)
          .padding({ left: Spacing.xl, right: Spacing.xl })

        Text('Retry')
          .fontSize(this.overlayTextSize())
          .fontWeight(FontWeight.Bold)
          .fontColor(toResourceColor(PLAYER_TEXT_PRIMARY))
          .padding({ left: Spacing.lg, right: Spacing.lg, top: Spacing.sm, bottom: Spacing.sm })
          .borderRadius(Radii.pillFull)
          .backgroundColor(toResourceColorWithAlpha(PLAYER_TEXT_PRIMARY, 0.16))
          .focusable(true)
          .onClick(() => {
            void this.loadInitial();
          })
      }
    }
    .width('100%')
    .height('100%')
    .justifyContent(FlexAlign.Center)
    .alignItems(HorizontalAlign.Center)
    .backgroundColor(toResourceColor(PLAYER_BG))
  }

  /** The ended card / up-next countdown (spec sections 1, 5, 6). */
  @Builder
  private endScreenOverlay(): void {

    EndScreen({
      phase: this.endPhase,
      finishedTitle: this.title,
      nextTitle: this.endNextTitle,
      secondsRemaining: this.endSeconds,
      countdownRunning: this.endMachine.countdownRunning(),
      hasSuggestions: (this.suggestions.length > 0),
      onPlayNow: () => {
        this.handleEndPlayNow();
      },
      onCancel: () => {
        this.handleEndCancel();
      },
      onReplay: () => {
        this.handleEndReplay();
      },
      onExit: () => {
        this.handleEndExit();
      },
    }) {
      MediaRail({
        railId: 'end-screen-suggestions',
        heading: '',
        itemGap: (isTvMetrics() ? tv(TvGeometry.railItemGapTitle) : TouchGeometry.railItemGap),
        headingSize: (isTvMetrics() ? tv(TvGeometry.railHeadingSize) : TouchGeometry.railHeadingSize),
        items: this.suggestions,
        itemBuilder: this.suggestionItem,
      })
    }
  }

  @Builder
  private suggestionItem(item: MediaRailItem, index: number, activeRailFactor: number): void {
    if (isTvMetrics()) {
      PosterCard({
        variant: 'home',
        title: (item as SuggestionRow).title,
        subtitle: (item as SuggestionRow).subtitle,
        artwork: (item as SuggestionRow).artwork,
        cardWidth: (isTvMetrics() ? tv(TvGeometry.homeRailCardWidthCover) : TouchGeometry.homeRailCardWidthCover),
        cardHeight: Math.round(((isTvMetrics() ? tv(TvGeometry.homeRailCardWidthCover) : TouchGeometry.homeRailCardWidthCover) * 3) / 2),
        artworkRadius: Radii.homeCardArtworkTv,
        activeRailFactor: activeRailFactor,
        onSelect: () => {
          this.handleSelectSuggestion((item as SuggestionRow).id);
        },
      })
    } else {
      PosterCard({
        variant: 'home',
        title: (item as SuggestionRow).title,
        subtitle: (item as SuggestionRow).subtitle,
        artwork: (item as SuggestionRow).artwork,
        cardWidth: (isTvMetrics() ? tv(TvGeometry.homeRailCardWidthCover) : TouchGeometry.homeRailCardWidthCover),
        cardHeight: Math.round(((isTvMetrics() ? tv(TvGeometry.homeRailCardWidthCover) : TouchGeometry.homeRailCardWidthCover) * 3) / 2),
        artworkRadius: Radii.homeCardArtworkTouch,
        titleFontSize: 12,
        subtitleFontSize: 10,
        activeRailFactor: activeRailFactor,
        onSelect: () => {
          this.handleSelectSuggestion((item as SuggestionRow).id);
        },
      })
    }
  }

  build() {

    NavDestination() {
      Stack({ alignContent: Alignment.Bottom }) {
        XComponent({
          id: 'playarr-player-surface',
          type: XComponentType.SURFACE,
          controller: this.controller.surfaceController,
        })
          .width('100%')
          .height('100%')

        if (this.phase !== 'ready') {
          this.loadingOrErrorOverlay()
        }

        if (this.phase === 'ready' && this.subtitleCueText.length > 0) {
          Text(this.subtitleCueText)
            .fontSize(isTvMetrics() ? tv(SUBTITLE_FONT_SIZE) : SUBTITLE_FONT_SIZE)
            .fontColor(toResourceColor(PLAYER_TEXT_PRIMARY))
            .textAlign(TextAlign.Center)
            .backgroundColor(toResourceColorWithAlpha(PLAYER_BG, 0.7))
            .padding({ left: Spacing.sm, right: Spacing.sm, top: 2, bottom: 2 })
            .borderRadius(SUBTITLE_BADGE_RADIUS)
            .margin({ bottom: isTvMetrics() ? tv(SUBTITLE_BOTTOM_MARGIN_TV) : SUBTITLE_BOTTOM_MARGIN_TOUCH })
            .focusable(false)
        }

        if (this.phase === 'ready' && this.endPhase === 'playing') {

          PlayerChrome({
            title: this.title,
            positionMs: this.positionMs,
            durationMs: this.durationMs,
            bufferedPositionMs: this.bufferedPositionMs,
            isPlaying: this.isPlaying,
            keepAliveSignal: this.keepAliveSignal,
            onTogglePlayPause: () => {
              this.handleTogglePlayPause();
            },
            onSeekBack: () => {
              this.handleSeekBack();
            },
            onSeekForward: () => {
              this.handleSeekForward();
            },
            onBack: () => {
              this.handleBack();
            },
          })
        }

        if (this.phase === 'ready' && this.endPhase !== 'playing') {
          this.endScreenOverlay()
        }
      }
      .width('100%')
      .height('100%')
      .backgroundColor(toResourceColor(PLAYER_BG))
      .onClick(() => {
        // Brief 5.10 / player/PlayerChrome.ets's own "Auto-hide" header
        // comment: a touch anywhere on the player screen, including over
        // the video surface (a SIBLING of the chrome, not a descendant),
        // must reveal it again.
        this.bumpKeepAlive();
      })
      .onKeyEvent((event: KeyEvent) => {
        this.bumpKeepAlive();
        const action = resolvePlayerAction(event);
        if (action === undefined) {
          return;
        }
        if (this.endPhase !== 'playing') {
          // Spec section 6: the end card owns the screen. Back leaves,
          // play/pause and next-track hit the primary action; everything
          // else (OK, D-pad) is left to focus traversal and the buttons.
          if (this.dispatchEndScreenAction(action)) {
            event.stopPropagation();
          }
          return;
        }
        this.dispatchPlayerAction(action);
        event.stopPropagation();
      })
    }
    .hideTitleBar(true)
    .onShown(() => {
      // See this file's header comment, "Immersive mode", for why both
      // this and onPageShow()/onPageHide() above call the same pair.
      this.endMachine.paused = false;
      void this.enterImmersiveMode();
    })
    .onHidden(() => {
      this.endMachine.paused = true;
      void this.exitImmersiveMode();
    })
    .onBackPressed(() => {
      // Also unconfirmed without a device (this file's own header comment,
      // "Immersive mode", flags the same class of risk for onShown/
      // onHidden): if a real system back gesture bypasses this callback
      // entirely rather than routing through it, aboutToDisappear's own
      // safety net still closes the session and releases the native
      // player, just without a chance to stop the pop itself first.
      this.handleBack();
      return true;
    })
  }
}

/**
 * Registered in `profile/router_map.json` as the `Player` route's
 * `buildFunction` (this file's header comment). Decodes `param` as
 * `navigation/Routes.ets`'s `PlayerRouteParams` and passes each field
 * straight through as `Player`'s own `@Prop`s, defaulting a missing
 * `startPositionMs` to `0` (this struct's own "no requested resume
 * position" sentinel, matching `player/AvPlayerController.ets#attachSource`'s
 * threshold).
 */
@Builder
export function PlayerBuilder(name: string, param: Object): void {
  Player({
    mediaFileId: (param as PlayerRouteParams).mediaFileId,
    workId: (param as PlayerRouteParams).workId,
    startPositionMs: ((param as PlayerRouteParams).startPositionMs ?? 0),
    queue: ((param as PlayerRouteParams).queue ?? []),
  });
}
