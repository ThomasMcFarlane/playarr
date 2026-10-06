/**
 * Reports playback session telemetry to `POST /api/v1/playback/sessions/
 * {session_id}/events` and checkpoints durable watch progress to
 * `PUT /api/v1/playback/{media_file_id}/progress`, both via
 * `data/PlaybackRepository.ets` (brief section 4.12, "Playback session
 * reporting"). This file owns exactly one job, per `player/`'s layer
 * responsibility (brief section 3.2): telemetry, and telemetry must never
 * be able to break playback. `player/AvPlayerController.ets` owns the
 * AVPlayer state machine and drives this class by calling its `report*`
 * methods on the corresponding transitions; this class never touches
 * `@kit.MediaKit` itself and never owns a player-state timer of its own --
 * the 10 s heartbeat cadence is `AvPlayerController`'s (or `pages/
 * Player.ets`'s) timer to drive by calling `reportHeartbeat()` on a
 * schedule while playing or buffering, not something this class schedules
 * internally.
 *
 * SERIALISATION. At most one `POST .../events` request is ever in flight
 * for a given instance. `enqueue()` starts sending immediately when idle;
 * a call that arrives while a send is already in flight overwrites
 * `coalescedNext` (last-wins, one deep) rather than queuing -- an
 * unbounded FIFO would let a slow network turn ordinary telemetry into a
 * growing backlog, which is exactly what "must never block or break
 * playback" rules out. `runPump()` drains `coalescedNext` in a loop after
 * each send resolves, and `sendChain` always holds the promise for the
 * currently-running pump so `teardown()` can await full drain before it
 * starts the terminal sequence.
 *
 * TERMINAL HANDLING is exempt from coalescing. `teardown()` sets
 * `tornDown` (after which `enqueue()` silently drops anything further --
 * no more ordinary events are legitimate once teardown has started),
 * discards whatever was merely pending, awaits the current send to finish
 * without cutting it off, then sends the mandatory final heartbeat and the
 * terminal `stop`/`error` event as two sequential, unskippable, un-
 * coalesced calls (brief 4.12: "a final heartbeat then the terminal stop/
 * error, both serialised under a mutex and not cancellable").
 *
 * POSITION MATH. Every `position_ms`-shaped field this class sends --
 * `pause`/`resume`/`buffer_start`/`heartbeat`/`stop`'s `position_ms`, and
 * `seek`'s `from_ms`/`to_ms` -- is `core/PlaybackMath.ts#reportedPositionMs`
 * applied to the RAW player position the caller passes in, never the raw
 * value alone (brief 4.12: "Every reported position_ms = player_position +
 * source_offset_ms"). `buffer_end`'s `duration_ms` is a SPAN (how long the
 * stall lasted), not a position, so it is passed through unmodified.
 *
 * WATCH PROGRESS. `data/PlaybackRepository.ets#putWatchProgress` already
 * derives `completed` from `core/PlaybackMath.ts#isPlaybackComplete`
 * internally (see that file's own docstring) -- this class does not
 * recompute the threshold itself, it just calls `putWatchProgress` at the
 * three documented trigger points (brief 4.12: "on pause, on stop, and on
 * the 10 s cadence") with the same already-offset position it just sent as
 * a session event. A `currentDurationMs <= 0` (duration unresolved, or a
 * live source that never reports one) skips the checkpoint entirely rather
 * than writing a meaningless threshold (brief: "duration === -1 (live) is
 * guarded everywhere progress maths runs").
 *
 * CONSTRUCTOR SHAPE. Beyond the two fields the reporting contract itself
 * introduces (`sessionId`, `sourceOffsetMs`), this constructor also takes
 * `mediaFileId` and an initial `durationMs` -- both are required by
 * `putWatchProgress`'s signature for the pause/stop/heartbeat checkpoint
 * this same brief section demands, and neither has anywhere else to live
 * given `reportHeartbeat`/`reportPause`/`reportStop` take only a bare
 * `positionMs`. `updateDurationMs()` lets the caller refresh the value if
 * `core/PlaybackMath.ts#resolveDurationMs` only settles on a real duration
 * after this reporter is already constructed.
 *
 * EXTRA METHODS. `reportResume`, `reportBufferStart` and `reportBufferEnd`
 * exist alongside the explicitly-named methods because the brief also
 * requires "pause/resume events on the corresponding transitions" and
 * "buffer_start/buffer_end events" -- there is no other method that could
 * emit those three wire shapes.
 *
 * `reportStop`/`reportError` are also directly callable outside of
 * `teardown()` for a caller that wants to fire a bare event without the
 * mandatory-final-heartbeat ceremony (they do not set `tornDown`); the
 * guaranteed, un-coalescable, ends-the-reporter path is always
 * `teardown()`, and every real caller closing a session should prefer it.
 */

