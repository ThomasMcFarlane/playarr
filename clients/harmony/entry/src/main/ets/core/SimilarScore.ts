/**
 * Similar-titles fallback scoring, used when a work has no cached embedding
 * -- brief 4.8: `GET /api/v1/catalog/{id}/similar` 404s in that case, "the
 * NORMAL case", and the client falls back to genre-driven ranking.
 *
 * This file lives under `core/` and is deliberately plain TypeScript: no
 * ArkUI, no `@kit.*` / `@ohos.*` imports, no decorators. It is Linux
 * testable with `node --test` and has zero dependency on the HarmonyOS SDK.
 *
 * Score formula (brief section 2.5, named verbatim):
 *   sharedGenres * 100 + sameKind * 10 + yearProximity
 *
 * `sharedGenres` and `sameKind` are pinned by the brief; `yearProximity` is
 * named as a term but the brief does not give its formula. See
 * `yearProximityScore` below for the chosen definition and rationale.
 */

import { Work } from "./Types/Work";

/**
 * Count of DISTINCT genre strings present in both works' `genres` arrays.
 * Duplicate genre strings within a single work's own array never inflate
 * the count.
 */
function sharedGenreCount(target: Work, candidate: Work): number {
  const targetGenres: Map<string, boolean> = new Map<string, boolean>();
  for (const genre of target.genres) {
    targetGenres.set(genre, true);
  }

  const shared: Map<string, boolean> = new Map<string, boolean>();
  for (const genre of candidate.genres) {
    if (targetGenres.has(genre)) {
      shared.set(genre, true);
    }
  }
  return shared.size;
}

function sameKindScore(target: Work, candidate: Work): number {
  if (candidate.kind === target.kind) {
    return 1;
  }
  return 0;
}

function releaseYear(work: Work): number | null {
  if (work.release_date === null) {
    return null;
  }
  const parsedYear: number = new Date(work.release_date).getFullYear();
  if (Number.isNaN(parsedYear)) {
    return null;
  }
  return parsedYear;
}

/**
 * `yearProximity` is named by the brief but not given a formula, so this is
 * a documented choice: an inverse-distance score in `(0, 1]`, equal to `1`
 * when both works share a release year and decaying towards `0` as the gap
 * grows (`1 / (1 + |yearGap|)`). It is deliberately kept to at most one
 * point so it can only ever break ties among candidates that already agree
 * on `sharedGenres` and `sameKind` -- it never outweighs a difference in
 * either of those two coarser, brief-pinned terms. A work with an unknown
 * `release_date` on either side contributes `0` (no signal either way,
 * rather than being penalised or favoured).
 */
function yearProximityScore(target: Work, candidate: Work): number {
  const targetYear: number | null = releaseYear(target);
  const candidateYear: number | null = releaseYear(candidate);
  if (targetYear === null || candidateYear === null) {
    return 0;
  }
  const yearGap: number = Math.abs(targetYear - candidateYear);
  return 1 / (1 + yearGap);
}

/**
 * `sharedGenres * 100 + sameKind * 10 + yearProximity` (brief section 2.5).
 */
export function scoreSimilarCandidate(target: Work, candidate: Work): number {
  const sharedGenres: number = sharedGenreCount(target, candidate);
  const sameKind: number = sameKindScore(target, candidate);
  const yearProximity: number = yearProximityScore(target, candidate);
  return sharedGenres * 100 + sameKind * 10 + yearProximity;
}

interface ScoredCandidate {
  work: Work;
  score: number;
}

function compareScoredCandidates(a: ScoredCandidate, b: ScoredCandidate): number {
  if (a.score !== b.score) {
    return b.score - a.score;
  }
  if (a.work.sort_title < b.work.sort_title) {
    return -1;
  }
  if (a.work.sort_title > b.work.sort_title) {
    return 1;
  }
  return 0;
}

/**
 * Rank candidates by `scoreSimilarCandidate` descending, tie-broken by
 * `sort_title` ascending (brief section 9, Slice 2 acceptance criteria:
 * "Scoring order and tie-break by sort_title").
 */
export function rankSimilarCandidates(target: Work, candidates: Work[]): Work[] {
  const scored: ScoredCandidate[] = candidates.map((candidate: Work): ScoredCandidate => {
    const entry: ScoredCandidate = { work: candidate, score: scoreSimilarCandidate(target, candidate) };
    return entry;
  });
  scored.sort(compareScoredCandidates);
  return scored.map((entry: ScoredCandidate): Work => entry.work);
}
