// entry/src/test/SimilarScore.test.ts
//
// Pure Node unit tests for core/SimilarScore.ts (brief section 2.5 /
// section 4.8 / section 9, Slice 2 acceptance: "Scoring order and
// tie-break by sort_title"). This file imports only the plain-TypeScript
// core module below and node's own test/assert builtins -- no ArkUI, no
// @kit.*/@ohos.* imports, no decorators.
//
// Covers:
//   - the pinned formula: sharedGenres * 100 + sameKind * 10 + yearProximity
//   - distinct-genre counting (duplicate genre strings never inflate it)
//   - yearProximity: 1 when years match, decaying with |gap|, 0 when either
//     release_date is unknown
//   - rankSimilarCandidates: descending score order, tie-broken by
//     sort_title ascending

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { scoreSimilarCandidate, rankSimilarCandidates } from "../main/ets/core/SimilarScore";
import { Work } from "../main/ets/core/Types/Work";

function makeWork(
  id: string,
  kind: "movie" | "series" | "site" | "artist" | "author",
  genres: string[],
  releaseDate: string | null,
  sortTitle: string
): Work {
  const work: Work = {
    id: id,
    kind: kind,
    external_refs: [],
    title: sortTitle,
    sort_title: sortTitle,
    overview: null,
    images: [],
    genres: genres,
    tags: [],
    added_at: "2026-01-01T00:00:00.000Z",
    release_date: releaseDate,
    monitored: false,
    availability: "available"
  };
  return work;
}

describe("scoreSimilarCandidate: the pinned formula", () => {
  it("scores sharedGenres * 100 + sameKind * 10 + yearProximity for a full match", () => {
    const target: Work = makeWork("t", "movie", ["action", "drama"], "2020-06-15", "Target");
    const candidate: Work = makeWork("c", "movie", ["action", "drama"], "2020-01-01", "Candidate");

    // sharedGenres = 2 (action, drama), sameKind = 1, yearProximity = 1 (same year).
    assert.equal(scoreSimilarCandidate(target, candidate), 2 * 100 + 1 * 10 + 1);
  });

  it("counts only DISTINCT shared genres -- duplicates in either array never inflate the count", () => {
    const target: Work = makeWork("t", "movie", ["action", "action", "drama"], null, "Target");
    const candidate: Work = makeWork("c", "series", ["action", "action", "comedy"], null, "Candidate");

    // Distinct target genres: {action, drama}. Distinct shared with candidate: {action} -> 1.
    // sameKind = 0 (movie vs series). yearProximity = 0 (both release_date null).
    assert.equal(scoreSimilarCandidate(target, candidate), 1 * 100 + 0 * 10 + 0);
  });

  it("scores sameKind as 10 when kinds match and 0 when they differ", () => {
    const target: Work = makeWork("t", "movie", [], null, "Target");
    const sameKindCandidate: Work = makeWork("c1", "movie", [], null, "C1");
    const differentKindCandidate: Work = makeWork("c2", "series", [], null, "C2");

    assert.equal(scoreSimilarCandidate(target, sameKindCandidate), 10);
    assert.equal(scoreSimilarCandidate(target, differentKindCandidate), 0);
  });

  it("scores yearProximity as 1 when release years are identical", () => {
    const target: Work = makeWork("t", "movie", [], "2015-03-01", "Target");
    const candidate: Work = makeWork("c", "series", [], "2015-11-30", "Candidate");

    // sharedGenres = 0, sameKind = 0, yearProximity = 1 / (1 + 0) = 1.
    assert.equal(scoreSimilarCandidate(target, candidate), 1);
  });

  it("decays yearProximity by inverse distance as the year gap grows", () => {
    const target: Work = makeWork("t", "movie", [], "2015-01-01", "Target");
    const gapOne: Work = makeWork("c1", "series", [], "2016-01-01", "C1");
    const gapThree: Work = makeWork("c2", "series", [], "2018-01-01", "C2");

    assert.equal(scoreSimilarCandidate(target, gapOne), 1 / 2);
    assert.equal(scoreSimilarCandidate(target, gapThree), 1 / 4);
  });

  it("scores yearProximity as 0 when the target's release_date is unknown", () => {
    const target: Work = makeWork("t", "movie", [], null, "Target");
    const candidate: Work = makeWork("c", "movie", [], "2020-01-01", "Candidate");

    // sameKind = 1 (10), yearProximity = 0 -- unknown contributes no signal either way.
    assert.equal(scoreSimilarCandidate(target, candidate), 10);
  });

  it("scores yearProximity as 0 when the candidate's release_date is unknown", () => {
    const target: Work = makeWork("t", "movie", [], "2020-01-01", "Target");
    const candidate: Work = makeWork("c", "movie", [], null, "Candidate");

    assert.equal(scoreSimilarCandidate(target, candidate), 10);
  });
});

