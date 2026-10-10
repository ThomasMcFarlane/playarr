#!/usr/bin/env node
// Production break (live check, 10 October 2026): a library page (Movies, Series, Music) stayed on "could not be
// loaded" and never showed a title card when the browser dropped its connections while the first page was loading
// (net::ERR_NETWORK_CHANGED). The first page is now retried after a short wait. This script makes the first requests
// of each library list fail the way the browser does and checks that the cards still appear without a click on
// "Try again". A list that keeps failing must still end in the error state with its retry button.
//   node scripts/nav-library-load-retry-e2e.mjs [--no-build] [--dist dir]
import { boot } from "./e2e-common.mjs";

const { check, open, finish } = await boot({ movies: 24, series: 8, artists: 6 });
const state = (page) =>
  page.evaluate(() => ({
    cards: document.querySelectorAll(".tv-title-card").length,
    error: /could not be loaded/i.test(document.body.innerText),
    retry: Boolean(document.querySelector(".app-main button")),
  }));

for (const [path, kind] of [["/movies", "movie"], ["/series", "series"], ["/music", "artist"]]) {
  for (const [failures, expectCards] of [[2, true], [4, false]]) {
    const { context, page } = await open(path, { width: 1920, height: 1080 });
    await page.waitForSelector(".tv-title-card", { timeout: 8000 });
    let seen = 0;
    await context.route((url) => url.pathname === "/api/v1/catalog" && url.searchParams.get("kind") === kind, (route) => {
      seen += 1;
      return seen <= failures ? route.abort("connectionreset") : route.continue();
    });
    const t0 = Date.now();
    await page.reload();
    if (expectCards) {
      const ok = await page.waitForSelector(".tv-title-card", { timeout: 9000 }).then(() => true, () => false);
      const s = await state(page);
      check(`${path}: cards appear after ${failures} dropped requests, no error page (${Date.now() - t0} ms)`, ok && !s.error && s.cards > 0, JSON.stringify(s));
    } else {
      await page.waitForTimeout(6500);
      const s = await state(page);
      check(`${path}: ${failures} dropped requests end in the error state with a retry button`, s.error && s.cards === 0 && s.retry, JSON.stringify({ ...s, seen }));
    }
    await context.close();
  }
}
await finish();