import { sendPlaybackSessionEvent, putWatchProgress } from '../data/PlaybackRepository';

import { reportedPositionMs } from '../core/PlaybackMath.ts';
import {
  PlaybackEventKind,
  PlaybackEventStart,
  PlaybackEventPause,
  PlaybackEventResume,
  PlaybackEventSeek,
  PlaybackEventBufferStart,
  PlaybackEventBufferEnd,
  PlaybackEventHeartbeat,
  PlaybackEventStop,
  PlaybackEventError,
  StopReason,
} from '../core/Types/Playback.ts';

import { ApiFailure } from '../net/ApiResult';

import { logWarn, logError } from '../util/Log';

const LOG_TAG: string = 'PlaybackSessionReporter';

/** `teardown()`'s stop branch: the final heartbeat is followed by a
 * `{"kind":"stop","reason":...}` event carrying the SAME reported
 * position as that heartbeat. `reason` is the full `StopReason` union
 * (`core/Types/Playback.ts`), including the `{"other":"..."}` fallback
 * shape and the `"error"` string variant -- a stop whose reason happens to
 * be `"error"`, distinct from `PlaybackTeardownError` below. The most
 * common caller-supplied reason is `user_stopped` -- `pages/Player.ets`
 * sends `{kind: 'stop', reason: 'user_stopped'}` on Back and before every
 * renegotiation (brief 9 Slice 7, brief 4.10's "always send a stop event
 * for the old session_id before renegotiating"). */
export interface PlaybackTeardownStop {
  kind: 'stop';
  reason: StopReason;
}

/** `teardown()`'s error branch: the final heartbeat is followed by a
 * `{"kind":"error","message":...}` event. This wire shape carries no
 * `position_ms` of its own -- only the preceding heartbeat does. */
export interface PlaybackTeardownError {
  kind: 'error';
  message: string;
}

export type PlaybackTeardownOutcome = PlaybackTeardownStop | PlaybackTeardownError;

/** Renders an `ApiFailure` (`net/ApiResult.ets`) as a short, loggable
 * diagnostic string. Never includes a bearer token or a token-bearing URL
 * (`util/Log.ets`'s logging discipline) -- an `ApiFailure` never carries
 * either. */
function describeApiFailure(failure: ApiFailure): string {
  if (failure.kind === 'network_failure') {
    return 'network_failure(' + failure.reason + '): ' + failure.message;
  }
  return 'http_failure(status=' + String(failure.status) + ')';
}

/**
 * One instance per negotiated playback session (`PlaybackInfoResponse.
 * session_id`, brief 4.10). See this file's header comment for the full
 * serialisation, position-math and watch-progress design.
 */
export class PlaybackSessionReporter {
  private readonly sessionId: string;
  private readonly sourceOffsetMs: number;
  private readonly mediaFileId: string;
  private currentDurationMs: number;

  private sendingInFlight: boolean = false;
  private coalescedNext: PlaybackEventKind | null = null;
  private sendChain: Promise<void> = Promise.resolve();
  private tornDown: boolean = false;

  constructor(sessionId: string, sourceOffsetMs: number, mediaFileId: string, durationMs: number) {
    this.sessionId = sessionId;
    this.sourceOffsetMs = sourceOffsetMs;
    this.mediaFileId = mediaFileId;
    this.currentDurationMs = durationMs;
  }

  /** Refreshes the duration used for the `completed` threshold and the
   * watch-progress body, for a caller whose `core/PlaybackMath.ts#
   * resolveDurationMs` result only settles after construction (e.g. the
   * player's own `durationUpdate` arriving late). */
  public updateDurationMs(durationMs: number): void {
    this.currentDurationMs = durationMs;
  }

  /** `{"kind":"start"}` (brief 4.12): call immediately after `play()`
   * first succeeds. There is no separate start-session call -- the
   * session already exists from the negotiation GET. */
  public reportStart(): void {
    const event: PlaybackEventStart = { kind: 'start' };
    this.enqueue(event);
  }

  /** `{"kind":"heartbeat",...}` (brief 4.12): call on the 10 s cadence
   * while playing or buffering (owned by the caller, not this class), plus
   * once more immediately on every transition into paused/ended/error
   * before the corresponding `reportPause`/`teardown` call. Also
   * checkpoints watch progress at the same reported position (brief:
   * "PUT .../progress on pause, on stop, and on the same 10 s cadence").
   * `bytes_streamed_total` is always sent as `null` -- nothing upstream of
   * this class tracks a running byte count. */
  public reportHeartbeat(positionMs: number): void {
    const reported = reportedPositionMs(positionMs, this.sourceOffsetMs);
    const event: PlaybackEventHeartbeat = {
      kind: 'heartbeat',
      position_ms: reported,
      bytes_streamed_total: null,
    };
    this.enqueue(event);
    this.putProgress(reported);
  }

