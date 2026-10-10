// entry/src/test/CountFormat.test.ts: core/CountFormat.ts against the web library subtitle text.
import { test } from "node:test";
import { strict as assert } from "node:assert";

import { groupThousands, titleCountLabel } from "../main/ets/core/CountFormat";

test("groups thousands with commas", () => {
  assert.equal(groupThousands(0), "0");
  assert.equal(groupThousands(999), "999");
  assert.equal(groupThousands(1754), "1,754");
  assert.equal(groupThousands(1234567), "1,234,567");
});

test("title count label is singular for one", () => {
  assert.equal(titleCountLabel(1), "1 title");
  assert.equal(titleCountLabel(1754), "1,754 titles");
});
