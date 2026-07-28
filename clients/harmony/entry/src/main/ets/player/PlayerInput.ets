/**
 * D-pad / remote key-code to player-action map (brief section 6.3, "Focus
 * and key input (D-pad profile)"). This file owns exactly one decision:
 * given a raw HarmonyOS key code (or a full ArkUI `KeyEvent`), which
 * `PlayerAction` does it mean on the Player screen. It renders nothing and
 * owns no state.
 *
 * ## THE RULE EVERY CONSUMER MUST FOLLOW: call `stopPropagation()`
 *
 * `onKeyEvent` BUBBLES from the focused component up through every one of
 * its ancestors (brief 6.3). A component that wires up BOTH `onClick` and
 * `onKeyEvent` for the same physical key fires BOTH handlers on OK/Enter --
 * ArkUI itself synthesises a click from Enter/OK on a focused, clickable
 * component, so an `onKeyEvent` handler on that SAME node that ALSO reacts
 * to `KEYCODE_DPAD_CENTER`/`KEYCODE_ENTER` double-fires the action. The
 * brief calls this out explicitly as a real bug class, not a hypothetical
 * one.
 *
 * Two rules follow, and every consumer of `resolvePlayerAction`/
 * `mapKeyCodeToAction` below MUST honour both:
 *
 * 1. **Call `event.stopPropagation()` immediately after acting on a key
 *    this map resolved to a `PlayerAction`.** Do this even though the
 *    handled key will not reach a `.onClick()` on the SAME node (that risk
 *    only exists for OK/Enter, rule 2 below) -- an unstopped event keeps
 *    bubbling to every ancestor's own `onKeyEvent`, and `player/PlayerChrome.ets`
 *    installs its own focus-scoped handlers up the same tree. Leaving a key
 *    event unstopped after handling it is exactly the "handled twice, once
 *    by two different ancestors" shape of this bug, not just the
 *    single-node one/click one.
 * 2. **Never wire this map's OK/Enter resolution (`'confirm'`) onto a node
 *    that ALSO has its own `.onClick()`.** A focused, clickable transport
 *    button (`player/PlayerChrome.ets`'s play/pause/seek/back buttons) must
 *    rely ONLY on `.onClick()` -- and ArkUI's native Enter-triggers-click
 *    behaviour -- for OK/Enter activation. This map's root-level resolver is
 *    for the container that does NOT already have a focused clickable
 *    child handling that key itself: typically the Player page's outermost
 *    key listener, reacting to whatever key was NOT already consumed and
 *    stopped by a focused chrome button.
 *
 * ## Handle ONLY `KeyType.Down`
 *
 * A physical key press delivers both a `KeyType.Down` and a `KeyType.Up`
 * `KeyEvent` to the same listener. Acting on both would double-apply every
 * action (a single left-arrow press would seek back twice). `resolvePlayerAction`
 * below enforces this itself -- it returns `undefined` for anything other
 * than `KeyType.Down`, so a consumer that always calls it (rather than
 * hand-rolling its own `event.type` check) gets this for free.
 *
 * ## Where D-pad Left/Right stop meaning "seek"
 *
 * Brief 6.3's traversal model: "a focused horizontal list consumes
 * Left/Right." While a `player/PlayerChrome.ets` transport button holds
 * focus, ArkUI's own default focus traversal is expected to consume D-pad
 * Left/Right to move between sibling buttons (play/pause, seek back, seek
 * forward) BEFORE this map's `'seekBack'`/`'seekForward'` resolution would
 * ever apply again from a root-level listener -- but that is a property of
 * ArkUI's focus system, not of this map, and it is NOT device-verified (no
 * HarmonyOS device exists while building this slice, per this project's
 * whole offline-validation strategy). The composing page (`pages/Player.ets`,
 * a later slice) is expected to additionally guard its own root-level
 * `resolvePlayerAction` call so `'seekBack'`/`'seekForward'` only actually
 * triggers a seek while nothing inside the chrome holds focus (e.g. by
 * checking the chrome's own aggregate focus state) -- flagged here, per this
 * project's "record it as an explicit divergence, not a silent one" posture,
 * rather than silently assumed correct.
 *
 * ## Key codes (brief 6.3, verbatim from `@kit.InputKit`'s `KeyCode`)
 *
 * Every map entry below carries the exact numeric value from the brief's
 * own table as a trailing comment, so a reviewer can audit this file
 * against that table without trusting this file's transcription of the
 * enum member names.
 */

import { KeyCode } from '@kit.InputKit';
import { clampSeekTargetMs } from '../core/PlaybackMath';

/**
 * Every action the Player screen's key input can produce. `'confirm'` is
 * deliberately distinct from `'togglePlayPause'` -- see this file's header,
 * rule 2: `'confirm'` is what a ROOT-level listener sees for OK/Enter when
 * nothing already handled it via `.onClick()`; a real transport button
 * never needs this map to tell it what OK/Enter means, it already has its
 * own `.onClick()`.
 */
export type PlayerAction =
  | 'up'
  | 'down'
  | 'seekBack'
  | 'seekForward'
  | 'confirm'
  | 'back'
  | 'togglePlayPause'
  | 'play'
  | 'pause'
  | 'stop'
  | 'next'
  | 'previous';

