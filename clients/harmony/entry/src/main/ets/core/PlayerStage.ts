// core/PlayerStage.ts
//
// Pure rules for the player page. Play opens the player directly: black
// stage, the normal chrome and at most a small spinner while the session or
// stream is negotiated. No interstitial page or full-screen message. Only a
// negotiation failure replaces the stage, with its retry panel.

export type PlayerPhase = 'loading' | 'error' | 'ready';

/** The normal chrome (title, back) is mounted while loading and when ready. */
export function chromeMounted(phase: PlayerPhase, endScreenShowing: boolean): boolean {
  return phase !== 'error' && !endScreenShowing;
}

/** A small spinner over the stage, only while the stream is negotiated. */
export function spinnerVisible(phase: PlayerPhase): boolean {
  return phase === 'loading';
}

/** The full-screen error panel is the only blocking overlay. */
export function errorPanelVisible(phase: PlayerPhase): boolean {
  return phase === 'error';
}

export type BackDecision = 'hide-controls' | 'exit';

/** BACK closes the visible controls first; only a BACK with them hidden exits. */
export function resolveBack(controlsVisible: boolean): BackDecision {
  return controlsVisible ? 'hide-controls' : 'exit';
}
