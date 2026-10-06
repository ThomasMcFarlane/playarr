/**
 * Click, tap, Enter and remote OK on the player surface only reveal hidden
 * controls; they toggle play/pause only when the controls were already
 * visible when the input began. Space, k and media keys are unaffected.
 *
 * Pointer-down / key-down also reveal the controls, so by the time the click
 * (or the window key handler) runs, the controls already read as visible. A
 * gate therefore records the visibility at the start of the input and
 * answers once, at the end of it.
 */
export interface RevealGate {
  /** Call at the start of the input (pointer-down / key-down capture), before revealing. */
  begin(controlsVisible: boolean): void;
  /** Call when the input completes; true when it may toggle playback. Resets the gate. */
  finish(controlsVisibleNow: boolean): boolean;
}

export function createRevealGate(): RevealGate {
  let revealOnly = false;
  return {
    begin(controlsVisible) {
      revealOnly = !controlsVisible;
    },
    finish(controlsVisibleNow) {
      const allowed = !revealOnly && controlsVisibleNow;
      revealOnly = false;
      return allowed;
    },
  };
}