  /** `{"kind":"pause","position_ms":...}` (brief 4.12): call on the
   * playing/buffering-to-paused transition. Also checkpoints watch
   * progress at the same reported position. */
  public reportPause(positionMs: number): void {
    const reported = reportedPositionMs(positionMs, this.sourceOffsetMs);
    const event: PlaybackEventPause = { kind: 'pause', position_ms: reported };
    this.enqueue(event);
    this.putProgress(reported);
  }

  /** `{"kind":"resume","position_ms":...}` (brief 4.12): call on the
   * paused-to-playing transition. */
  public reportResume(positionMs: number): void {
    const event: PlaybackEventResume = {
      kind: 'resume',
      position_ms: reportedPositionMs(positionMs, this.sourceOffsetMs),
    };
    this.enqueue(event);
  }

  /** `{"kind":"seek","from_ms":...,"to_ms":...}` (brief 4.12): both ends of
   * the seek are the same "raw player position plus source offset" math as
   * every other position field this class sends. */
  public reportSeek(fromMs: number, toMs: number): void {
    const event: PlaybackEventSeek = {
      kind: 'seek',
      from_ms: reportedPositionMs(fromMs, this.sourceOffsetMs),
      to_ms: reportedPositionMs(toMs, this.sourceOffsetMs),
    };
    this.enqueue(event);
  }

  /** `{"kind":"buffer_start","position_ms":...}` (brief 4.12): call when
   * the player starts stalling for data. */
  public reportBufferStart(positionMs: number): void {
    const event: PlaybackEventBufferStart = {
      kind: 'buffer_start',
      position_ms: reportedPositionMs(positionMs, this.sourceOffsetMs),
    };
    this.enqueue(event);
  }

  /** `{"kind":"buffer_end","duration_ms":...}` (brief 4.12): call when a
   * stall clears. `stallDurationMs` is how long the stall itself lasted --
   * a span, not a position, so it is sent as given, with no source-offset
   * arithmetic applied. */
  public reportBufferEnd(stallDurationMs: number): void {
    const event: PlaybackEventBufferEnd = { kind: 'buffer_end', duration_ms: stallDurationMs };
    this.enqueue(event);
  }

  /** `{"kind":"stop","reason":...,"position_ms":...}` (brief 4.12), sent as
   * a bare, coalescable event with no preceding heartbeat and no effect on
   * `tornDown`. Also checkpoints watch progress at the same reported
   * position. A caller ending a session for good should use `teardown()`
   * instead -- see this file's header comment. */
  public reportStop(reason: StopReason, positionMs: number): void {
    const reported = reportedPositionMs(positionMs, this.sourceOffsetMs);
    const event: PlaybackEventStop = { kind: 'stop', reason: reason, position_ms: reported };
    this.enqueue(event);
    this.putProgress(reported);
  }

  /** `{"kind":"error","message":...}` (brief 4.12), sent as a bare,
   * coalescable event with no preceding heartbeat and no effect on
   * `tornDown`. A caller ending a session for good should use
   * `teardown()` instead -- see this file's header comment. */
  public reportError(message: string): void {
    const event: PlaybackEventError = { kind: 'error', message: message };
    this.enqueue(event);
  }

  /**
   * Ends this reporter for good (brief 4.12: "On teardown, send a final
   * heartbeat then the terminal stop/error, both serialised under a
   * mutex and not cancellable"). Idempotent -- a second call is a no-op.
   * After this resolves, every `report*` method is inert (`enqueue()`
   * silently drops anything handed to it once `tornDown` is set).
   *
   * Order of operations: mark `tornDown` and discard whatever was merely
   * pending, await the currently in-flight send (if any) to finish
   * without cutting it off, send exactly one final heartbeat at
   * `positionMs`, then send the terminal `stop` or `error` event carrying
   * that same reported position (a `stop`'s `position_ms`; an `error`
   * carries no position at all). The `stop` branch also checkpoints watch
   * progress once, at that same reported position, matching the "on stop"
   * trigger from `data/PlaybackRepository.ets#putWatchProgress`'s call
   * sites -- the error branch does not, matching the brief's explicit list
   * of exactly three PUT triggers (pause, stop, the heartbeat cadence).
   */
  public async teardown(outcome: PlaybackTeardownOutcome, positionMs: number): Promise<void> {
    if (this.tornDown) {
      return;
    }
    this.tornDown = true;
    this.coalescedNext = null;
    await this.sendChain;

    const reported = reportedPositionMs(positionMs, this.sourceOffsetMs);
    const finalHeartbeat: PlaybackEventHeartbeat = {
      kind: 'heartbeat',
      position_ms: reported,
      bytes_streamed_total: null,
    };
    await this.sendOne(finalHeartbeat);

    if (outcome.kind === 'stop') {
      const stopEvent: PlaybackEventStop = { kind: 'stop', reason: outcome.reason, position_ms: reported };
      await this.sendOne(stopEvent);
      this.putProgress(reported);
    } else {
      const errorEvent: PlaybackEventError = { kind: 'error', message: outcome.message };
      await this.sendOne(errorEvent);
    }
  }