describe("rankSimilarCandidates: descending score order", () => {
  it("orders strictly by score: more shared genres beats same-kind beats year proximity alone", () => {
    const target: Work = makeWork("t", "movie", ["action", "drama"], "2020-01-01", "Target");
    const twoSharedGenres: Work = makeWork(
      "c1", "movie", ["action", "drama", "comedy"], "2020-06-01", "Two Shared Genres"
    );
    const oneSharedGenreDifferentKind: Work = makeWork(
      "c2", "series", ["action"], "2021-01-01", "One Shared Genre"
    );
    const noGenresSameKind: Work = makeWork(
      "c3", "movie", [], null, "No Genres Same Kind"
    );

    const ranked: Work[] = rankSimilarCandidates(target, [
      noGenresSameKind,
      oneSharedGenreDifferentKind,
      twoSharedGenres
    ]);

    assert.equal(ranked.length, 3);
    assert.equal(ranked[0].id, "c1");
    assert.equal(ranked[1].id, "c2");
    assert.equal(ranked[2].id, "c3");
  });
});

describe("rankSimilarCandidates: tie-break by sort_title ascending", () => {
  it("breaks an exact score tie by sort_title, ascending", () => {
    const target: Work = makeWork("t", "movie", ["horror"], null, "Target");
    const zebra: Work = makeWork("c1", "movie", ["horror"], null, "Zebra");
    const apple: Work = makeWork("c2", "movie", ["horror"], null, "Apple");
    const mango: Work = makeWork("c3", "movie", ["horror"], null, "Mango");

    // All three candidates score identically: sharedGenres=1 (100), sameKind=1 (10),
    // yearProximity=0 (both release_date null) -> 110 each.
    assert.equal(scoreSimilarCandidate(target, zebra), 110);
    assert.equal(scoreSimilarCandidate(target, apple), 110);
    assert.equal(scoreSimilarCandidate(target, mango), 110);

    const ranked: Work[] = rankSimilarCandidates(target, [zebra, apple, mango]);

    assert.equal(ranked[0].sort_title, "Apple");
    assert.equal(ranked[1].sort_title, "Mango");
    assert.equal(ranked[2].sort_title, "Zebra");
  });

  it("only uses sort_title to break ties among candidates that already agree on score", () => {
    const target: Work = makeWork("t", "movie", ["action", "drama"], "2020-01-01", "Target");
    // Higher raw score but a sort_title that would sort last alphabetically --
    // must still rank ahead of the lower-scoring, alphabetically-earlier candidate.
    const higherScoreLateAlpha: Work = makeWork(
      "c1", "movie", ["action", "drama"], "2020-01-01", "Zzzz Highest Score"
    );
    const lowerScoreEarlyAlpha: Work = makeWork(
      "c2", "movie", [], null, "Aaaa Lowest Score"
    );

    const ranked: Work[] = rankSimilarCandidates(target, [lowerScoreEarlyAlpha, higherScoreLateAlpha]);

    assert.equal(ranked[0].id, "c1");
    assert.equal(ranked[1].id, "c2");
  });

  it("does not mutate the input array", () => {
    const target: Work = makeWork("t", "movie", ["action"], null, "Target");
    const first: Work = makeWork("c1", "movie", [], null, "Zebra");
    const second: Work = makeWork("c2", "movie", ["action"], null, "Apple");
    const input: Work[] = [first, second];

    rankSimilarCandidates(target, input);

    assert.equal(input[0].id, "c1");
    assert.equal(input[1].id, "c2");
  });
});
