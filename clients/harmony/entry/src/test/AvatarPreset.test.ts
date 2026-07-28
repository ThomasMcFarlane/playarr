// entry/src/test/AvatarPreset.test.ts
//
// Pure Node unit tests for core/AvatarPreset.ts (brief section 5.11:
// "core/AvatarPreset.ts must match tv-web bit-for-bit -- unit-test it
// against fixture ids"). This file imports only the plain-TypeScript core
// module below and node's own test/assert builtins -- no ArkUI, no
// @kit.*/@ohos.* imports, no decorators.
//
// The expected values below are NOT guessed. They were produced by
// actually executing tv-web's real algorithm, copied verbatim from
// `clients/tv-web/web/src/lib/profileAvatar.ts`'s
// `defaultProfileAvatarPreset` --
//
//   let hash = 0;
//   for (const character of userId) {
//     hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
//   }
//   return PROFILE_AVATAR_PRESETS[hash % PROFILE_AVATAR_PRESETS.length]!.id;
//
// -- against each fixture user id below (`PROFILE_AVATAR_PRESETS` order:
// astronaut, cat, dinosaur, robot, pirate, alien). The intermediate hash
// and `hash % 6` are recorded alongside each fixture as a paper trail, not
// re-derived from the module under test.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { resolveAvatarPreset } from "../main/ets/core/AvatarPreset";

interface AvatarFixture {
  userId: string;
  hash: number;
  mod6: number;
  expectedPreset: string;
}

const FIXTURES: AvatarFixture[] = [
  { userId: "user-1", hash: 3458935471, mod6: 1, expectedPreset: "cat" },
  { userId: "user-2", hash: 3458935472, mod6: 2, expectedPreset: "dinosaur" },
  { userId: "abc", hash: 96354, mod6: 0, expectedPreset: "astronaut" },
  { userId: "a", hash: 97, mod6: 1, expectedPreset: "cat" },
  { userId: "z", hash: 122, mod6: 2, expectedPreset: "dinosaur" },
  { userId: "1234567890", hash: 2240804507, mod6: 5, expectedPreset: "alien" },
  {
    userId: "00000000-0000-0000-0000-000000000000",
    hash: 1428967488,
    mod6: 0,
    expectedPreset: "astronaut"
  },
  { userId: "Aa", hash: 2112, mod6: 0, expectedPreset: "astronaut" },
  { userId: "aA", hash: 3072, mod6: 0, expectedPreset: "astronaut" },
  { userId: "playarr", hash: 3801395885, mod6: 5, expectedPreset: "alien" },
  { userId: "playarr-user-42", hash: 265340064, mod6: 0, expectedPreset: "astronaut" },
  { userId: "éèê", hash: 231339, mod6: 3, expectedPreset: "robot" },
  { userId: "the-quick-brown-fox", hash: 701037180, mod6: 0, expectedPreset: "astronaut" }
];

describe("resolveAvatarPreset: matches tv-web's defaultProfileAvatarPreset bit-for-bit", () => {
  for (const fixture of FIXTURES) {
    it(
      "resolves \"" + fixture.userId + "\" (hash=" + fixture.hash + ", hash%6=" + fixture.mod6 + ") to \"" +
        fixture.expectedPreset + "\"",
      () => {
        assert.equal(resolveAvatarPreset(fixture.userId), fixture.expectedPreset);
      }
    );
  }

  it("covers at least 10 distinct fixture user ids", () => {
    assert.equal(FIXTURES.length >= 10, true);
  });
});

describe("resolveAvatarPreset: edge cases", () => {
  it("resolves the empty string to astronaut (hash stays 0, 0 % 6 === 0)", () => {
    assert.equal(resolveAvatarPreset(""), "astronaut");
  });

  it("is deterministic -- the same user id always resolves to the same preset", () => {
    const first: string = resolveAvatarPreset("repeat-me");
    const second: string = resolveAvatarPreset("repeat-me");
    assert.equal(first, second);
  });

  it("only ever returns one of the six pinned preset ids", () => {
    const validPresets: string[] = ["astronaut", "cat", "dinosaur", "robot", "pirate", "alien"];
    for (const fixture of FIXTURES) {
      const preset: string = resolveAvatarPreset(fixture.userId);
      assert.equal(validPresets.indexOf(preset) >= 0, true);
    }
  });
});
