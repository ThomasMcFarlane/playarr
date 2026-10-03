/**
 * Pure rules for the end-of-playback experience.
 * Canonical spec: docs/architecture/end-of-playback.md.
 */

/** Length of the up-next countdown, in whole seconds. */
export const END_SCREEN_COUNTDOWN_SECONDS = 10;
/** Maximum number of suggestion tiles. */
export const END_SCREEN_MAX_SUGGESTIONS = 12;

export type EndScreenKind = "ended" | "up-next";

export interface EndScreenInput {
  engineState: string;
  minimised: boolean;
  inlineMusic: boolean;
  isMusic: boolean;
  hasNext: boolean;
}

/**
 * Which end card to show, or `null` for none.
 * Music with a following track chains silently, so no card is shown until the
 * queue itself ends. Inline (mobile) music keeps its mini player instead.
 */
export function resolveEndScreenKind(input: EndScreenInput): EndScreenKind | null {
  if (input.engineState !== "ended" || input.minimised) return null;
  if (input.inlineMusic) return null;
  if (input.isMusic) return input.hasNext ? null : "ended";
  return input.hasNext ? "up-next" : "ended";
}

/** Work id parsed from the detail route that launched playback, if any. */
export function workIdFromDetailRoute(route: string | undefined): string | undefined {
  const match = /^\/(?:movies|series|sites|music)\/([^/?]+)$/.exec(route ?? "");
  return match?.[1];
}

/** Detail route for a suggested work (movies, series and sites only). */
export function detailRouteForWork(work: { id: string; kind: string }): string {
  const base =
    work.kind === "site" ? "/sites" : work.kind === "series" ? "/series" : "/movies";
  return `${base}/${work.id}`;
}

const SUGGESTIBLE_KINDS = new Set(["movie", "series", "site"]);

/** Drops the finished work and unplayable kinds, and caps the row length. */
export function pickSuggestions<T extends { id: string; kind: string }>(
  works: readonly T[],
  finishedWorkId: string | undefined
): T[] {
  return works
    .filter((work) => work.id !== finishedWorkId && SUGGESTIBLE_KINDS.has(work.kind))
    .slice(0, END_SCREEN_MAX_SUGGESTIONS);
}

/**
 * Negotiation parameters for Replay. The ended session was already closed as
 * "completed" on the server, so Replay renegotiates a brand new playback
 * session (as a new play, from 0) instead of seeking the old one.
 */
export function replayNegotiationParams<T extends { startPositionMs?: number }>(params: T): T {
  return { ...params, startPositionMs: 0 };
}
