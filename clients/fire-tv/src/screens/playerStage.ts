/**
 * Pure rules for the player screen. Play opens the player directly: black
 * stage, the normal transport chrome and at most a small spinner while the
 * session or stream is negotiated. No interstitial page or full-screen
 * message; only a failure shows its panel.
 */
export type NegotiationStatus = 'idle' | 'loading' | 'ready' | 'error' | 'empty';

export function showSpinner(options: {
  negotiation: NegotiationStatus;
  buffering: boolean;
  failed: boolean;
}): boolean {
  const negotiating = options.negotiation === 'loading' || options.negotiation === 'idle';
  return (negotiating || options.buffering) && !options.failed;
}

/** The transport chrome (title, buttons) is present for every state, including negotiation. */
export function transportChromeMounted(): boolean {
  return true;
}

/** BACK hides visible controls first; BACK with them hidden exits playback. */
export function resolveBack(controlsVisible: boolean): 'hide-controls' | 'exit' {
  return controlsVisible ? 'hide-controls' : 'exit';
}
