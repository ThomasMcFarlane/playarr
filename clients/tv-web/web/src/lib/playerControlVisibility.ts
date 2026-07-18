export function shouldAutoHidePlayerControls({
  inlineMusic,
  minimised,
  playbackState,
  interactionPinned,
}: {
  inlineMusic: boolean;
  minimised: boolean;
  playbackState: string;
  interactionPinned: boolean;
}): boolean {
  return (
    !inlineMusic &&
    !minimised &&
    playbackState === "playing" &&
    !interactionPinned
  );
}

export function shouldRenderPlayerControls({
  inlineMusic,
  minimised,
  playbackBusy,
  playbackStarted,
}: {
  inlineMusic: boolean;
  minimised: boolean;
  playbackBusy: boolean;
  playbackStarted: boolean;
}): boolean {
  return !minimised || (inlineMusic && (!playbackBusy || playbackStarted));
}
