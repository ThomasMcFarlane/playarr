#!/usr/bin/env node
// "Watchlist with one item stretches the row to the full panel height" (seen live, 10 October 2026). A list's rows keep
// their natural height and stack from the top whatever the count: with 1, 2 and 10 items every row's height equals
// the height of a row in a long list, +-1 px, and the first row starts at the top of the list.
//   node scripts/nav-list-rows-e2e.mjs [--no-build] [--dist dir]
import { join } from "node:path";
import { boot, opt, root } from "./e2e-common.mjs";
import { startServer } from "./nav-perf/server.mjs";

const { check, open, finish } = await boot({ movies: 10, series: 2, artists: 0 });
const measure = (page) => page.evaluate(() => {
  const rows = [...document.querySelectorAll(".tv-watchlist-row")].map((e) => e.getBoundingClientRect());
  const list = document.querySelector(".tv-watchlist-list")?.getBoundingClientRect();
  return { heights: rows.map((r) => r.height), firstGap: rows[0] && list ? rows[0].top - list.top : null };
});
for (const [width, height, theme] of [[1920, 1080, "dark"], [1280, 720, "light"]]) {
  let standard = null;
  for (const n of [10, 1, 2]) {
    const server = await startServer({ distDir: opt("dist", join(root, "dist")), movies: 40, series: 4, artists: 0, watchlist: n });
    const { context, page } = await open("/watchlist", { server, width, height, theme });
    await page.waitForSelector(".tv-watchlist-row", { timeout: 15000 });
    await page.waitForTimeout(500);
    const m = await measure(page);
    if (n === 10) standard = m.heights[0];
    const label = `${width}x${height} ${theme} ${n} item(s)`;
    check(`${label}: ${n} rows rendered`, m.heights.length === n, `${m.heights.length}`);
    check(`${label}: every row is the standard height (${standard?.toFixed(1)}px) +-1`, m.heights.every((h) => Math.abs(h - standard) <= 1), m.heights.map((h) => h.toFixed(1)).join(","));
    // The first row is focused and lifted by 7px (card focus), so allow that on top of the 1px.
    check(`${label}: rows start at the top of the list`, m.firstGap <= 1 && m.firstGap >= -8, `${m.firstGap}`);
    await context.close();
    server.close?.();
  }
}
await finish();
