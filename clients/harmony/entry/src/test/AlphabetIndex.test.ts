// entry/src/test/AlphabetIndex.test.ts: core/AlphabetIndex.ts against web Library.tsx's A-Z rules.
import { test } from "node:test";
import { strict as assert } from "node:assert";

import { alphabetFor, firstIndexAtOrAfter, titleLetter, workLetter } from "../main/ets/core/AlphabetIndex";

test("letters: digits and symbols are #, accents are stripped, case folds", () => {
  assert.equal(titleLetter("10 Example"), "#");
  assert.equal(titleLetter("  émile"), "E");
  assert.equal(titleLetter("zebra"), "Z");
  assert.equal(titleLetter(""), "#");
  assert.equal(workLetter("example, the", "The Example"), "E");
  assert.equal(workLetter("", "The Example"), "T");
});

test("descending order reverses the rail", () => {
  assert.equal(alphabetFor("asc")[0], "#");
  assert.equal(alphabetFor("desc")[0], "Z");
  assert.equal(alphabetFor("desc")[26], "#");
});

test("jump lands at or after the letter in the sort order", () => {
  const asc = ["#", "#", "A", "C", "C", "F"];
  assert.equal(firstIndexAtOrAfter(asc, "A", "asc"), 2);
  assert.equal(firstIndexAtOrAfter(asc, "B", "asc"), 3);
  assert.equal(firstIndexAtOrAfter(asc, "#", "asc"), 0);
  assert.equal(firstIndexAtOrAfter(asc, "G", "asc"), -1);
  const desc = ["Z", "M", "C", "#"];
  assert.equal(firstIndexAtOrAfter(desc, "N", "desc"), 1);
  assert.equal(firstIndexAtOrAfter(desc, "#", "desc"), 3);
});