/**
 * The brief-6.3 key table, keyed by the real `KeyCode` enum member (not the
 * bare numeric literal) so a wrong transcription of a member name fails to
 * compile rather than silently mapping the wrong key -- the numeric value
 * from the brief's table is still repeated in each trailing comment as an
 * audit trail back to that table.
 *
 * Rewind/fast-forward are folded into the same `'seekBack'`/`'seekForward'`
 * actions as D-pad left/right rather than a separate "previous chapter"
 * style action: brief 6.3 gives both left/right and rewind/fast-forward no
 * distinct semantics of their own, and every other Playarr client treats
 * a remote's dedicated rewind/fast-forward buttons as the same "nudge the
 * position" affordance as the D-pad, not a chapter-skip.
 */
const KEY_CODE_TO_ACTION: ReadonlyMap<number, PlayerAction> = new Map<number, PlayerAction>([
  [KeyCode.KEYCODE_DPAD_UP, 'up'], // 2012
  [KeyCode.KEYCODE_DPAD_DOWN, 'down'], // 2013
  [KeyCode.KEYCODE_DPAD_LEFT, 'seekBack'], // 2014
  [KeyCode.KEYCODE_DPAD_RIGHT, 'seekForward'], // 2015
  [KeyCode.KEYCODE_DPAD_CENTER, 'confirm'], // 2016
  [KeyCode.KEYCODE_ENTER, 'confirm'], // 2054
  [KeyCode.KEYCODE_BACK, 'back'], // 2
  [KeyCode.KEYCODE_ESCAPE, 'back'], // 2070
  [KeyCode.KEYCODE_MEDIA_PLAY_PAUSE, 'togglePlayPause'], // 10
  [KeyCode.KEYCODE_MEDIA_STOP, 'stop'], // 11
  [KeyCode.KEYCODE_MEDIA_NEXT, 'next'], // 12
  [KeyCode.KEYCODE_MEDIA_PREVIOUS, 'previous'], // 13
  [KeyCode.KEYCODE_MEDIA_REWIND, 'seekBack'], // 14
  [KeyCode.KEYCODE_MEDIA_FAST_FORWARD, 'seekForward'], // 15
  [KeyCode.KEYCODE_MEDIA_PLAY, 'play'], // 2085
  [KeyCode.KEYCODE_MEDIA_PAUSE, 'pause'], // 2086
]);

/**
 * Pure keyCode -> action lookup, no `KeyType` filtering. Exposed separately
 * from `resolvePlayerAction` so the actual brief-6.3 table (the part that
 * must be exactly right) is testable/reviewable independent of ArkUI's
 * ambient `KeyEvent`/`KeyType` shape -- see this file's header comment.
 * Returns `undefined` for any key code not in the brief-6.3 table.
 */
export function mapKeyCodeToAction(keyCode: number): PlayerAction | undefined {
  return KEY_CODE_TO_ACTION.get(keyCode);
}

/**
 * Resolves an ArkUI `KeyEvent` (the parameter type of every component's
 * `.onKeyEvent()` callback) to a `PlayerAction`, enforcing "handle only
 * `KeyType.Down`" (this file's header comment) so a consumer that always
 * calls this instead of hand-rolling its own `event.type` check gets that
 * discipline for free. Returns `undefined` for a `KeyType.Up` event (or any
 * other event.type) and for any key code outside the brief-6.3 table.
 *
 * Does NOT call `event.stopPropagation()` itself -- the caller must do that
 * once it has actually acted on the returned action (this file's header
 * comment, rule 1). A key this function returns `undefined` for should be
 * left alone (not stopped), so an unrelated ancestor still gets a chance to
 * handle it.
 */
export function resolvePlayerAction(event: KeyEvent): PlayerAction | undefined {
  if (event.type !== KeyType.Down) {
    return undefined;
  }
  return mapKeyCodeToAction(event.keyCode);
}

/** Brief 6.3 / Slice 7 acceptance: "Seek amount is +/-10 seconds via D-pad
 * left/right." */
export const SEEK_STEP_MS: number = 10000;

/**
 * The clamped seek target for a `'seekBack'`/`'seekForward'` action,
 * built directly on `core/PlaybackMath.ts#clampSeekTargetMs` (brief 4.10 /
 * Slice 7 acceptance: "Seek ±10 s via D-pad left/right, clamped to
 * `[0, duration]`") so no consumer re-derives the clamp itself. Any action
 * other than `'seekBack'`/`'seekForward'` returns `currentPositionMs`
 * clamped but otherwise unchanged, so a caller can route every resolved
 * action through this function uniformly rather than branching first.
 */
export function nextSeekTargetMs(currentPositionMs: number, durationMs: number, action: PlayerAction): number {
  if (action === 'seekBack') {
    return clampSeekTargetMs(currentPositionMs - SEEK_STEP_MS, durationMs);
  }
  if (action === 'seekForward') {
    return clampSeekTargetMs(currentPositionMs + SEEK_STEP_MS, durationMs);
  }
  return clampSeekTargetMs(currentPositionMs, durationMs);
}