  /** Starts sending `event` immediately if idle, or overwrites
   * `coalescedNext` (last-wins, one deep) if a send is already in flight.
   * Silently drops `event` once `tornDown` -- see this file's header
   * comment for why that is deliberate, not a bug. */
  private enqueue(event: PlaybackEventKind): void {
    if (this.tornDown) {
      return;
    }
    if (this.sendingInFlight) {
      this.coalescedNext = event;
      return;
    }
    this.sendingInFlight = true;
    this.sendChain = this.runPump(event);
  }

  /** Sends `firstEvent`, then keeps draining `coalescedNext` (one deep,
   * last-wins) until nothing is left pending. The returned promise (held
   * in `sendChain` by `enqueue()`) only resolves once the whole chain --
   * not just this one send -- has finished, which is what lets
   * `teardown()` await a true drain. */
  private async runPump(firstEvent: PlaybackEventKind): Promise<void> {
    let current: PlaybackEventKind | null = firstEvent;
    while (current !== null) {
      await this.sendOne(current);
      current = this.coalescedNext;
      this.coalescedNext = null;
    }
    this.sendingInFlight = false;
  }

  /** Sends exactly one event and swallows every failure -- network,
   * HTTP, or an unexpected thrown error -- logging it rather than ever
   * rethrowing, rejecting, or otherwise surfacing it to a caller.
   * `data/PlaybackRepository.ets#sendPlaybackSessionEvent` already never
   * throws by its own contract; the `try`/`catch` here is a second,
   * deliberately redundant layer of the same guarantee, because this
   * class's whole reason to exist is that telemetry must never be able to
   * break playback. */
  private async sendOne(event: PlaybackEventKind): Promise<void> {
    try {
      const result = await sendPlaybackSessionEvent(this.sessionId, event);
      if (result.kind !== 'ok') {
        logWarn(
          LOG_TAG,
          'session event "' + event.kind + '" for session ' + this.sessionId + ' was rejected: ' + describeApiFailure(result)
        );
      }
    } catch (err) {
      const asError = err as Error;
      logError(LOG_TAG, 'unexpected error sending session event "' + event.kind + '": ' + asError.message);
    }
  }

  /** Fire-and-forget watch-progress checkpoint (brief 4.12's three PUT
   * triggers). Skips the call entirely when `currentDurationMs <= 0` --
   * an unresolved (`duration_ms === 0`, not yet reconciled via
   * `core/PlaybackMath.ts#resolveDurationMs`) or live (`-1`) duration has
   * no meaningful `completed` threshold to compute. */
  private putProgress(reportedPositionValue: number): void {
    if (this.currentDurationMs <= 0) {
      return;
    }
    this.sendProgressCheckpoint(reportedPositionValue);
  }

  /** The actual checkpoint call, isolated from `putProgress()` so the
   * latter can stay a synchronous, non-`async` fire-and-forget entry
   * point. Swallows every failure the same way `sendOne()` does --
   * `data/PlaybackRepository.ets#putWatchProgress` already never throws by
   * its own contract; this `try`/`catch` is the same deliberately
   * redundant second layer. */
  private async sendProgressCheckpoint(reportedPositionValue: number): Promise<void> {
    try {
      const result = await putWatchProgress(this.mediaFileId, reportedPositionValue, this.currentDurationMs);
      if (result.kind !== 'ok') {
        logWarn(
          LOG_TAG,
          'watch-progress checkpoint for media file ' + this.mediaFileId + ' was rejected: ' + describeApiFailure(result)
        );
      }
    } catch (err) {
      const asError = err as Error;
      logError(LOG_TAG, 'unexpected error while checkpointing watch progress: ' + asError.message);
    }
  }
}
