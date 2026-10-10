// entry/src/test/ClockFormat.test.ts: core/ClockFormat.ts against the web TV clock text ("04:06", "Sun 11 October").
import { test } from "node:test";
import { strict as assert } from "node:assert";

import { clockDate, clockTime } from "../main/ets/core/ClockFormat";

test("time is zero-padded 24-hour HH:MM", () => {
  assert.equal(clockTime(new Date(2026, 9, 11, 4, 6)), "04:06");
  assert.equal(clockTime(new Date(2026, 9, 11, 23, 59)), "23:59");
  assert.equal(clockTime(new Date(2026, 9, 11, 0, 0)), "00:00");
});

test("date is short weekday, day, long month", () => {
  assert.equal(clockDate(new Date(2026, 9, 11, 4, 6)), "Sun 11 October");
  assert.equal(clockDate(new Date(2026, 0, 1, 12, 0)), "Thu 1 January");
  assert.equal(clockDate(new Date(2026, 11, 31, 12, 0)), "Thu 31 December");
});
