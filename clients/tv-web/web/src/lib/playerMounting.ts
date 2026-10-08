import { isBackKey } from "./backKey";

/**
 * Playback never shows an interstitial page while the session or stream is
 * negotiated: Play mounts the player straight away (black stage, normal
 * chrome, inline buffering spinner). Errors still replace the surface.
 *
 * The engine/`<video>` pair is created as soon as the surface mounts and stays
 * attached through every re-negotiation (initial load, seek that restarts the
 * transcode, quality or audio switch). Only an error unmounts the surface.
 */
export function shouldKeepEngineAttached(
  negotiationKind: "loading" | "ready" | "error"
): boolean {
  return negotiationKind !== "error";
}

/** The player surface is mounted for every negotiation state except an error. */
export function shouldMountPlayerSurface(
  negotiationKind: "loading" | "ready" | "error"
): boolean {
  return negotiationKind !== "error";
}

/**
 * BACK sequence: an open controls overlay closes first; only a BACK with the
 * controls hidden exits playback. Open menus and panels consume BACK themselves
 * (one level per press) before this decision is reached.
 */
export function resolvePlayerBack(options: {
  controlsVisible: boolean;
  minimised: boolean;
  inlineMusic: boolean;
  fullscreen: boolean;
}): "hide-controls" | "exit" {
  if (options.minimised || options.inlineMusic || options.fullscreen) return "exit";
  return options.controlsVisible ? "hide-controls" : "exit";
}

/** Remote BACK across platforms; see lib/backKey.ts. */
export const isPlayerBackKey = isBackKey;
