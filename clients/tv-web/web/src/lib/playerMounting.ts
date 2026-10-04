/**
 * Decides when the full-screen "Preparing playback" view may replace the
 * player. It is for the initial start only: once a source has been
 * negotiated, a seek that restarts the transcode, a quality switch or an
 * audio-track switch re-negotiates (`negotiation` goes back to "loading")
 * while the player UI, `<video>` element and engine must stay mounted and
 * show only the inline buffering spinner.
 */
export function showPreparingScreen(options: {
  negotiationKind: "loading" | "ready" | "error";
  keepInlinePlayerMounted: boolean;
  sourceSwitching: boolean;
}): boolean {
  return (
    options.negotiationKind === "loading" &&
    !options.keepInlinePlayerMounted &&
    !options.sourceSwitching
  );
}

/** The engine/`<video>` pair must survive a re-negotiation that is a source switch. */
export function shouldKeepEngineAttached(
  negotiationKind: "loading" | "ready" | "error",
  sourceSwitching: boolean
): boolean {
  return negotiationKind === "ready" || (negotiationKind === "loading" && sourceSwitching);
}
