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
}: {
  inlineMusic: boolean;
  minimised: boolean;
  playbackBusy: boolean;
}): boolean {
  return !minimised || (inlineMusic && !playbackBusy);
}
