#!/usr/bin/env node
// Production break (owner report, 10 October 2026): the Calendar page showed "The calendar could not be loaded".
// Dwell on Calendar in the nav (its first window is prefetched), move away (the prefetch is cancelled), open
// Calendar before the first request has finished: the page must load, never show the error state, and a
// cancelled prefetch must not leave the cache or the page broken. Also covers the mouse path (hover, leave, click).
//   node scripts/nav-calendar-prefetch-abort-e2e.mjs [--no-build] [--dist dir]
import { boot } from "./e2e-common.mjs";

const { check, open, finish } = await boot({ movies: 24, series: 8, artists: 0, calendarDelayMs: 1500 }, { realisticAuth: true });
const DELAY = 1500;
const pageState = (page) =>
  page.evaluate(() => ({
    error: /could not be loaded/i.test(document.body.innerText),
    skeleton: Boolean(document.querySelector(".app-main .skeleton-state")),
    ready: Boolean(document.querySelector("[data-page-id='calendar']")) && !document.querySelector(".app-main .skeleton-state"),
  }));

for (const [name, steps] of [
  [
    "keyboard dwell, move away, open",
    async (page) => {
      await page.evaluate(() => document.querySelector(".app-nav a[href='/calendar']")?.focus());
      await page.waitForTimeout(450); // past the dwell: the prefetch is in flight
      await page.evaluate(() => document.querySelector(".app-nav a[href='/movies']")?.focus()); // cancels it
      await page.waitForTimeout(150);
      await page.evaluate(() => document.querySelector(".app-nav a[href='/calendar']")?.click());
    },
  ],
  [
    "mouse hover, leave, click",
    async (page) => {
      await page.hover(".app-nav a[href='/calendar']");
      await page.waitForTimeout(450);
      await page.hover(".app-nav a[href='/movies']");
      await page.waitForTimeout(150);
      await page.click(".app-nav a[href='/calendar']");
    },
  ],
]) {
  const { context, page } = await open("/", { width: 1920, height: 1080 });
  await page.waitForSelector(".tv-home-card", { timeout: 8000 });
  await page.waitForTimeout(300);
  await steps(page);
  await page.waitForTimeout(DELAY * 3 + 1500);
  const state = await pageState(page);
  check(`calendar loads after a cancelled nav prefetch (${name})`, state.ready && !state.error, JSON.stringify(state));
  await context.close();
}
await finish();
