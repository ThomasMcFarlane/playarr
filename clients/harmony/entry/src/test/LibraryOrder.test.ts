// entry/src/test/LibraryOrder.test.ts: core/LibraryOrder.ts against web pages/Library.tsx `orderWorks`.
import { test } from "node:test";
import { strict as assert } from "node:assert";

import { compareTitles, orderWorks } from "../main/ets/core/LibraryOrder";
import type { Work } from "../main/ets/core/Types/Work";

function work(id: string, title: string, sortTitle = "", addedAt = "2026-01-01T00:00:00Z"): Work {
  return { id, title, sort_title: sortTitle, added_at: addedAt } as unknown as Work;
}

test("numbers sort by value, as the live web movies grid", () => {
  const titles = ["12 Strong", "10 Cloverfield Lane", "2 Fast 2 Furious", "9 Bullets", "6 Underground", "5th Wave"];
  assert.deepEqual(titles.slice().sort(compareTitles), [
    "2 Fast 2 Furious", "5th Wave", "6 Underground", "9 Bullets", "10 Cloverfield Lane", "12 Strong",
  ]);
});

test("case and accents do not matter", () => {
  assert.equal(compareTitles("amélie", "Amelie"), 0);
  assert.ok(compareTitles("family guy", "FBI") < 0);
});

test("a prefix sorts first", () => {
  assert.ok(compareTitles("Alien", "Aliens") < 0);
});

test("orders by sort title, then falls back to title", () => {
  const items = [work("a", "The 5th Wave", "5th Wave"), work("b", "2012"), work("c", "6 Underground")];
  assert.deepEqual(orderWorks(items, "title", "asc").map((w) => w.id), ["a", "c", "b"]);
  assert.deepEqual(orderWorks(items, "title", "desc").map((w) => w.id), ["b", "c", "a"]);
});

test("date added sorts by time; other sorts keep server order", () => {
  const items = [work("a", "A", "", "2026-03-01T00:00:00Z"), work("b", "B", "", "2026-01-01T00:00:00Z")];
  assert.deepEqual(orderWorks(items, "date_added", "asc").map((w) => w.id), ["b", "a"]);
  assert.deepEqual(orderWorks(items, "recent", "asc").map((w) => w.id), ["a", "b"]);
});
